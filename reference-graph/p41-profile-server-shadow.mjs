import { createHash } from 'node:crypto';

import { TAXONOMY } from '../knowledge/design-references/scripts/lib.mjs';
import { runP11RuntimeQuery } from './p11-runtime-router.mjs';
import { fetchP30ProfileCandidateSnapshot } from './p30-profile-transport.mjs';
import { auditP40StandardDeepShadowHandoff } from './p40-profile-shadow-handoff.mjs';
import { validateP40ReadOnlySourceWitness } from './p40-readonly-witness.mjs';

const TARGET = 'https://vrznfnxzlxaavpqbzbzd.supabase.co/';
const SHA256 = /^[a-f0-9]{64}$/;
const REQUEST_KEYS = [
  'profile', 'limit', 'surface', 'platform', 'job', 'dimensions',
];
const MAX_WITNESS_BYTES = 20_000;

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
}

function validRequest(request) {
  if (!exactKeys(request, REQUEST_KEYS)
    || !['standard', 'deep'].includes(request.profile)
    || !Number.isInteger(request.limit)) return false;
  const profile = TAXONOMY.profiles[request.profile];
  return request.limit >= profile.min
    && request.limit <= profile.max
    && Object.hasOwn(TAXONOMY.surfaceFamilies, request.surface)
    && Object.hasOwn(TAXONOMY.platformTargets, request.platform)
    && typeof request.job === 'string' && request.job.trim().length > 0
    && typeof request.dimensions === 'string'
    && request.dimensions.trim().length > 0;
}

function baseResult(profile, blocker) {
  return {
    schema_version: 'reference-graph.p41-profile-server-shadow.v1',
    profile,
    status: 'blocked',
    reason: blocker,
    authoritative_source: 'legacy-control',
    public_output_unchanged: true,
    usage_recording_performed: false,
    record_order_exact: null,
    pattern_order_exact: null,
    candidate_count: null,
    snapshot_date: null,
    refreshed_at: null,
    server_http_requests: 0,
    graph_runtime_activated: false,
    activation_authorized: false,
    repository_default_graph_enabled: false,
  };
}

/**
 * P41 operator-only server shadow probe. This is NOT connected to P11/query.
 *
 * - Requires a fresh, separately pinned P40 source/projection witness.
 * - Performs one bounded, service-role-only P30 transport (may paginate).
 * - Independently compares Standard/Deep candidate record/pattern order to
 *   the already computed Legacy reference. Never replaces public output.
 * - No local usage writes or production activation flags, even on parity.
 * - Fail closed with allowlisted aggregate diagnostics, never raw errors.
 *
 * A passing P41 shadow probe is NOT a release authority, nor proof of
 * P34 complete-public-output parity or the P35 owner's activation consent.
 */
export async function auditP41ProfileServerShadow({
  records,
  patterns,
  request,
  sourceWitnessJson,
  sourceWitnessSha256,
  supabaseUrl,
  serviceKey,
  accessMode,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
  now = new Date(),
} = {}) {
  const profile = request?.profile ?? null;
  const blocked = reason => baseResult(profile, reason);

  if (!validRequest(request) || !Array.isArray(records)
    || !Array.isArray(patterns) || records.length === 0
    || patterns.length === 0 || !(now instanceof Date)
    || Number.isNaN(now.valueOf())) return blocked('input-invalid');
  if (supabaseUrl !== TARGET
    || accessMode !== 'server'
    || typeof serviceKey !== 'string'
    || !serviceKey.startsWith('sb_secret_')
    || typeof fetchImpl !== 'function'
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 1 || timeoutMs > 10_000) {
    return blocked('server-transport-not-configured');
  }
  if (typeof sourceWitnessJson !== 'string' || !sourceWitnessJson.length
    || Buffer.byteLength(sourceWitnessJson, 'utf8') > MAX_WITNESS_BYTES
    || typeof sourceWitnessSha256 !== 'string'
    || !SHA256.test(sourceWitnessSha256)
    || createHash('sha256').update(sourceWitnessJson, 'utf8').digest('hex')
      !== sourceWitnessSha256) {
    return blocked('witness-pin-invalid');
  }

  let witness, expected;
  try {
    witness = JSON.parse(sourceWitnessJson);
    expected = validateP40ReadOnlySourceWitness(witness, {
      asOf: now.toISOString(),
    });
  } catch {
    return blocked('witness-invalid');
  }

  // This uses the existing P11 Legacy control in no-write mode to ensure the
  // local catalog/request is valid before any remote fetch is considered.
  try {
    const legacy = await runP11RuntimeQuery({
      records, patterns, request, graphMode: 'legacy',
      recordUsageEnabled: false, now,
    });
    if (legacy.routing.authoritative_source !== 'legacy-control'
      || legacy.routing.attempted !== false) {
      return blocked('legacy-control-invalid');
    }
  } catch {
    return blocked('legacy-control-invalid');
  }

  let serverHttpRequests = 0;
  const observedFetch = async (...args) => {
    serverHttpRequests += 1;
    return fetchImpl(...args);
  };
  let remote;
  try {
    remote = await fetchP30ProfileCandidateSnapshot({
      supabaseUrl, serviceKey, accessMode: 'server',
      expectedDate: expected.snapshot_date,
      expectedCandidateCount: expected.expected_candidate_count,
      expectedCandidateIdSetSha256:
        expected.expected_candidate_id_set_sha256,
      asOf: now.toISOString(), fetchImpl: observedFetch, timeoutMs,
    });
  } catch {
    return { ...blocked('server-fetch-failed'), server_http_requests: serverHttpRequests };
  }
  if (remote.transport.refreshed_at !== expected.refreshed_at) {
    return {
      ...blocked('snapshot-refresh-mismatch'),
      server_http_requests: serverHttpRequests,
    };
  }

  let parity;
  try {
    parity = auditP40StandardDeepShadowHandoff({
      records, patterns, request, candidates: remote.candidates, now,
    });
  } catch {
    return {
      ...blocked('shadow-parity-invalid'),
      server_http_requests: serverHttpRequests,
    };
  }
  return {
    schema_version: 'reference-graph.p41-profile-server-shadow.v1',
    profile: request.profile,
    status: parity.parity_exact ? 'exact' : 'mismatch',
    reason: parity.parity_exact ? null : 'record-or-pattern-mismatch',
    authoritative_source: 'legacy-control',
    public_output_unchanged: true,
    usage_recording_performed: false,
    record_order_exact: parity.record_order_exact,
    pattern_order_exact: parity.pattern_order_exact,
    candidate_count: remote.transport.candidate_count,
    snapshot_date: expected.snapshot_date,
    refreshed_at: expected.refreshed_at,
    server_http_requests: serverHttpRequests,
    graph_runtime_activated: false,
    activation_authorized: false,
    repository_default_graph_enabled: false,
  };
}
