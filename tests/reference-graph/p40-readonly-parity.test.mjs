import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPatterns, loadRecords, stripInternal } from '../../knowledge/design-references/scripts/lib.mjs';
import { buildP28OfflineProfileCandidatePool } from '../../reference-graph/p28-profile-candidate-contract.mjs';
import { evaluateP27StandardDeepBaseline } from '../../reference-graph/p27-standard-deep-baseline.mjs';
import { runP11RuntimeQuery } from '../../reference-graph/p11-runtime-router.mjs';
import {
  auditP40ReadOnlyRecordParity, auditP40ReadOnlyFullParity, P40ReadOnlyParityError,
} from '../../reference-graph/p40-readonly-parity.mjs';

const now = new Date('2026-11-07T00:00:00.000Z');
const templates = JSON.parse(readFileSync('reference-graph/shadow-cases.json', 'utf8'));
const records = loadRecords();
const patterns = loadPatterns();
const candidates = buildP28OfflineProfileCandidatePool({ records, now });
const hash = s => createHash('sha256').update(s, 'utf8').digest('hex');
const idSetHash = hash(candidates.map(row => row.legacy_id).sort().join('\n'));
const receipt = {
  schema_version: 'reference-graph.p40-readonly-source-witness.v1',
  source_method: 'p7-vs-p31-read-only',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  projection_version: 'reference-graph.profile-runtime.p30.v1',
  snapshot_date: '2026-11-07',
  refreshed_at: '2026-11-07T11:30:00.000Z',
  observed_at: '2026-11-07T11:31:00.000Z',
  expected_candidate_count: candidates.length,
  expected_candidate_id_set_sha256: idSetHash,
  published_candidate_count: candidates.length,
  published_candidate_id_set_sha256: idSetHash,
  membership_mismatch_count: 0,
  metadata_mismatch_count: 0,
  refresh_instant_count: 1,
  activation_authorized: false,
  repository_default_graph_enabled: false,
};
const baseline = evaluateP27StandardDeepBaseline({ templates, records, patterns, now });
const strings = {
  sourceWitnessJson: JSON.stringify(receipt),
  baselineJson: JSON.stringify(baseline),
  templatesJson: JSON.stringify(templates),
  recordsJson: JSON.stringify(records.map(stripInternal)),
  patternsJson: JSON.stringify(patterns.map(stripInternal)),
};
const publicCases = [];
for (const template of [...templates].sort((a, b) => a.id.localeCompare(b.id))) {
  for (const profile of ['standard', 'deep']) {
    const r = await runP11RuntimeQuery({
      records, patterns,
      request: {
        profile, limit: profile === 'deep' ? 28 : 12,
        surface: template.surface, platform: template.platform,
        job: template.job, dimensions: template.dimensions,
      },
      graphMode: 'legacy', recordUsageEnabled: false, now,
    });
    publicCases.push({
      source_case_id: template.id, profile,
      public_output_sha256: hash(JSON.stringify(r.result)),
    });
  }
}
strings.publicBaselineJson = JSON.stringify({
  schema_version: 'reference-graph.p34-legacy-public-baseline.v1',
  reference_date: '2026-11-07', cases: publicCases,
});
const pins = Object.fromEntries(Object.entries(strings).map(([k, v]) =>
  [k.replace('Json', 'Sha256'), hash(v)]));
const rows = [...candidates].sort((a, b) =>
  a.asset_id < b.asset_id ? -1 : a.asset_id > b.asset_id ? 1 : 0).map(row => ({
  ...row,
  projection_version: 'reference-graph.profile-runtime.p30.v1',
  snapshot_date: '2026-11-07',
  refreshed_at: '2026-11-07T11:30:00+00:00',
}));
const connection = {
  supabaseUrl: 'https://vrznfnxzlxaavpqbzbzd.supabase.co/',
  serviceKey: 'sb_secret_p40_ci_only',
  accessMode: 'server',
  asOf: '2026-11-07T11:32:00.000Z',
  timeoutMs: 5000,
};
function api(payload = rows, calls = []) {
  return async (url, options) => {
    calls.push([url, options]);
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, {
      apikey: connection.serviceKey, Prefer: 'count=exact',
    });
    assert.equal(new URL(url).pathname,
      '/rest/v1/reference_graph_profile_candidates_server_p30_v1');
    const u = new URL(url);
    const offset = Number(u.searchParams.get('offset'));
    const limit = Number(u.searchParams.get('limit'));
    const page = payload.slice(offset, offset + limit);
    return {
      ok: true, status: 206,
      headers: { get(name) {
        return name.toLowerCase() === 'content-range'
          ? (String(offset) + '-' + String(offset + page.length - 1) + '/' + String(payload.length))
          : null;
      } },
      async json() { return page; },
    };
  };
}
function input(fetchImpl, overrides = {}) {
  return { ...connection, ...strings, ...pins, fetchImpl, ...overrides };
}

