import { auditP41ProfileServerShadow } from './p41-profile-server-shadow.mjs';
import { createP44IsolatedShadowRollbackHarness } from './p44-isolated-shadow-rollback.mjs';
import { runP11RuntimeQuery } from './p11-runtime-router.mjs';

const PROJECT = 'vrznfnxzlxaavpqbzbzd';
const TARGET = `https://${PROJECT}.supabase.co/`;
const COMMIT = /^[a-f0-9]{40}$/;
const PROFILES = ['standard', 'deep'];
const SCOPE_KEYS = [
  'mode', 'project_ref', 'source_commit_sha', 'profiles',
  'default_off', 'production_route_wiring',
];

function validScope(scope, checkoutSha) {
  return scope && typeof scope === 'object' && !Array.isArray(scope)
    && JSON.stringify(Object.keys(scope).sort()) === JSON.stringify([...SCOPE_KEYS].sort())
    && scope.mode === 'isolated-server-shadow-rehearsal'
    && scope.project_ref === PROJECT
    && scope.source_commit_sha === checkoutSha
    && scope.default_off === true
    && scope.production_route_wiring === false
    && Array.isArray(scope.profiles)
    && scope.profiles.length > 0 && scope.profiles.length <= 2
    && new Set(scope.profiles).size === scope.profiles.length
    && scope.profiles.every(profile => PROFILES.includes(profile));
}

/**
 * An isolated, default-OFF server-side Standard/Deep shadow adapter.
 * This is NOT a production router and never makes Graph authoritative.
 * A scoped rehearsal may issue P41's protected GET; P44 owns cancellation,
 * the latched OFF switch, and authentic P11 Legacy public output.
 * Recreating the adapter starts OFF, never retaining a prior rehearsal grant.
 */
export function createP65ServerShadowAdapter({
  checkoutSha,
  sourceWitnessJson,
  sourceWitnessSha256,
  serviceKey,
  fetchImpl = globalThis.fetch,
  auditShadow = auditP41ProfileServerShadow,
  legacyRunner = runP11RuntimeQuery,
  timeoutMs = 5000,
} = {}) {
  if (!COMMIT.test(checkoutSha ?? '')
    || typeof fetchImpl !== 'function'
    || typeof auditShadow !== 'function'
    || typeof legacyRunner !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
    throw new TypeError('P65 invalid isolated server adapter configuration');
  }

  const harness = createP44IsolatedShadowRollbackHarness({
    legacyRunner, timeoutMs,
    shadowProbe: ({ records, patterns, request, now, signal }) =>
      auditShadow({
        records, patterns, request, now, signal,
        sourceWitnessJson, sourceWitnessSha256,
        serviceKey, supabaseUrl: TARGET, accessMode: 'server',
        fetchImpl, timeoutMs,
      }),
  });

  return Object.freeze({
    status: () => ({
      ...harness.status(),
      schema_version: 'reference-graph.p65-server-shadow-adapter.v1',
      source_commit_sha: checkoutSha,
      shadow_only: true,
    }),
    armForRehearsal(scope) {
      if (!validScope(scope, checkoutSha)) {
        throw new TypeError('P65 isolated shadow scope rejected');
      }
      return harness.armForRehearsal({
        mode: 'isolated-shadow-rehearsal',
        profiles: [...scope.profiles],
        default_off: true,
        production_route_wiring: false,
      });
    },
    revokeForRehearsal: () => harness.revokeForRehearsal(),
    run({ records, patterns, request, now = new Date() } = {}) {
      // Must never intercept the existing Quick runtime or perform usage writes.
      if (!PROFILES.includes(request?.profile)) {
        throw new TypeError('P65 accepts Standard/Deep requests only');
      }
      return harness.run({
        records, patterns, request, now, recordUsageEnabled: false,
      });
    },
  });
}
