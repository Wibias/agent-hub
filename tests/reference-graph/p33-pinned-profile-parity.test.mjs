import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadRecords, loadPatterns } from '../../knowledge/design-references/scripts/lib.mjs';
import { buildP28OfflineProfileCandidatePool } from '../../reference-graph/p28-profile-candidate-contract.mjs';
import { evaluateP27StandardDeepBaseline } from '../../reference-graph/p27-standard-deep-baseline.mjs';
import {
  P33PinnedProfileParityError,
  auditP33PinnedProfileParity,
} from '../../reference-graph/p33-pinned-profile-parity.mjs';

const date = '2026-11-07';
const now = new Date(date + 'T00:00:00.000Z');
const templates = JSON.parse(readFileSync('reference-graph/shadow-cases.json', 'utf8'));
const candidates = buildP28OfflineProfileCandidatePool({ records: loadRecords(), now });
const baseline = evaluateP27StandardDeepBaseline({
  templates, records: loadRecords(), patterns: loadPatterns(), now,
});
const sorted = [...candidates].sort((a, b) => a.asset_id < b.asset_id ? -1 : 1);
const idHash = createHash('sha256')
  .update(candidates.map(r => r.legacy_id).sort().join('\n'), 'utf8').digest('hex');
const refreshed = '2026-11-07T11:30:00.000Z';

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const sourceReceipt = {
  schema_version: 'reference-graph.p31-source-snapshot-receipt.v1',
  projection_version: 'reference-graph.profile-runtime.p30.v1',
  snapshot_date: date,
  refreshed_at: refreshed,
  expected_candidate_count: candidates.length,
  expected_candidate_id_set_sha256: idHash,
  published_candidate_count: candidates.length,
  published_candidate_id_set_sha256: idHash,
  live_graph_parity_verified: false,
  pattern_parity_verified: false,
  repository_default_graph_enabled: false,
  activation_performed: false,
};

const baselineJson = JSON.stringify(baseline);
const templatesJson = JSON.stringify(templates);
const receiptJson = JSON.stringify(sourceReceipt);

function rows(transform = x => x) {
  return sorted.map(row => transform({
    ...row,
    projection_version: sourceReceipt.projection_version,
    snapshot_date: date,
    refreshed_at: '2026-11-07T11:30:00+00:00',
  }));
}
function fixture(extra = {}, payload = rows()) {
  return {
    supabaseUrl: 'https://vrznfnxzlxaavpqbzbzd.supabase.co/',
    publishableKey: 'sb_publishable_p33_disposable',
    asOf: '2026-11-07T12:00:00.000Z',
    baselineJson,
    baselineSha256: digest(baselineJson),
    templatesJson,
    templatesSha256: digest(templatesJson),
    sourceReceiptJson: receiptJson,
    sourceReceiptSha256: digest(receiptJson),
    fetchImpl: async (url, options) => {
      assert.equal(options.method, 'GET');
      assert.equal(new URL(url).pathname,
        '/rest/v1/reference_graph_profile_runtime_projection_p30_v1');
      return { ok: true, status: 200, async json() { return payload; } };
    },
    ...extra,
  };
}

async function fails(category, values) {
  await assert.rejects(
    auditP33PinnedProfileParity(values),
    error => error instanceof P33PinnedProfileParityError
      && error.category === category
      && !/search_text|sb_publishable_p33_disposable|ref-p7-a/.test(error.message),
  );
}

test('P33 composes strict P30 response and independently pinned P27 to compare 48/48 profile cases', async () => {
  const result = await auditP33PinnedProfileParity(fixture());
  assert.equal(result.schema_version, 'reference-graph.p33-pinned-profile-parity.v1');
  assert.equal(result.reference_date, date);
  assert.equal(result.evaluated_cases, 48);
  assert.equal(result.exact_order_cases, 48);
  assert.equal(result.mismatch_cases, 0);
  assert.equal(result.record_order_coverage_parity_exact, true);
  assert.equal(result.candidate_count, candidates.length);
  assert.equal(result.candidate_id_set_sha256, idHash);
  assert.equal(result.transport_contract_verified, true);
  assert.equal(result.pinned_inputs_verified, true);
  assert.equal(result.pattern_parity_verified, false);
  assert.equal(result.live_graph_parity_verified, false);
  assert.equal(result.repository_default_graph_enabled, false);
  assert.equal(result.activation_performed, false);
  assert.equal(result.deployment_authorized, false);
  assert.equal(result.eligible_for_activation, false);
  assert.doesNotMatch(JSON.stringify(result), /search_text|ref-p7-a|sb_publishable_p33_disposable|sourceReceiptJson/);
});

