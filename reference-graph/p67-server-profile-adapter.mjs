import { createHash, createHmac, createPublicKey, randomBytes, verify } from 'node:crypto';
import { runP11RuntimeQuery } from './p11-runtime-router.mjs';
import { fetchP30ProfileCandidateSnapshot } from './p30-profile-transport.mjs';
import { validateP40ReadOnlySourceWitness } from './p40-readonly-witness.mjs';
import { constructP66GraphPublicResult } from './p66-graph-public-output.mjs';

const PROJECT = 'vrznfnxzlxaavpqbzbzd';
const TARGET = `https://${PROJECT}.supabase.co/`;
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const HEX32 = /^[a-f0-9]{32}$/;
const PROFILES = ['standard', 'deep'];
const STATE_KEYS = [
  'schema_version', 'repository_sha', 'project_ref', 'nonce', 'generation',
  'status', 'profiles', 'canary_percent', 'cohort_salt', 'issued_at', 'expires_at',
];

function sameKeys(value, names) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...names].sort());
}
function requireClock(clock) {
  const d = clock();
  if (!(d instanceof Date) || !Number.isFinite(d.valueOf())) throw Error('P67 clock invalid');
  return d.valueOf();
}

/**
 * Authenticating a fresh, nonce-bound shared state prevents arbitrary local
 * env flags, stale cached permits and unauthenticated callers from enabling
 * Graph. The trusted public-key pin MUST be provisioned separately by the host
 * from the owner-approved coordinator, not supplied by an HTTP user.
 */
export function createP67SharedStateVerifier({
  repositorySha, trustedPublicKeyPem, trustedPublicKeySha256,
  clock = () => new Date(),
} = {}) {
  if (!HEX40.test(repositorySha ?? '') || !HEX64.test(trustedPublicKeySha256 ?? '')) {
    throw new TypeError('P67 trusted configuration missing');
  }
  let key;
  try {
    key = createPublicKey(trustedPublicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519'
      || createHash('sha256').update(key.export({ format: 'der', type: 'spki' }))
        .digest('hex') !== trustedPublicKeySha256) throw Error('pin');
  } catch {
    throw new TypeError('P67 trusted signing key rejected');
  }

  return Object.freeze({
    verify(envelope, nonce) {
      if (!sameKeys(envelope, ['payload_json', 'signature_base64'])
        || typeof envelope.payload_json !== 'string'
        || Buffer.byteLength(envelope.payload_json) > 4096
        || typeof envelope.signature_base64 !== 'string'
        || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature_base64)
        || !HEX32.test(nonce ?? '')) throw Error('P67 shared state invalid');
      const sig = Buffer.from(envelope.signature_base64, 'base64');
      if (sig.length !== 64 || sig.toString('base64') !== envelope.signature_base64
        || !verify(null, Buffer.from(envelope.payload_json), key, sig)) {
        throw Error('P67 shared signature invalid');
      }
      let state;
      try { state = JSON.parse(envelope.payload_json); } catch { throw Error('P67 shared JSON invalid'); }
      if (!sameKeys(state, STATE_KEYS)
        || state.schema_version !== 'reference-graph.p67-shared-state.v1'
        || state.repository_sha !== repositorySha || state.project_ref !== PROJECT
        || state.nonce !== nonce
        || !Number.isSafeInteger(state.generation) || state.generation < 1
        || !['off', 'canary'].includes(state.status)
        || !Array.isArray(state.profiles) || state.profiles.length > 2
        || new Set(state.profiles).size !== state.profiles.length
        || state.profiles.some(p => !PROFILES.includes(p))
        || !Number.isInteger(state.canary_percent) || state.canary_percent < 0
        || state.canary_percent > 5 || !HEX32.test(state.cohort_salt ?? '')
        || typeof state.issued_at !== 'string' || typeof state.expires_at !== 'string') {
        throw Error('P67 shared state contract invalid');
      }
      const issued = Date.parse(state.issued_at), expires = Date.parse(state.expires_at);
      const current = requireClock(clock);
      if (!Number.isFinite(issued) || !Number.isFinite(expires)
        || new Date(issued).toISOString() !== state.issued_at
        || new Date(expires).toISOString() !== state.expires_at
        || issued > current + 500 || current - issued > 5000
        || expires <= current || expires - issued > 10000
        || (state.status === 'canary'
          && (state.profiles.length === 0 || state.canary_percent < 1))
        || (state.status === 'off' && state.canary_percent !== 0)) {
        throw Error('P67 shared state stale or unsupported');
      }
      return state;
    },
  });
}

