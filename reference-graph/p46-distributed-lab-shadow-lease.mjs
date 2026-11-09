import { createHash, createPublicKey, verify } from 'node:crypto';

const SHA256 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ENVELOPE_KEYS = ['schema_version', 'payload_json', 'signature_base64'];
const PAYLOAD_KEYS = [
  'schema_version', 'repository', 'repository_sha', 'project_ref',
  'lab_id', 'scope', 'profiles', 'sequence', 'decision',
  'issued_at', 'expires_at', 'default_off',
];
const TARGET = 'vrznfnxzlxaavpqbzbzd';
const LEASE_MAX_MS = 10000;
const SKEW_MS = 500;
const MAX_BYTES = 12000;

function exact(v, keys) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    && JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...keys].sort());
}
function time(v) {
  return typeof v === 'string' && TIME.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
}
function denied(reason) {
  return {
    schema_version: 'reference-graph.p46-signed-lab-lease-verdict.v1',
    valid: false, decision: 'blocked', reason, sequence: null,
    lab_shadow_eligible: false,
    owner_release_attested: false, production_graph_activated: false,
    activation_authorized: false, repository_default_graph_enabled: false,
  };
}

/**
 * Verify a short-lived Ed25519 state issued by a separately governed
 * LAB coordinator. The key fingerprint is caller-pinned but this function
 * cannot independently authenticate the trust store or grant release rights.
 */
export function evaluateP46SignedLabLease({
  envelope, publicKeyPem, publicKeySha256, expectedRepositorySha,
  expectedLabId, now = new Date(),
} = {}) {
  if (!exact(envelope, ENVELOPE_KEYS)
    || envelope.schema_version !== 'reference-graph.p46-signed-lab-envelope.v1'
    || typeof envelope.payload_json !== 'string'
    || Buffer.byteLength(envelope.payload_json, 'utf8') > MAX_BYTES
    || typeof envelope.signature_base64 !== 'string'
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.signature_base64)
    || typeof publicKeyPem !== 'string' || !SHA256.test(publicKeySha256 ?? '')
    || !SHA40.test(expectedRepositorySha ?? '')
    || typeof expectedLabId !== 'string' || !/^[A-Za-z0-9_-]{12,64}$/.test(expectedLabId)
    || !(now instanceof Date) || Number.isNaN(now.valueOf())) return denied('contract-invalid');

  let payload, key;
  try {
    key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return denied('key-invalid');
    const fingerprint = createHash('sha256')
      .update(key.export({ type: 'spki', format: 'der' })).digest('hex');
    if (fingerprint !== publicKeySha256) return denied('key-pin-mismatch');
    const signature = Buffer.from(envelope.signature_base64, 'base64');
    if (signature.length !== 64
      || !verify(null, Buffer.from(envelope.payload_json, 'utf8'), key, signature)) {
      return denied('signature-invalid');
    }
    payload = JSON.parse(envelope.payload_json);
  } catch { return denied('signature-invalid'); }

  if (!exact(payload, PAYLOAD_KEYS)
    || payload.schema_version !== 'reference-graph.p46-lab-lease.v1'
    || payload.repository !== 'Wibias/agent-hub'
    || payload.repository_sha !== expectedRepositorySha
    || payload.project_ref !== TARGET
    || payload.lab_id !== expectedLabId
    || payload.scope !== 'isolated-shadow-rehearsal'
    || !Array.isArray(payload.profiles) || payload.profiles.length !== 2
    || !payload.profiles.includes('standard') || !payload.profiles.includes('deep')
    || !Number.isSafeInteger(payload.sequence) || payload.sequence < 0
    || !['shadow-probe-only', 'revoked'].includes(payload.decision)
    || !time(payload.issued_at) || !time(payload.expires_at)
    || payload.default_off !== true) return denied('scope-invalid');

  const issued = Date.parse(payload.issued_at);
  const expires = Date.parse(payload.expires_at);
  const current = now.valueOf();
  if (expires <= issued || expires - issued > LEASE_MAX_MS
    || current < issued - SKEW_MS || current >= expires) return denied('lease-expired');

  return {
    schema_version: 'reference-graph.p46-signed-lab-lease-verdict.v1',
    valid: true, decision: payload.decision, reason: null,
    sequence: payload.sequence,
    // Only a lab probe may proceed. This is NEVER production authorization.
    lab_shadow_eligible: payload.decision === 'shadow-probe-only',
    owner_release_attested: false, production_graph_activated: false,
    activation_authorized: false, repository_default_graph_enabled: false,
  };
}

function labScope(scope) {
  return exact(scope, ['mode', 'profiles', 'default_off', 'production_route_wiring'])
    && scope.mode === 'isolated-shadow-rehearsal'
    && scope.default_off === true && scope.production_route_wiring === false
    && Array.isArray(scope.profiles) && scope.profiles.length === 2
    && scope.profiles.includes('standard') && scope.profiles.includes('deep');
}
function exactParity(r) {
  return r?.status === 'exact' && r.record_order_exact === true
    && r.pattern_order_exact === true
    && r.authoritative_source === 'legacy-control'
    && r.activation_authorized === false
    && r.graph_runtime_activated === false;
}