test('P40 alternative read-only source witness yields 48/48 P33-compatible record parity', async () => {
  const calls = [];
  const result = await auditP40ReadOnlyRecordParity(input(api(rows, calls)));
  assert.equal(calls.length, 1);
  assert.equal(result.schema_version, 'reference-graph.p40-readonly-record-parity.v1');
  assert.equal(result.p33_compatible_report.schema_version, 'reference-graph.p33-pinned-profile-parity.v2');
  assert.equal(result.p33_compatible_report.exact_order_cases, 48);
  assert.equal(result.p33_compatible_report.mismatch_cases, 0);
  assert.equal(result.activation_authorized, false);
  assert.equal(result.repository_default_graph_enabled, false);
  assert.doesNotMatch(JSON.stringify(result), /sb_secret_|search_text|canonicalUrl/);
});

test('P40 uses externally pinned stage-one digest for 48/48 pattern and public-output parity', async () => {
  // CI-generated fixture hashes demonstrate mechanics, NOT independent release attestation.
  const stageOne = await auditP40ReadOnlyRecordParity(input(api()));
  const externalFixturePin = hash(JSON.stringify(stageOne));
  const calls = [];
  const output = await auditP40ReadOnlyFullParity(input(api(rows, calls), {
    expectedP40RecordReportSha256: externalFixturePin,
  }));
  assert.equal(calls.length, 1);
  assert.equal(output.schema_version, 'reference-graph.p40-readonly-full-parity.v1');
  assert.equal(output.p40_record_report_pin_matched, true);
  assert.equal(output.p34.record_order_exact_cases, 48);
  assert.equal(output.p34.pattern_exact_cases, 48);
  assert.equal(output.p34.public_output_exact_cases, 48);
  assert.equal(output.p34.candidate_content_bound_to_p33, true);
  for (const key of [
    'live_graph_parity_verified', 'deployment_authorized', 'activation_authorized',
    'eligible_for_activation', 'repository_default_graph_enabled',
  ]) assert.equal(output[key], false);
  assert.doesNotMatch(JSON.stringify(output), /sb_secret_|search_text|canonicalUrl/);
});

test('P40 fails closed on a changed HTTP candidate, wrong witness, wrong stage pin and absent service mode', async () => {
  const first = await auditP40ReadOnlyRecordParity(input(api()));
  const changedRows = rows.map((row, i) => i === 0
    ? { ...row, tags: [...row.tags, 'altered-tag'] } : row);
  await assert.rejects(auditP40ReadOnlyFullParity(input(api(changedRows), {
    expectedP40RecordReportSha256: hash(JSON.stringify(first)),
  })), error => error instanceof P40ReadOnlyParityError
    && error.category === 'record-report-pin');

  for (const patch of [
    { sourceWitnessSha256: '0'.repeat(64) },
    { accessMode: 'publishable' },
    { supabaseUrl: 'https://other.supabase.co/' },
    { sourceWitnessJson: JSON.stringify({ ...receipt, metadata_mismatch_count: 1 }) },
  ]) {
    let calls = 0;
    await assert.rejects(auditP40ReadOnlyRecordParity(input(
      async (...args) => { calls++; return api()(...args); },
      patch,
    )), P40ReadOnlyParityError);
    assert.equal(calls, 0);
  }
  let calls = 0;
  await assert.rejects(auditP40ReadOnlyFullParity(input(
    async (...args) => { calls++; return api()(...args); },
    { expectedP40RecordReportSha256: '0'.repeat(64) },
  )), P40ReadOnlyParityError);
  assert.equal(calls, 1);
});

test('P40 never imports production routing or mutates legacy P33/P37 pins', () => {
  const source = readFileSync('reference-graph/p40-readonly-parity.mjs', 'utf8');
  assert.doesNotMatch(source,
    /writeFileSync|recordUsage|runP11RuntimeQuery|process\.env|apply_migration/i);
  const router = readFileSync('reference-graph/p11-runtime-router.mjs', 'utf8');
  assert.doesNotMatch(router, /p40-readonly-parity/);
});
