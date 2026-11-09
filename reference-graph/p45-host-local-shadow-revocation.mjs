import { closeSync, fsyncSync, lstatSync, openSync, realpathSync, writeSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const MARKER = 'p45-shadow-revoked';
const SCHEMA = 'reference-graph.p45-host-local-revocation.v1';
const REASONS = new Set(['manual-revoke','external-abort','probe-failure','parity-mismatch']);

function checkedDirectory(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)
    || directory.includes('\0')) throw new TypeError('P45 invalid rehearsal directory');
  const root = resolve(directory);
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || realpathSync(root) !== root) {
    throw new TypeError('P45 untrusted rehearsal directory');
  }
  return root;
}

/**
 * A same-host OFF latch, never an activation grant. Missing/unreadable
 * directories and malformed/existing markers fail closed.
 */
export function isP45ShadowRevoked(directory) {
  try {
    const root = checkedDirectory(directory);
    try {
      lstatSync(join(root, MARKER));
      return true;
    } catch (error) {
      return error?.code !== 'ENOENT';
    }
  } catch {
    return true;
  }
}

/**
 * An exclusive, fsynced marker. A partial marker after a crash is OFF.
 * There is deliberately no API to reset or turn on this marker.
 */
export function revokeP45SharedShadow({ directory, reason } = {}) {
  if (!REASONS.has(reason)) throw new TypeError('P45 invalid revoke reason');
  const target = join(checkedDirectory(directory), MARKER);
  let fd;
  try {
    fd = openSync(target, 'wx', 0o600);
    writeSync(fd, SCHEMA + '\n' + reason + '\n', null, 'utf8');
    fsyncSync(fd);
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw new Error('P45 durable rehearsal revocation failed');
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return {
    schema_version: SCHEMA,
    revoked: true,
    rearm_supported: false,
    deployment_rollback_performed: false,
    activation_authorized: false,
    repository_default_graph_enabled: false,
  };
}

function validScope(scope) {
  return !!scope && typeof scope === 'object' && !Array.isArray(scope)
    && scope.mode === 'isolated-shadow-rehearsal'
    && scope.default_off === true && scope.production_route_wiring === false
    && Array.isArray(scope.profiles)
    && scope.profiles.length > 0 && scope.profiles.length <= 2
    && scope.profiles.every(p => p === 'standard' || p === 'deep')
    && new Set(scope.profiles).size === scope.profiles.length;
}

function exactLegacyParity(r) {
  return r?.status === 'exact' && r.record_order_exact === true
    && r.pattern_order_exact === true
    && r.authoritative_source === 'legacy-control'
    && r.activation_authorized === false
    && r.graph_runtime_activated === false;
}

/**
 * Guard a lab-only P41-style probe across same-host processes.
 * The probe receives an abort signal after a marker appears. A local
 * mismatch or error persists the OFF state for other workers.
 * This is not a transactional/distributed release controller.
 */
export function wrapP45HostLocalShadow({
  directory, scope, shadowProbe, pollMs = 20,
} = {}) {
  if (!validScope(scope) || typeof shadowProbe !== 'function'
    || !Number.isInteger(pollMs) || pollMs < 5 || pollMs > 1000
    || isP45ShadowRevoked(directory)) {
    throw new TypeError('P45 shared shadow rehearsal unavailable');
  }
  return async function guardedShadow(args = {}) {
    if (!args || typeof args !== 'object'
      || !scope.profiles.includes(args.request?.profile)
      || (args.signal !== undefined && !(args.signal instanceof AbortSignal))
      || args.signal?.aborted || isP45ShadowRevoked(directory)) {
      throw new Error('P45 shared shadow BLOCKED');
    }
    const controller = new AbortController();
    let rejectCancellation;
    const cancelled = new Promise((_resolve, reject) => { rejectCancellation = reject; });
    const abort = () => {
      if (!controller.signal.aborted) {
        controller.abort();
        rejectCancellation(new Error('P45 revoked'));
      }
    };
    const externalAbort = () => {
      try { revokeP45SharedShadow({ directory, reason: 'external-abort' }); }
      catch { /* An unavailable directory already reads as revoked. */ }
      abort();
    };
    args.signal?.addEventListener('abort', externalAbort, { once: true });
    const watcher = setInterval(() => {
      if (isP45ShadowRevoked(directory)) abort();
    }, pollMs);
    try {
      // Close the race between the initial preflight and event registration.
      if (args.signal?.aborted) externalAbort();
      const result = await Promise.race([
        Promise.resolve().then(() => {
          if (controller.signal.aborted || isP45ShadowRevoked(directory)) {
            throw new Error('P45 already revoked');
          }
          return shadowProbe({ ...args, signal: controller.signal });
        }),
        cancelled,
      ]);
      if (controller.signal.aborted || isP45ShadowRevoked(directory)) {
        throw new Error('P45 result arrived after revoke');
      }
      if (!exactLegacyParity(result)) {
        revokeP45SharedShadow({ directory, reason: 'parity-mismatch' });
        throw new Error('P45 shadow parity mismatch');
      }
      return result;
    } catch {
      if (!isP45ShadowRevoked(directory)) {
        revokeP45SharedShadow({ directory, reason: 'probe-failure' });
      }
      throw new Error('P45 shared shadow BLOCKED');
    } finally {
      clearInterval(watcher);
      args.signal?.removeEventListener('abort', externalAbort);
    }
  };
}