/**
 * A minimal server-only HTTPS GET adapter. The bearer token is an operator-
 * provisioned read credential, NEVER a browser header or CLI argument.
 * Signed per-request challenges authenticate the returned state separately
 * from transport TLS. No redirects, writes or cached responses.
 */
export function createP67HttpsStateReader({
  endpoint, readToken, fetchImpl = globalThis.fetch, timeoutMs = 1200,
} = {}) {
  let url;
  try { url = new URL(endpoint); } catch { throw new TypeError('P67 state URL invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password
    || url.search || url.hash || !url.hostname
    || typeof readToken !== 'string'
    || !/^[A-Za-z0-9_-]{32,256}$/.test(readToken)
    || typeof fetchImpl !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 3000) {
    throw new TypeError('P67 state transport configuration rejected');
  }
  return async ({ nonce, signal } = {}) => {
    if (!HEX32.test(nonce ?? '')) throw Error('P67 challenge invalid');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(url.toString(), {
            method: 'GET', redirect: 'error', cache: 'no-store',
            headers: { Authorization: `Bearer ${readToken}`,
              'X-P67-Nonce': nonce, 'Cache-Control': 'no-store' },
            signal: controller.signal,
          });
          if (!response || response.status !== 200 || !response.ok) throw Error('P67 state HTTP failed');
          const raw = await response.text();
          if (typeof raw !== 'string' || Buffer.byteLength(raw) > 8192) {
            throw Error('P67 state response too large');
          }
          return JSON.parse(raw);
        })(),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(Error('P67 state timeout')); }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}

function cohort(requestKey, state) {
  if (typeof requestKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(requestKey)) return false;
  const h = createHmac('sha256', Buffer.from(state.cohort_salt, 'hex'))
    .update(requestKey).digest();
  return h.readUInt32BE(0) / 0x100000000 < state.canary_percent / 100;
}

/**
 * Server-host integration point. No public CLI import or automatic activation.
 * Every eligible Graph call requires a trusted, challenge-signed state from
 * the shared coordinator before the P30 GET and again before returning.
 * Coordinator failures / revocation fail closed. Process-local latch is a
 * secondary safeguard; revocation durability belongs to the shared backend.
 */
