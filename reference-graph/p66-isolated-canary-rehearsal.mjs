import { createHash } from 'node:crypto';
import { createP44IsolatedShadowRollbackHarness } from './p44-isolated-shadow-rollback.mjs';
import { runP11RuntimeQuery } from './p11-runtime-router.mjs';
import { fetchP30ProfileCandidateSnapshot } from './p30-profile-transport.mjs';
import { validateP40ReadOnlySourceWitness } from './p40-readonly-witness.mjs';
import { constructP66GraphPublicResult } from './p66-graph-public-output.mjs';

const PROJECT = 'vrznfnxzlxaavpqbzbzd';
const TARGET = `https://${PROJECT}.supabase.co/`;
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const PROFILES = ['standard', 'deep'];
const SCOPE_KEYS = [
  'mode', 'project_ref', 'source_commit_sha', 'profiles', 'default_off',
  'production_route_wiring', 'canary_percent', 'cohort_salt',
];
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function validScope(scope, sha) {
  return exact(scope, SCOPE_KEYS)
    && scope.mode === 'isolated-production-like-canary-rehearsal'
    && scope.project_ref === PROJECT && scope.source_commit_sha === sha
    && scope.default_off === true && scope.production_route_wiring === false
    && Array.isArray(scope.profiles) && scope.profiles.length > 0
    && scope.profiles.length <= 2
    && new Set(scope.profiles).size === scope.profiles.length
    && scope.profiles.every(profile => PROFILES.includes(profile))
    && Number.isInteger(scope.canary_percent)
    && scope.canary_percent >= 1 && scope.canary_percent <= 5
    && typeof scope.cohort_salt === 'string'
    && /^[a-f0-9]{32}$/.test(scope.cohort_salt);
}
function selected(key, scope) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return false;
  const hex = createHash('sha256').update(
    'reference-graph.p66-cohort.v1\\n' + scope.cohort_salt + '\\n' + key,
    'utf8',
  ).digest('hex');
  const fraction = Number.parseInt(hex.slice(0, 8), 16) / 0x100000000;
  return fraction < scope.canary_percent / 100;
}
function order(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((row, i) => row?.id === right[i]?.id);
}

/**
 * Server-only, isolated, actual Graph-output Canary -> Legacy rollback exercise.
 * No import into the public query/production P11 route, no usage writes and
 * no owner release authority. Each process starts OFF and a failure latches OFF.
 *
 * Unlike P65 shadow, a selected exact rehearsal returns a separate public
 * object constructed from P30 Graph-selected IDs, not the Legacy object's
 * records. All its bytes are first checked against the authentic P11 result.
 */
