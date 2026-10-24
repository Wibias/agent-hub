import { planP17QueryRuntime } from '../knowledge/design-references/scripts/query-runtime.mjs';
import {
  TAXONOMY,
  loadPatterns,
  loadRecords,
} from '../knowledge/design-references/scripts/lib.mjs';
import { executeP15Activation } from './p15-activation-executor.mjs';
import { fetchP10QuickCandidatePool } from './p10-runtime-client.mjs';
import { runP11RuntimeQuery } from './p11-runtime-router.mjs';
import {
  applyP17LocalActivation,
  readP17ActivationState,
  rollbackP17LocalActivation,
} from './p17-local-runtime-actuator.mjs';

const ACTIVATION_FLAG = 'REFERENCE_GRAPH_QUICK_RUNTIME';
const LEGACY_SOURCE = 'legacy-control';
const GRAPH_SOURCE = 'reference-graph';
const PROBE_PROFILES = ['quick', 'standard', 'deep'];
const PROBE_REQUEST = {
  surface: 'operator-control',
  platform: 'web-responsive',
  job: 'production runtime activation verification with status and controls',
  dimensions: 'ia,status,topology',
};

function requireSupabaseStore(store) {
  if (!store || typeof store.consumeActivationGrantNonceP16 !== 'function') {
    throw new TypeError('supabaseStore.consumeActivationGrantNonceP16 must be a function');
  }
  return store;
}

function requireDate(value, name) {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError(`${name} must be a valid Date`);
  }
  return value;
}

function normalizeProbeRouting(profile, routing) {
  if (!routing || typeof routing !== 'object' || Array.isArray(routing)) {
    throw new Error(`P17 ${profile} probe routing is invalid`);
  }
  const source = routing.authoritative_source;
  if (![LEGACY_SOURCE, GRAPH_SOURCE].includes(source)) {
    throw new Error(`P17 ${profile} probe routing source is invalid`);
  }

  if (profile !== 'quick') {
    if (source !== LEGACY_SOURCE) {
      throw new Error(`P17 ${profile} probe routing must remain legacy`);
    }
    return { authoritative_source: source };
  }

  if (source === GRAPH_SOURCE) {
    if (typeof routing.record_exact !== 'boolean' || typeof routing.pattern_exact !== 'boolean') {
      throw new Error('P17 quick probe routing parity is invalid');
    }
    return {
      authoritative_source: source,
      record_exact: routing.record_exact,
      pattern_exact: routing.pattern_exact,
    };
  }

  const recordExact = routing.record_exact ?? null;
  const patternExact = routing.pattern_exact ?? null;
  if (recordExact !== null && typeof recordExact !== 'boolean') {
    throw new Error('P17 quick probe record parity is invalid');
  }
  if (patternExact !== null && typeof patternExact !== 'boolean') {
    throw new Error('P17 quick probe pattern parity is invalid');
  }
  return {
    authoritative_source: source,
    record_exact: recordExact,
    pattern_exact: patternExact,
  };
}

async function runProductionProbeProfile({
  profile,
  graphMode,
  env,
  request,
  now,
  records,
  patterns,
}) {
  let fetchCandidatePool;
  if (profile === 'quick' && graphMode === 'graph') {
    const supabaseUrl = String(env.SUPABASE_URL || '').trim();
    const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY || '').trim();
    if (supabaseUrl && publishableKey) {
      const expectedDate = now.toISOString().slice(0, 10);
      fetchCandidatePool = () => fetchP10QuickCandidatePool({
        supabaseUrl,
        publishableKey,
        timeoutMs: 1500,
        expectedDate,
      });
    }
  }

  const { routing } = await runP11RuntimeQuery({
    records,
    patterns,
    request,
    graphMode,
    fetchCandidatePool,
    recordUsageEnabled: false,
    now,
  });
  return routing;
}

export async function probeP17Runtime({
  statePath,
  env = process.env,
  now = new Date(),
  runProfile,
} = {}) {
  requireDate(now, 'now');
  if (runProfile !== undefined && typeof runProfile !== 'function') {
    throw new TypeError('runProfile must be a function');
  }

  const projection = await planP17QueryRuntime({
    argv: [],
    env,
    statePath,
  });
  const graphMode = projection.env[ACTIVATION_FLAG] === 'graph' ? 'graph' : 'legacy';
  const records = runProfile ? null : loadRecords();
  const patterns = runProfile ? null : loadPatterns();
  const executeProfile = runProfile ?? ((input) => runProductionProbeProfile({
    ...input,
    records,
    patterns,
  }));

  const result = {};
  for (const profile of PROBE_PROFILES) {
    const request = {
      profile,
      limit: TAXONOMY.profiles[profile].default,
      ...PROBE_REQUEST,
    };
    const routing = await executeProfile({
      profile,
      graphMode,
      env: projection.env,
      request,
      now,
    });
    result[profile] = normalizeProbeRouting(profile, routing);
  }
  return result;
}

export async function executeP17Activation({
  p13Evidence,
  enrollmentManifest,
  grant,
  supabaseStore,
  statePath,
  probeRuntime,
  runtimeEnv = process.env,
  now = () => new Date(),
} = {}) {
  const store = requireSupabaseStore(supabaseStore);
  if (probeRuntime !== undefined && typeof probeRuntime !== 'function') {
    throw new TypeError('probeRuntime must be a function');
  }
  const resolvedProbe = probeRuntime ?? (() => probeP17Runtime({
    statePath,
    env: runtimeEnv,
  }));

  return executeP15Activation({
    p13Evidence,
    enrollmentManifest,
    grant,
    now,
    readActivationState: () => readP17ActivationState({ statePath }),
    consumeGrantNonce: (input) => store.consumeActivationGrantNonceP16(input),
    applyActivation: (input) => applyP17LocalActivation(input, { statePath }),
    probeRuntime: resolvedProbe,
    rollbackActivation: (input) => rollbackP17LocalActivation(input, { statePath }),
  });
}
