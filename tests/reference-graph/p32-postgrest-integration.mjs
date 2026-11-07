import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  P30ProfileTransportError,
  fetchP30ProfileCandidateSnapshot,
} from '../../reference-graph/p30-profile-transport.mjs';

const base = process.env.POSTGREST_LOCAL_URL;
const receiptPath = process.env.P32_SOURCE_RECEIPT;
const phase = process.argv[2];
if (!['healthy', 'expired', 'stale'].includes(phase)
    || !base || !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(base)
    || !receiptPath) throw new Error('P32 requires disposable local PostgREST and explicit phase');

const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
const permitted = [
  'activation_performed', 'expected_candidate_count',
  'expected_candidate_id_set_sha256', 'live_graph_parity_verified',
  'pattern_parity_verified', 'projection_version', 'published_candidate_count',
  'published_candidate_id_set_sha256', 'refreshed_at',
  'repository_default_graph_enabled', 'schema_version', 'snapshot_date',
].sort();
function check(condition, reason) {
  if (!condition) throw new Error('P32: ' + reason);
}
check(JSON.stringify(Object.keys(receipt).sort()) === JSON.stringify(permitted),
  'unexpected source receipt fields');
check(receipt.schema_version === 'reference-graph.p31-source-snapshot-receipt.v1',
  'wrong source receipt contract');
check(receipt.projection_version === 'reference-graph.profile-runtime.p30.v1',
  'wrong source projection');
check(receipt.activation_performed === false
  && receipt.repository_default_graph_enabled === false
  && receipt.live_graph_parity_verified === false,
'unsafe source receipt state');
check(receipt.expected_candidate_count === receipt.published_candidate_count
  && receipt.expected_candidate_id_set_sha256 === receipt.published_candidate_id_set_sha256,
  'source and published membership mismatch');
check(Number.isInteger(receipt.expected_candidate_count)
  && receipt.expected_candidate_count > 0
  && /^[a-f0-9]{64}$/.test(receipt.expected_candidate_id_set_sha256),
  'source pin invalid');

const asOf = new Date().toISOString();
check(asOf.slice(0, 10) === receipt.snapshot_date, 'source pin UTC date mismatch');
const projection = 'reference_graph_profile_runtime_projection_p30_v1';
const endpoint = new URL(projection, base);

/**
 * Local PostgREST runs plain HTTP in a disposable Actions Postgres service.
 * This test adapter redirects the client's verified HTTPS URL to localhost
 * without changing its path, method, query, headers, or body. It is NOT a
 * TLS/Kong/Supabase network proof; production client remains HTTPS-only.
 */
const localHttpAdapter = async (url, options) => {
  const requested = new URL(url);
  check(requested.protocol === 'https:' && requested.pathname === '/rest/v1/' + projection,
    'P30 requested wrong origin/projection');
  const local = new URL(requested.pathname.replace(/^\/rest\/v1\//, ''), base);
  local.search = requested.search;
  return fetch(local, options);
};

function options(extra = {}) {
  return {
    supabaseUrl: 'https://p32-fixture.invalid/',
    publishableKey: 'sb_publishable_p32_ci_only',
    expectedDate: receipt.snapshot_date,
    asOf,
    expectedCandidateCount: receipt.expected_candidate_count,
    expectedCandidateIdSetSha256: receipt.expected_candidate_id_set_sha256,
    fetchImpl: localHttpAdapter,
    timeoutMs: 5000,
    ...extra,
  };
}

async function expectCategory(category, overrides = {}) {
  let actual = null;
  try {
    await fetchP30ProfileCandidateSnapshot(options(overrides));
  } catch (error) {
    if (!(error instanceof P30ProfileTransportError)) throw error;
    actual = error.category;
  }
  check(actual === category, 'expected fail-closed ' + category + ', got ' + actual);
}

async function directGet() {
  const url = new URL(endpoint);
  url.searchParams.set('select', 'asset_id,legacy_id,snapshot_date,primary_stratum,refreshed_at');
  const response = await fetch(url);
  check(response.status === 200, 'PostgREST anonymous GET must be permitted');
  const rows = await response.json();
  check(Array.isArray(rows), 'PostgREST anonymous read malformed');
  return rows;
}

async function forbidden(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  check(response.status === 401 || response.status === 403 || response.status === 404,
    'PostgREST mutation or privileged RPC was not denied');
}

if (phase === 'healthy') {
  const rows = await directGet();
  check(rows.length === receipt.expected_candidate_count, 'HTTP source count mismatch');
  const selected = await fetchP30ProfileCandidateSnapshot(options());
  check(selected.candidates.length === rows.length, 'P30 candidate count mismatch');
  check(selected.transport.candidate_id_set_sha256
    === receipt.expected_candidate_id_set_sha256,
    'P30 independently pinned set fingerprint mismatch');
  check(selected.transport.projection_version === receipt.projection_version,
    'P30 projection version mismatch');
  check(selected.transport.live_graph_parity_verified === false
    && selected.transport.pattern_parity_verified === false
    && selected.transport.activation_performed === false
    && selected.transport.repository_default_graph_enabled === false,
    'P30 must not claim live or public parity');
  await expectCategory('candidate-count-mismatch', {
    expectedCandidateCount: receipt.expected_candidate_count + 1,
  });
  await expectCategory('fingerprint-mismatch', {
    expectedCandidateIdSetSha256: '0'.repeat(64) === receipt.expected_candidate_id_set_sha256
      ? '1'.repeat(64) : '0'.repeat(64),
  });

  const candidate = selected.candidates[0];
  const sample = {
    ...candidate,
    asset_id: 'a0000000-0000-5000-8000-000000009999',
    legacy_id: 'p32-forbidden-insert',
    projection_version: receipt.projection_version,
    snapshot_date: receipt.snapshot_date,
    refreshed_at: receipt.refreshed_at,
  };
  await forbidden('POST', endpoint, sample);
  await forbidden('PATCH', new URL(projection + '?asset_id=eq.' + candidate.asset_id, base),
    { search_text: 'denied' });
  await forbidden('DELETE', new URL(projection + '?asset_id=eq.' + candidate.asset_id, base));
  await forbidden('POST', new URL('rpc/reference_graph_refresh_profile_runtime_projection_p31', base), {});
  console.log(JSON.stringify({
    schema_version: 'reference-graph.p32-local-postgrest.v1',
    phase, candidate_count: selected.candidates.length,
    source_membership_exact: true,
    http_access_read_only: true,
    transport_contract_verified: true,
    tls_and_supabase_gateway_verified: false,
    live_graph_parity_verified: false,
    activation_performed: false,
  }));
} else if (phase === 'expired') {
  check((await directGet()).length === receipt.expected_candidate_count,
    'expired rows must still be visible by same-day RLS');
  await expectCategory('snapshot-stale');
  console.log(JSON.stringify({
    phase, stale_client_snapshot_rejected: true,
    live_graph_parity_verified: false, activation_performed: false,
  }));
} else {
  check((await directGet()).length === 0, 'old-date rows must be invisible by RLS');
  await expectCategory('candidate-invalid');
  console.log(JSON.stringify({
    phase, old_date_rows_hidden: true,
    live_graph_parity_verified: false, activation_performed: false,
  }));
}