export function createP66CanaryRehearsal({
  checkoutSha,
  sourceWitnessJson,
  sourceWitnessSha256,
  serviceKey,
  fetchImpl = globalThis.fetch,
  fetchCandidates = fetchP30ProfileCandidateSnapshot,
  graphOutput = constructP66GraphPublicResult,
  legacyRunner = runP11RuntimeQuery,
  timeoutMs = 5000,
} = {}) {
  if (!COMMIT.test(checkoutSha ?? '') || typeof fetchImpl !== 'function'
    || typeof fetchCandidates !== 'function' || typeof graphOutput !== 'function'
    || typeof legacyRunner !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
    throw new TypeError('P66 invalid rehearsal configuration');
  }

  // Request-object identity is private to each invocation; concurrent runs
  // may share the caller's request without cross-contaminating results.
  const baseline = new WeakMap();
  const graphPayload = new WeakMap();
  const harness = createP44IsolatedShadowRollbackHarness({
    timeoutMs,
    legacyRunner: async args => {
      const control = await legacyRunner(args);
      baseline.set(args.request, control);
      return control;
    },
    shadowProbe: async ({ records, patterns, request, now, signal }) => {
      if (signal.aborted) throw new Error('rehearsal aborted');
      if (typeof sourceWitnessJson !== 'string' || !SHA.test(sourceWitnessSha256 ?? '')
        || createHash('sha256').update(sourceWitnessJson).digest('hex')
          !== sourceWitnessSha256 || typeof serviceKey !== 'string'
        || !/^sb_secret_[A-Za-z0-9_-]+$/.test(serviceKey)) {
        throw new Error('invalid protected source context');
      }
      const witness = validateP40ReadOnlySourceWitness(
        JSON.parse(sourceWitnessJson), { asOf: now.toISOString() },
      );
      const remote = await fetchCandidates({
        supabaseUrl: TARGET, serviceKey, accessMode: 'server',
        expectedDate: witness.snapshot_date,
        expectedCandidateCount: witness.expected_candidate_count,
        expectedCandidateIdSetSha256: witness.expected_candidate_id_set_sha256,
        asOf: now.toISOString(), timeoutMs,
        fetchImpl: (url, options) => {
          if (signal.aborted) throw new Error('revoked');
          const combined = options?.signal
            ? AbortSignal.any([options.signal, signal]) : signal;
          return fetchImpl(url, { ...options, signal: combined });
        },
      });
      if (signal.aborted || remote?.transport?.refreshed_at !== witness.refreshed_at) {
        throw new Error('revoked or snapshot drift');
      }
      const actual = graphOutput({
        candidates: remote.candidates, records, patterns, request, now,
      });
      if (signal.aborted) throw new Error('revoked');
      const control = baseline.get(request)?.result;
      const recordExact = order(actual?.records, control?.records);
      const patternExact = order(actual?.patterns, control?.patterns);
      const publicExact = control && JSON.stringify(actual) === JSON.stringify(control);
      if (publicExact && recordExact && patternExact) graphPayload.set(request, actual);
      return {
        status: publicExact && recordExact && patternExact ? 'exact' : 'mismatch',
        record_order_exact: recordExact,
        pattern_order_exact: patternExact,
        authoritative_source: 'legacy-control',
        graph_runtime_activated: false,
        activation_authorized: false,
      };
    },
  });

  let scope = null;
  const status = () => ({
    ...harness.status(),
    schema_version: 'reference-graph.p66-isolated-canary-rehearsal.v1',
    source_commit_sha: checkoutSha,
    isolated_only: true,
    production_graph_activated: false,
    production_rollback_performed: false,
  });
  async function legacy(args, reason) {
    const r = await legacyRunner({
      ...args, graphMode: 'legacy', recordUsageEnabled: false,
    });
    if (r?.routing?.authoritative_source !== 'legacy-control'
      || r.routing.attempted !== false) throw new Error('P66 invalid Legacy fallback');
    return {
      ...r, canary: { status: reason, selected: false, ...status() },
    };
  }

  return Object.freeze({
    status,
    armForRehearsal(grant) {
      if (!validScope(grant, checkoutSha)) {
        throw new TypeError('P66 exact isolated scope rejected');
      }
      harness.armForRehearsal({
        mode: 'isolated-shadow-rehearsal', profiles: [...grant.profiles],
        default_off: true, production_route_wiring: false,
      });
      scope = { ...grant, profiles: [...grant.profiles] };
      return status();
    },
    revokeForRehearsal: () => harness.revokeForRehearsal(),
    async run({ records, patterns, request, requestKey, now = new Date() } = {}) {
      if (!PROFILES.includes(request?.profile)) {
        throw new TypeError('P66 accepts Standard/Deep only; Quick is untouched');
      }
      const args = { records, patterns, request, now };
      if (status().rehearsal_state !== 'armed' || !scope
        || !scope.profiles.includes(request.profile)) return legacy(args, 'off');
      if (!selected(requestKey, scope)) return legacy(args, 'not-selected');

      // Clone the request to give concurrent calls independent WeakMap slots.
      const perCallRequest = { ...request };
      const result = await harness.run({
        records, patterns, request: perCallRequest, now,
        recordUsageEnabled: false,
      });
      const built = graphPayload.get(perCallRequest);
      baseline.delete(perCallRequest);
      graphPayload.delete(perCallRequest);
      if (result.shadow.status === 'exact'
        && harness.status().rehearsal_state === 'armed'
        && built && JSON.stringify(built) === JSON.stringify(result.result)) {
        return {
          result: built,
          routing: {
            requested_mode: 'graph', attempted: true,
            authoritative_source: 'reference-graph',
            record_exact: true, pattern_exact: true, reason: null,
          },
          canary: {
            status: 'graph', selected: true, ...status(),
          },
        };
      }
      // If the final byte comparison unexpectedly changed, force OFF before
      // any subsequent request; never release an unverified Graph response.
      if (result.shadow.status === 'exact' && harness.status().rehearsal_state === 'armed') {
        harness.revokeForRehearsal();
      }
      return {
        result: result.result, routing: result.routing,
        canary: { status: 'legacy-fallback', selected: true, ...status() },
      };
    },
  });
}