test('P33 rejects missing/self-generated pins, incorrect fixed target and arbitrary baseline before HTTP', async () => {
  let calls = 0;
  const wrapped = fixture({
    fetchImpl: async () => { calls++; throw new Error('must not fetch'); },
  });
  for (const patch of [
    { baselineSha256: undefined },
    { templatesSha256: undefined },
    { sourceReceiptSha256: undefined },
    { baselineSha256: '0'.repeat(64) },
    { templatesSha256: '0'.repeat(64) },
    { sourceReceiptSha256: '0'.repeat(64) },
    { supabaseUrl: 'https://qiaoerpncwbyglhyoftx.supabase.co/' },
    { supabaseUrl: 'http://vrznfnxzlxaavpqbzbzd.supabase.co/' },
    { baselineJson: JSON.stringify({ ...baseline, total_profile_cases: 1 }) },
    { templatesJson: JSON.stringify(templates.slice(0, 1)) },
    { sourceReceiptJson: JSON.stringify({ ...sourceReceipt, live_graph_parity_verified: true }) },
    { sourceReceiptJson: JSON.stringify({ ...sourceReceipt, unexpected: 'strange' }) },
    { sourceReceiptJson: JSON.stringify({ ...sourceReceipt, expected_candidate_count: 2 }) },
    { asOf: '2026-11-08T00:00:00.000Z' },
  ]) {
    await assert.rejects(auditP33PinnedProfileParity({ ...wrapped, ...patch }),
      P33PinnedProfileParityError);
  }
  assert.equal(calls, 0);
});

test('P33 counts valid remote metadata changes as parity mismatch without authorizing production', async () => {
  const changed = rows(row => ({ ...row, primary_stratum: 'direct-domain' }));
  const report = await auditP33PinnedProfileParity(fixture({}, changed));
  assert.equal(report.evaluated_cases, 48);
  assert.ok(report.mismatch_cases > 0);
  assert.equal(report.record_order_coverage_parity_exact, false);
  assert.equal(report.pattern_parity_verified, false);
  assert.equal(report.deployment_authorized, false);
});

test('P33 binds the independently pinned source refresh timestamp to the HTTP snapshot', async () => {
  await fails('snapshot-binding', fixture({}, rows(r => ({
    ...r, refreshed_at: '2026-11-07T11:29:00+00:00',
  }))));
  await fails('source-receipt-invalid', fixture({
    sourceReceiptJson: JSON.stringify({ ...sourceReceipt, refreshed_at: '2026-11-07T06:00:00.000Z' }),
    sourceReceiptSha256: digest(JSON.stringify({
      ...sourceReceipt, refreshed_at: '2026-11-07T06:00:00.000Z',
    })),
  }));
});

test('P33 refuses malformed transport, wrong count and HTTP failure with redacted categories', async () => {
  await fails('transport-candidate-count-mismatch', fixture({}, rows().slice(0, -1)));
  await fails('transport-http', fixture({
    fetchImpl: async () => ({ ok: false, status: 503 }),
  }));
  await fails('transport-candidate-invalid', fixture({}, rows(r => ({
    ...r, extra_field: 'bad',
  }))));
});

test('P33 source never imports production routing, selectors or write-capable Supabase stores', () => {
  const src = readFileSync('reference-graph/p33-pinned-profile-parity.mjs', 'utf8');
  assert.match(src, /fetchP30ProfileCandidateSnapshot/);
  assert.match(src, /compareP29OfflineProfileParity/);
  assert.doesNotMatch(src, /selectRecords|selectPatterns|recordUsage|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|ReferenceGraphSupabaseStore|writeFileSync|apply_migration|production activation/i);
  const router = readFileSync('reference-graph/p11-runtime-router.mjs', 'utf8');
  assert.doesNotMatch(router, /p33-pinned-profile-parity/i);
});
