import { performance } from 'node:perf_hooks';

import { probeP17Runtime } from './p17-activation-runner.mjs';
import { readP17ActivationState } from './p17-local-runtime-actuator.mjs';

export const P19_PRODUCTION_URL = 'https://vrznfnxzlxaavpqbzbzd.supabase.co';
export const P19_PRODUCTION_PROJECT_REF = 'vrznfnxzlxaavpqbzbzd';
export const P19_HEALTH_SAMPLE_SCHEMA = 'reference-graph.p19-production-health-sample.v1';
export const P19_ATTESTATION_SCHEMA = 'reference-graph.p19-activation-attestation.v1';
export const P19_READINESS_SCHEMA = 'reference-graph.p19-promotion-readiness.v1';
export const P19_P18_EVIDENCE_SHA256 = '5b86bd3aaa6a87399006126b56cb0db84212c48c8135acae9e77bd8d69dd5ba9';

const P18_RECEIPT_SCHEMA = 'reference-graph.p18-production-activation-receipt.v1';
const P18_AUTHORITY_SHA256 = 'e3554b76b8add430a6e0276e97c9cb16702f6af57764db53445d00b49f6e965c';
const P18_REQUEST_HASH = 'ed31630f9bda1362f42e747a6366d8504d17638b8ba458228db6fec5a2074ce7';
const P18_GRANT_PAYLOAD_HASH = 'e2ae9a9608590b1256573b6770a226daf4b38ae0440027570f90752ec6caa465';
const REQUIRED_WINDOW_HOURS = 24;
const REQUIRED_SAMPLES = 24;
const ALLOWED_MAX_GAP_MINUTES = 90;

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

function canonicalUtc(value) {
  if (!nonEmpty(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
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

function validP18Evidence(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.schema_version === P18_RECEIPT_SCHEMA
    && value.production_target?.project_ref === P19_PRODUCTION_PROJECT_REF
    && value.production_target?.url === P19_PRODUCTION_URL
    && value.authority_sha256 === P18_AUTHORITY_SHA256
    && value.request_hash === P18_REQUEST_HASH
    && value.grant_payload_hash === P18_GRANT_PAYLOAD_HASH
    && value.activation_receipt?.status === 'activated'
    && value.activation_receipt?.grant_consumed === true
    && value.activation_receipt?.activation_performed === true
    && value.activation_receipt?.rollback_performed === false
    && value.activation_receipt?.production_source === 'reference-graph'
    && value.activation_receipt?.blocker === null
    && value.post_activation_status?.production_source === 'reference-graph'
    && value.post_activation_status?.quick_graph_enabled === true
    && value.post_activation_status?.repository_default_graph_enabled === false;
}

function requireAttestationResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Number.isInteger(value.matching_count) || value.matching_count < 0
      || !Number.isInteger(value.total_count) || value.total_count < 0
      || typeof value.exact_match !== 'boolean') {
    throw new Error('P19 activation attestation response is malformed');
  }
  return value;
}

function requireAttestationReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.schema_version !== P19_ATTESTATION_SCHEMA
      || value.target_project_ref !== P19_PRODUCTION_PROJECT_REF
      || value.p18_evidence_sha256 !== P19_P18_EVIDENCE_SHA256
      || value.authority_sha256 !== P18_AUTHORITY_SHA256
      || value.request_hash !== P18_REQUEST_HASH
      || value.grant_payload_hash !== P18_GRANT_PAYLOAD_HASH
      || !canonicalUtc(value.observed_at)
      || !Number.isInteger(value.matching_count) || value.matching_count < 0
      || !Number.isInteger(value.total_count) || value.total_count < 0
      || typeof value.exact_match !== 'boolean'
      || typeof value.healthy !== 'boolean'
      || !Array.isArray(value.blockers)) {
    throw new Error('P19 activation attestation receipt is malformed');
  }
  return value;
}

function requireHealthSample(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.schema_version !== P19_HEALTH_SAMPLE_SCHEMA
      || value.target_project_ref !== P19_PRODUCTION_PROJECT_REF
      || !canonicalUtc(value.sampled_at)
      || typeof value.healthy !== 'boolean'
      || !Array.isArray(value.blockers)
      || typeof value.repository_default_graph_enabled !== 'boolean') {
    if (!canonicalUtc(value?.sampled_at)) {
      throw new Error('P19 sample sampled_at must be canonical UTC');
    }
    throw new Error('P19 production health sample is malformed');
  }
  return {
    value,
    time: new Date(value.sampled_at).valueOf(),
  };
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

