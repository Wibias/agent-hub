import { performance } from 'node:perf_hooks';

import { probeP17Runtime } from './p17-activation-runner.mjs';
import { readP17ActivationState } from './p17-local-runtime-actuator.mjs';

export const P19_PRODUCTION_URL = 'https://vrznfnxzlxaavpqbzbzd.supabase.co';
export const P19_PRODUCTION_PROJECT_REF = 'vrznfnxzlxaavpqbzbzd';
export const P19_HEALTH_SAMPLE_SCHEMA = 'reference-graph.p19-production-health-sample.v1';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError('now must return a valid Date');
  }
  return value;
}

function requireMonotonic(value) {
  if (!Number.isFinite(value)) {
    throw new TypeError('monotonicNow must return a finite number');
  }
  return value;
}

function sanitizeRouting(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('P19 production probe routing is invalid');
  }
  const quick = value.quick;
  const standard = value.standard;
  const deep = value.deep;
  if (!quick || typeof quick !== 'object' || Array.isArray(quick)
      || !standard || typeof standard !== 'object' || Array.isArray(standard)
      || !deep || typeof deep !== 'object' || Array.isArray(deep)) {
    throw new Error('P19 production probe routing is invalid');
  }
  return {
    quick: {
      authoritative_source: quick.authoritative_source ?? null,
      record_exact: quick.record_exact ?? null,
      pattern_exact: quick.pattern_exact ?? null,
    },
    standard: {
      authoritative_source: standard.authoritative_source ?? null,
    },
    deep: {
      authoritative_source: deep.authoritative_source ?? null,
    },
  };
}

function stateBlockers(state) {
  const blockers = [];
  if (state?.production_source !== 'reference-graph') {
    blockers.push('production-source-not-reference-graph');
  }
  if (state?.quick_graph_enabled !== true) {
    blockers.push('quick-graph-disabled');
  }
  if (state?.repository_default_graph_enabled !== false) {
    blockers.push('repository-default-graph-enabled');
  }
  return blockers;
}

function routingBlockers(routing) {
  const blockers = [];
  if (routing.quick.authoritative_source !== 'reference-graph') {
    blockers.push('quick-route-not-reference-graph');
  }
  if (routing.quick.record_exact !== true) {
    blockers.push('quick-record-parity-failed');
  }
  if (routing.quick.pattern_exact !== true) {
    blockers.push('quick-pattern-parity-failed');
  }
  if (routing.standard.authoritative_source !== 'legacy-control') {
    blockers.push('standard-route-not-legacy');
  }
  if (routing.deep.authoritative_source !== 'legacy-control') {
    blockers.push('deep-route-not-legacy');
  }
  return blockers;
}

export function runtimeEnvWithoutElevatedSupabaseCredentialsP19(env = process.env) {
  const runtimeEnv = { ...env };
  delete runtimeEnv.SUPABASE_SECRET_KEY;
  delete runtimeEnv.SUPABASE_SERVICE_ROLE_KEY;
  return runtimeEnv;
}

export async function sampleP19ProductionHealth({
  env = process.env,
  statePath,
  now = () => new Date(),
  monotonicNow = () => performance.now(),
  readState = readP17ActivationState,
  probeRuntime = probeP17Runtime,
} = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof monotonicNow !== 'function') throw new TypeError('monotonicNow must be a function');
  if (typeof readState !== 'function') throw new TypeError('readState must be a function');
  if (typeof probeRuntime !== 'function') throw new TypeError('probeRuntime must be a function');

  const sampledDate = requireDate(now());
  const state = await readState({ statePath });
  const base = {
    schema_version: P19_HEALTH_SAMPLE_SCHEMA,
    sampled_at: sampledDate.toISOString(),
    target_project_ref: P19_PRODUCTION_PROJECT_REF,
    production_source: state?.production_source ?? null,
    quick_graph_enabled: state?.quick_graph_enabled ?? null,
    repository_default_graph_enabled: state?.repository_default_graph_enabled ?? null,
  };

  const target = typeof env?.SUPABASE_URL === 'string'
    ? env.SUPABASE_URL.trim().replace(/\/+$/, '')
    : '';
  if (target !== P19_PRODUCTION_URL) {
    return {
      ...base,
      probe_duration_ms: 0,
      routing: null,
      healthy: false,
      blockers: ['wrong-supabase-target'],
    };
  }
  if (!nonEmpty(env?.SUPABASE_PUBLISHABLE_KEY)) {
    return {
      ...base,
      probe_duration_ms: 0,
      routing: null,
      healthy: false,
      blockers: ['missing-publishable-key'],
    };
  }

  const runtimeEnv = runtimeEnvWithoutElevatedSupabaseCredentialsP19(env);
  const start = requireMonotonic(monotonicNow());
  try {
    const rawRouting = await probeRuntime({
      statePath,
      env: runtimeEnv,
      now: sampledDate,
    });
    const end = requireMonotonic(monotonicNow());
    const routing = sanitizeRouting(rawRouting);
    const blockers = [
      ...stateBlockers(state),
      ...routingBlockers(routing),
    ];
    return {
      ...base,
      probe_duration_ms: Math.max(0, end - start),
      routing,
      healthy: blockers.length === 0,
      blockers,
    };
  } catch {
    const end = requireMonotonic(monotonicNow());
    const blockers = [
      ...stateBlockers(state),
      'probe-error',
    ];
    return {
      ...base,
      probe_duration_ms: Math.max(0, end - start),
      routing: null,
      healthy: false,
      blockers,
    };
  }
}