/**
 * Lab-only signed coordinator client. Every probe requires a fresh signed
 * coordinator read and a fresh read before accepting the result, plus
 * continuous bounded reads while pending. Partition/timeout/signature
 * failure/revoke causes a permanent local latch and aborts in-flight work.
 *
 * In production, a networked lease read is NOT a transactional fencing token.
 * No production route imports this module and the OFF latch is in-memory.
 */
export function createP46DistributedLabShadowGate({
  readSignedEnvelope, shadowProbe, scope,
  publicKeyPem, publicKeySha256, expectedRepositorySha, expectedLabId,
  pollMs = 50, readTimeoutMs = 250, clock = () => new Date(),
} = {}) {
  if (!labScope(scope) || typeof readSignedEnvelope !== 'function'
    || typeof shadowProbe !== 'function' || typeof clock !== 'function'
    || !Number.isInteger(pollMs) || pollMs < 10 || pollMs > 1000
    || !Number.isInteger(readTimeoutMs) || readTimeoutMs < 10 || readTimeoutMs > 2000) {
    throw new TypeError('P46 requires explicitly isolated lab scope and bounded coordinator');
  }
  let latched = false, reason = null, reads = 0;
  let lastSequence = -1;
  const active = new Set();

  const stop = why => {
    if (!latched) {
      latched = true;
      reason = why;
      for (const c of active) c.abort();
    }
  };
  function status() {
    return {
      schema_version: 'reference-graph.p46-distributed-lab-gate.v1',
      local_probe_latched_off: latched,
      reason, coordinator_reads: reads,
      highest_observed_sequence: lastSequence,
      cross_host_rollout_enabled: false,
      production_graph_activated: false,
      activation_authorized: false, repository_default_graph_enabled: false,
    };
  }
  async function readState() {
    if (latched) throw new Error('P46 latched off');
    const controller = new AbortController();
    let timer;
    try {
      // A read cannot wait indefinitely during a partition. Late results
      // cannot be accepted because the timeout aborts this controller.
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('P46 coordinator timeout'));
        }, readTimeoutMs);
      });
      reads++;
      const envelope = await Promise.race([
        Promise.resolve().then(() => readSignedEnvelope({ signal: controller.signal })),
        timeout,
      ]);
      if (controller.signal.aborted) throw new Error('P46 coordinator timeout');
      const verdict = evaluateP46SignedLabLease({
        envelope, publicKeyPem, publicKeySha256,
        expectedRepositorySha, expectedLabId, now: clock(),
      });
      if (!verdict.valid || !verdict.lab_shadow_eligible
        || verdict.sequence < lastSequence) {
        stop(verdict.valid && !verdict.lab_shadow_eligible
          ? 'signed-revocation' : 'invalid-or-stale-lease');
        throw new Error('P46 coordinator denied');
      }
      lastSequence = verdict.sequence;
      return verdict;
    } catch {
      stop(reason ?? 'coordinator-unavailable');
      throw new Error('P46 coordinator BLOCKED');
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    status,
    revokeLocal() { stop('local-revocation'); return status(); },
    async probe({ request, signal, ...inputs } = {}) {
      if (latched || !scope.profiles.includes(request?.profile)
        || signal !== undefined && !(signal instanceof AbortSignal)
        || signal?.aborted) throw new Error('P46 shadow BLOCKED');
      await readState();
      if (latched) throw new Error('P46 shadow BLOCKED');

      const controller = new AbortController();
      active.add(controller);
      let interval, rejectCancelled, polling = false;
      const cancelled = new Promise((_resolve, reject) => {
        rejectCancelled = reject;
      });
      const abort = () => rejectCancelled(new Error('P46 shadow cancelled'));
      controller.signal.addEventListener('abort', abort, { once: true });
      const onAbort = () => stop('external-revocation');
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) stop('external-revocation');

      interval = setInterval(() => {
        if (latched || polling) return;
        polling = true;
        readState().catch(() => {}).finally(() => { polling = false; });
      }, pollMs);
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => {
            if (latched || controller.signal.aborted) throw new Error('P46 revoked');
            return shadowProbe({ request, ...inputs, signal: controller.signal });
          }),
          cancelled,
        ]);
        if (latched || controller.signal.aborted) throw new Error('P46 revoked');
        await readState(); // not a durable fence, only a final fresh check
        if (latched || controller.signal.aborted || !exactParity(result)) {
          stop('parity-or-lease-failure');
          throw new Error('P46 shadow invalid');
        }
        return result;
      } catch {
        stop(reason ?? 'shadow-probe-failed');
        throw new Error('P46 shadow BLOCKED');
      } finally {
        clearInterval(interval);
        active.delete(controller);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  });
}
