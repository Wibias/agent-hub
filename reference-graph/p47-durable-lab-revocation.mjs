import {
  closeSync, existsSync, fsyncSync, lstatSync, openSync,
  readFileSync, realpathSync, writeSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { evaluateP46SignedLabLease } from './p46-distributed-lab-shadow-lease.mjs';

const VERSION = 'reference-graph.p47-durable-lab-revocation.v1';
const SCOPE = 'isolated-shadow-rehearsal';
const PERMIT = 'p47-lab-permit.json';
const OFF = 'p47-revocation-intent';
const REVOCATION = 'p47-signed-revocation.json';
const MAX_JSON_BYTES = 16000;

function fail() {
  throw new Error('P47 durable lab state BLOCKED');
}

function checkedDirectory(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)
    || directory.includes('\0')) fail();
  let root;
  try {
    root = resolve(directory);
    const info = lstatSync(root);
    if (!info.isDirectory() || info.isSymbolicLink()
      || realpathSync(root) !== root) fail();
  } catch { fail(); }
  return root;
}

function parsedFile(root, name) {
  const path = join(root, name);
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()
      || info.size === 0 || info.size > MAX_JSON_BYTES) fail();
    const raw = readFileSync(path, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') !== info.size) fail();
    return JSON.parse(raw);
  } catch { fail(); }
}

function writeExclusive(root, name, content) {
  let fd;
  try {
    // Never replace an existing state blob or remove a previously written OFF.
    fd = openSync(join(root, name), 'wx', 0o600);
    writeSync(fd, content, null, 'utf8');
    fsyncSync(fd);
  } catch { fail(); }
  finally { if (fd !== undefined) closeSync(fd); }

  // The directory sync makes rename/create persistence less dependent on an
  // abrupt OS crash. Some platforms refuse dir-open: fail, don't claim PASS.
  let dirFd;
  try {
    dirFd = openSync(root, 'r');
    fsyncSync(dirFd);
  } catch { fail(); }
  finally { if (dirFd !== undefined) closeSync(dirFd); }
}

function validScope(scope) {
  return scope && typeof scope === 'object' && !Array.isArray(scope)
    && Object.keys(scope).sort().join(',') ===
      ['default_off', 'mode', 'production_route_wiring', 'profiles'].sort().join(',')
    && scope.mode === SCOPE
    && scope.default_off === true
    && scope.production_route_wiring === false
    && Array.isArray(scope.profiles) && scope.profiles.length === 2
    && scope.profiles.includes('standard') && scope.profiles.includes('deep')
    && new Set(scope.profiles).size === 2;
}

function status() {
  return {
    schema_version: VERSION,
    owner_activation_authorized: false,
    production_graph_activated: false,
    repository_default_graph_enabled: false,
    production_rollback_rehearsed: false,
  };
}

/**
 * Durable, monotonic OFF-only state for a single lab coordinator directory.
 * The signer and signed envelopes are provided by an external TEST harness.
 * Neither a release signer nor a server is provisioned here.
 *
 * An exclusive OFF-intent is fsynced FIRST, prior to saving a signed revoke.
 * Readers see an OFF-intent as decisive even after a mid-write crash.
 */
export function createP47DurableLabRevocation({
  directory, scope, publicKeyPem, publicKeySha256,
  expectedRepositorySha, expectedLabId, clock = () => new Date(),
} = {}) {
  if (!validScope(scope) || typeof clock !== 'function'
    || typeof publicKeyPem !== 'string'
    || typeof publicKeySha256 !== 'string'
    || typeof expectedRepositorySha !== 'string'
    || typeof expectedLabId !== 'string') {
    throw new TypeError('P47 requires explicitly isolated lab-only verifier');
  }

  function root() { return checkedDirectory(directory); }
  function inspectEnvelope(envelope) {
    return evaluateP46SignedLabLease({
      envelope, publicKeyPem, publicKeySha256,
      expectedRepositorySha, expectedLabId, now: clock(),
    });
  }

  function offExists(path) {
    try {
      lstatSync(join(path, OFF));
      return true;
    } catch (e) {
      if (e?.code === 'ENOENT') return false;
      return true;
    }
  }

  return Object.freeze({
    /**
     * The sole 'permit' operation belongs to an explicitly isolated lab.
     * Only an empty directory, with no previous OFF marker, may be seeded.
     * Cannot re-arm a revoked directory under the same identity.
     */
    seedLabPermit(signedPermit) {
      const path = root();
      if (offExists(path)
        || existsSync(join(path, PERMIT))
        || existsSync(join(path, REVOCATION))) fail();
      const verdict = inspectEnvelope(signedPermit);
      if (!verdict.valid || !verdict.lab_shadow_eligible) fail();
      writeExclusive(path, PERMIT, JSON.stringify(signedPermit));
      if (offExists(path)) fail(); // concurrent revoke wins
      return { ...status(), lab_seeded: true, activation_authorized: false };
    },

    /**
     * Called by the lab's read-only GET /state test server. Never returns the
     * original permit when an OFF intent exists, even if signed revocation
     * persistence is incomplete or its signature has expired.
     */
    readSignedState() {
      const path = root();
      if (offExists(path)) {
        const signed = parsedFile(path, REVOCATION); // missing => fail closed
        const verdict = inspectEnvelope(signed);
        if (!verdict.valid || verdict.decision !== 'revoked') fail();
        return signed;
      }
      const signed = parsedFile(path, PERMIT);
      const verdict = inspectEnvelope(signed);
      if (!verdict.valid || !verdict.lab_shadow_eligible) fail();
      if (offExists(path)) fail(); // recheck after validation
      return signed;
    },

    /**
     * A verified signed revoke MUST increase the sequence. On success it
     * creates a durable OFF-intent before persisting the signed revoke.
     * On partial failure, OFF stays present and all GETs fail closed.
     */
    revokeWithSignedState(signedRevoke) {
      const path = root();
      if (offExists(path)) fail();
      const previous = parsedFile(path, PERMIT);
      const previousVerdict = inspectEnvelope(previous);
      const next = inspectEnvelope(signedRevoke);
      if (!previousVerdict.valid || !previousVerdict.lab_shadow_eligible
        || !next.valid || next.decision !== 'revoked'
        || next.sequence <= previousVerdict.sequence) fail();
      writeExclusive(path, OFF, VERSION + '\nOFF\n');
      writeExclusive(path, REVOCATION, JSON.stringify(signedRevoke));
      return { ...status(), lab_revoked: true, activation_authorized: false };
    },

    state() {
      const path = root();
      return {
        ...status(),
        lab_revocation_intent_present: offExists(path),
        // Even when unrevoked, this does NOT attest a production permit.
        activation_authorized: false,
      };
    },
  });
}