export function createP67ServerProfileAdapter({
  repositorySha, trustedPublicKeyPem, trustedPublicKeySha256,
  readSharedState, getWitness, serviceKey, fetchImpl = globalThis.fetch,
  legacyRunner = runP11RuntimeQuery,
  fetchCandidates = fetchP30ProfileCandidateSnapshot,
  graphOutput = constructP66GraphPublicResult,
  clock = () => new Date(), timeoutMs = 5000, statePollMs = 250,
} = {}) {
  const verifier = createP67SharedStateVerifier({
    repositorySha, trustedPublicKeyPem, trustedPublicKeySha256, clock,
  });
  if (typeof readSharedState !== 'function' || typeof getWitness !== 'function'
    || typeof serviceKey !== 'string' || !serviceKey.startsWith('sb_secret_')
    || typeof fetchImpl !== 'function' || typeof legacyRunner !== 'function'
    || typeof fetchCandidates !== 'function' || typeof graphOutput !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000
    || !Number.isInteger(statePollMs) || statePollMs < 50 || statePollMs > 1000) {
    throw new TypeError('P67 server-only prerequisites missing');
  }
  let latched = false, generationFloor = 0, lastReason = 'default-off';
  async function state(signal) {
    const nonce = randomBytes(16).toString('hex');
    const signed = await readSharedState({ nonce, signal });
    const current = verifier.verify(signed, nonce);
    if (current.generation < generationFloor) throw Error('P67 coordinator generation rollback');
    generationFloor = current.generation;
    return current;
  }
  function fallback(control, reason) {
    return { ...control, canary: {
      status: 'legacy', reason, shared_state_checked: reason !== 'not-configured',
      local_kill_switch_latched: latched,
      production_default_graph_enabled: false,
    } };
  }
  const status = () => ({
    schema_version: 'reference-graph.p67-server-profile-adapter.v1',
    local_kill_switch_latched: latched, last_reason: lastReason,
    production_default_graph_enabled: false,
  });
  return Object.freeze({
    status,
    revokeLocally() { latched = true; lastReason = 'manual-revoke'; return status(); },
    async run({
      records, patterns, request, requestKey, now = clock(),
      recordUsageEnabled = false, recordUsageFn, usageLogPath,
    } = {}) {
      if (!PROFILES.includes(request?.profile)) {
        throw new TypeError('P67 accepts Standard/Deep only; Quick stays on existing route');
      }
      // Public output and usage originate from one authentic P11 call; on
      // failure we return this exact result, never re-run P11 or log twice.
      const control = await legacyRunner({
        records, patterns, request, now, graphMode: 'legacy',
        recordUsageEnabled, recordUsageFn, usageLogPath,
      });
      if (control?.routing?.authoritative_source !== 'legacy-control'
        || control.routing.attempted !== false) throw Error('P67 baseline invalid');
      if (latched) return fallback(control, lastReason);
      let initial;
      try {
        initial = await state();
        if (initial.status !== 'canary' || !initial.profiles.includes(request.profile)) {
          return fallback(control, 'shared-off');
        }
      } catch {
        latched = true; lastReason = 'coordinator-unavailable';
        return fallback(control, lastReason);
      }
      if (!cohort(requestKey, initial)) return fallback(control, 'not-selected');

      const controller = new AbortController();
      let stopped = false, checking = false, pollPromise = null;
      const fail = reason => {
        latched = true; lastReason = reason; controller.abort();
      };
      const poll = () => {
        if (checking || stopped || latched) return;
        checking = true;
        pollPromise = state(controller.signal).then(next => {
          if (!stopped && (next.status !== 'canary'
            || next.generation !== initial.generation
            || next.cohort_salt !== initial.cohort_salt
            || next.canary_percent !== initial.canary_percent
            || !next.profiles.includes(request.profile))) fail('shared-revoked');
        }).catch(() => { if (!stopped) fail('coordinator-unavailable'); })
          .finally(() => { checking = false; });
      };
      const timer = setInterval(poll, statePollMs);
      timer.unref?.();
      try {
        const pin = await getWitness();
        if (!pin || typeof pin.json !== 'string' || !HEX64.test(pin.sha256 ?? '')
          || createHash('sha256').update(pin.json).digest('hex') !== pin.sha256) {
          throw Error('P67 witness invalid');
        }
        const witness = validateP40ReadOnlySourceWitness(JSON.parse(pin.json), {
          asOf: now.toISOString(),
        });
        // A fetch adapter may ignore AbortSignal. Race its result against
        // revocation so a late response can never restore Graph authority.
        const cancelled = new Promise((_resolve, reject) => {
          if (controller.signal.aborted) reject(Error('P67 request revoked'));
          else controller.signal.addEventListener('abort',
            () => reject(Error('P67 request revoked')), { once: true });
        });
        const remote = await Promise.race([fetchCandidates({
          supabaseUrl: TARGET, serviceKey, accessMode: 'server',
          expectedDate: witness.snapshot_date,
          expectedCandidateCount: witness.expected_candidate_count,
          expectedCandidateIdSetSha256: witness.expected_candidate_id_set_sha256,
          asOf: now.toISOString(), timeoutMs,
          fetchImpl: (url, options) => fetchImpl(url, {
            ...options, signal: options?.signal
              ? AbortSignal.any([options.signal, controller.signal])
              : controller.signal,
          }),
        }), cancelled]);
        if (latched || controller.signal.aborted
          || remote?.transport?.refreshed_at !== witness.refreshed_at) {
          throw Error('P67 source or shared state changed');
        }
        const graph = graphOutput({
          candidates: remote.candidates, records, patterns, request, now,
        });
        if (JSON.stringify(graph) !== JSON.stringify(control.result)) {
          throw Error('P67 complete public parity failed');
        }
        // Stop background poll, then require one new challenge from the
        // shared coordinator before allowing the candidate-built result.
        stopped = true;
        clearInterval(timer);
        if (pollPromise) await pollPromise;
        if (latched) throw Error('P67 revoked during validation');
        const final = await state();
        if (final.status !== 'canary' || final.generation !== initial.generation
          || final.cohort_salt !== initial.cohort_salt
          || final.canary_percent !== initial.canary_percent
          || !final.profiles.includes(request.profile) || latched) {
          throw Error('P67 shared state revoked before response');
        }
        return {
          result: graph, routing: {
            requested_mode: 'graph', attempted: true,
            authoritative_source: 'reference-graph',
            record_exact: true, pattern_exact: true, reason: null,
          },
          canary: {
            status: 'graph', reason: null, shared_state_checked: true,
            local_kill_switch_latched: false,
            production_default_graph_enabled: false,
          },
        };
      } catch {
        fail(latched ? lastReason : 'canary-failure');
        return fallback(control, lastReason);
      } finally {
        stopped = true;
        clearInterval(timer);
      }
    },
  });
}
