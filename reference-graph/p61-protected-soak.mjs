import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { fetchP30ProfileCandidateSnapshot } from './p30-profile-transport.mjs';
import { validateP40ReadOnlySourceWitness } from './p40-readonly-witness.mjs';

const TARGET = 'https://vrznfnxzlxaavpqbzbzd.supabase.co/';
const EXPECTED_PATH = '/rest/v1/reference_graph_profile_candidates_server_p30_v1';
const SHA256 = /^[a-f0-9]{64}$/;

function blocked() {
  throw new Error('P61 protected read-only transport BLOCKED');
}

function validNow(value) {
  return value instanceof Date && Number.isFinite(value.valueOf());
}

/**
 * Exactly one bounded, authenticated, read-only P30 snapshot observation.
 *
 * Does not schedule repeated checks or authenticate the external provenance
 * of the caller-provided witness SHA. It deliberately returns no candidate
 * rows, service credentials, request URLs, or production release claims.
 * The caller must run this on a trusted server with a separately archived
 * and independently approved P40 witness before every observation.
 */
export async function observeP61ProtectedSnapshot({
  sourceWitnessJson,
  sourceWitnessSha256,
  supabaseUrl = TARGET,
  serviceKey,
  fetchImpl = globalThis.fetch,
  transportFn = fetchP30ProfileCandidateSnapshot,
  now = () => new Date(),
  monotonicNow = () => performance.now(),
  timeoutMs = 5000,
} = {}) {
  if (supabaseUrl !== TARGET
    || typeof serviceKey !== 'string' || !/^sb_secret_[A-Za-z0-9_-]+$/.test(serviceKey)
    || typeof sourceWitnessJson !== 'string'
    || Buffer.byteLength(sourceWitnessJson, 'utf8') > 20_000
    || !SHA256.test(sourceWitnessSha256 ?? '')
    || createHash('sha256').update(sourceWitnessJson, 'utf8').digest('hex')
      !== sourceWitnessSha256
    || typeof fetchImpl !== 'function'
    || typeof transportFn !== 'function'
    || typeof now !== 'function' || typeof monotonicNow !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    blocked();
  }

  const before = now();
  if (!validNow(before)) blocked();
  let witness, expected;
  try {
    witness = JSON.parse(sourceWitnessJson);
    expected = validateP40ReadOnlySourceWitness(witness, {
      asOf: before.toISOString(),
    });
  } catch { blocked(); }

  const start = monotonicNow();
  if (!Number.isFinite(start)) blocked();
  let httpRequests = 0;
  const observedFetch = (url, options) => {
    // One narrowly scoped REST GET only, never a general-purpose credential proxy.
    let parsed;
    try { parsed = new URL(url); } catch { blocked(); }
    if (parsed.origin !== new URL(TARGET).origin
      || parsed.pathname !== EXPECTED_PATH || parsed.username || parsed.password
      || options?.method !== 'GET' || options.body !== undefined
      || options.headers?.apikey !== serviceKey
      || options.headers?.Authorization !== undefined) blocked();
    httpRequests++;
    return fetchImpl(url, options);
  };

  let remote;
  try {
    remote = await transportFn({
      supabaseUrl: TARGET, serviceKey, accessMode: 'server',
      expectedDate: expected.snapshot_date,
      expectedCandidateCount: expected.expected_candidate_count,
      expectedCandidateIdSetSha256: expected.expected_candidate_id_set_sha256,
      asOf: before.toISOString(), timeoutMs, fetchImpl: observedFetch,
    });
  } catch { blocked(); }
  const duration = monotonicNow() - start;
  const after = now();

  try {
    if (!validNow(after) || after.valueOf() < before.valueOf()
      || !Number.isFinite(duration) || duration < 0 || duration > timeoutMs
      || httpRequests < 1 || httpRequests > 10
      || remote?.transport?.candidate_count !== expected.expected_candidate_count
      || remote.transport.candidate_id_set_sha256
        !== expected.expected_candidate_id_set_sha256
      || remote.transport.refreshed_at !== expected.refreshed_at) blocked();
    // A witness expiring DURING the fetch is no longer valid evidence.
    validateP40ReadOnlySourceWitness(witness, { asOf: after.toISOString() });
  } catch { blocked(); }

  return {
    schema_version: 'reference-graph.p61-protected-readonly-observation.v1',
    project_ref: 'vrznfnxzlxaavpqbzbzd',
    observed_at: before.toISOString(),
    completed_at: after.toISOString(),
    source_witness_sha256: sourceWitnessSha256,
    snapshot_date: expected.snapshot_date,
    refreshed_at: expected.refreshed_at,
    candidate_count: remote.transport.candidate_count,
    http_get_requests: httpRequests,
    bounded_transport_elapsed_ms: Math.round(duration),
    server_only_transport_verified: true,
    source_provenance_independently_attested: false,
    twenty_four_hour_soak_complete: false,
    forty_eight_case_live_parity_attested: false,
    production_rollback_rehearsed: false,
    activation_authorized: false,
    repository_default_graph_enabled: false,
  };
}