export async function attestP19ActivationConsumption({
  p18Evidence,
  store,
  now = () => new Date(),
} = {}) {
  if (!validP18Evidence(p18Evidence)) {
    throw new Error('P18 production activation evidence is invalid');
  }
  if (!store || typeof store.attestActivationConsumptionP19 !== 'function') {
    throw new TypeError('store.attestActivationConsumptionP19 must be a function');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  const observedAt = requireDate(now()).toISOString();
  const response = requireAttestationResponse(await store.attestActivationConsumptionP19({
    grant_payload_hash: P18_GRANT_PAYLOAD_HASH,
    request_hash: P18_REQUEST_HASH,
    authority_hash: P18_AUTHORITY_SHA256,
  }));
  const blockers = [];
  if (response.matching_count !== 1) blockers.push('matching-count-not-one');
  if (response.total_count !== 1) blockers.push('unexpected-ledger-total');
  if (response.exact_match !== true) blockers.push('exact-match-false');

  return {
    schema_version: P19_ATTESTATION_SCHEMA,
    observed_at: observedAt,
    p18_evidence_sha256: P19_P18_EVIDENCE_SHA256,
    target_project_ref: P19_PRODUCTION_PROJECT_REF,
    authority_sha256: P18_AUTHORITY_SHA256,
    request_hash: P18_REQUEST_HASH,
    grant_payload_hash: P18_GRANT_PAYLOAD_HASH,
    matching_count: response.matching_count,
    total_count: response.total_count,
    exact_match: response.exact_match,
    healthy: blockers.length === 0,
    blockers,
  };
}

export function evaluateP19PromotionReadiness({
  attestation,
  samples,
} = {}) {
  const receipt = requireAttestationReceipt(attestation);
  if (!Array.isArray(samples)) throw new TypeError('samples must be an array');
  const normalized = samples.map(requireHealthSample).sort((left, right) => left.time - right.time);
  const observedSamples = normalized.length;
  const healthySamples = normalized.filter(({ value }) => value.healthy === true).length;
  const firstTime = observedSamples > 0 ? normalized[0].time : null;
  const lastTime = observedSamples > 0 ? normalized[observedSamples - 1].time : null;
  const observedWindowHours = observedSamples > 1
    ? (lastTime - firstTime) / 3_600_000
    : 0;
  let observedMaxGapMinutes = 0;
  let duplicateTimestamp = false;
  for (let index = 1; index < normalized.length; index += 1) {
    const gapMs = normalized[index].time - normalized[index - 1].time;
    if (gapMs === 0) duplicateTimestamp = true;
    observedMaxGapMinutes = Math.max(observedMaxGapMinutes, gapMs / 60_000);
  }

  const blockers = [];
  const attestationExact = receipt.healthy === true
    && receipt.matching_count === 1
    && receipt.total_count === 1
    && receipt.exact_match === true;
  if (!attestationExact) blockers.push('attestation-not-exact');
  if (observedSamples < REQUIRED_SAMPLES) blockers.push('insufficient-samples');
  if (healthySamples !== observedSamples) blockers.push('unhealthy-sample');
  if (observedWindowHours < REQUIRED_WINDOW_HOURS) blockers.push('insufficient-soak-window');
  if (duplicateTimestamp) blockers.push('duplicate-sample-timestamp');
  if (observedMaxGapMinutes > ALLOWED_MAX_GAP_MINUTES) blockers.push('sample-gap-exceeded');
  if (normalized.some(({ value }) => value.repository_default_graph_enabled !== false)) {
    blockers.push('repository-default-graph-enabled');
  }

  return {
    schema_version: P19_READINESS_SCHEMA,
    target_project_ref: P19_PRODUCTION_PROJECT_REF,
    eligible: blockers.length === 0,
    required_window_hours: REQUIRED_WINDOW_HOURS,
    required_samples: REQUIRED_SAMPLES,
    allowed_max_gap_minutes: ALLOWED_MAX_GAP_MINUTES,
    observed_samples: observedSamples,
    healthy_samples: healthySamples,
    observed_window_hours: observedWindowHours,
    observed_max_gap_minutes: observedMaxGapMinutes,
    attestation_exact: attestationExact,
    blockers,
  };
}
