import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPatterns, loadRecords, stripInternal } from '../../knowledge/design-references/scripts/lib.mjs';
import { runP11RuntimeQuery } from '../../reference-graph/p11-runtime-router.mjs';
import { buildP28OfflineProfileCandidatePool } from '../../reference-graph/p28-profile-candidate-contract.mjs';
import { evaluateP27StandardDeepBaseline } from '../../reference-graph/p27-standard-deep-baseline.mjs';
import { auditP33PinnedProfileParity } from '../../reference-graph/p33-pinned-profile-parity.mjs';
import {
  auditP37SingleSnapshotPublicParity,
  P37SingleSnapshotAuditError,
} from '../../reference-graph/p37-single-snapshot-public-audit.mjs';

const date = '2026-11-07';
const now = new Date(date + 'T00:00:00.000Z');
const records = loadRecords();
const patterns = loadPatterns();
const templates = JSON.parse(readFileSync('reference-graph/shadow-cases.json', 'utf8'));
const pool = buildP28OfflineProfileCandidatePool({ records, now });
const rows = [...pool].sort((a, b) => a.asset_id < b.asset_id ? -1 : 1).map(row => ({
  ...row,
  projection_version: 'reference-graph.profile-runtime.p30.v1',
  snapshot_date: date,
  refreshed_at: '2026-11-07T11:30:00+00:00',
}));
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const idSet = hash(pool.map(row => row.legacy_id).sort().join('\n'));
const receipt = {
  schema_version: 'reference-graph.p31-source-snapshot-receipt.v1',
  projection_version: 'reference-graph.profile-runtime.p30.v1',
  snapshot_date: date, refreshed_at: '2026-11-07T11:30:00.000Z',
  expected_candidate_count: pool.length,
  expected_candidate_id_set_sha256: idSet,
  published_candidate_count: pool.length,
  published_candidate_id_set_sha256: idSet,
  live_graph_parity_verified: false,
  pattern_parity_verified: false,
  repository_default_graph_enabled: false,
  activation_performed: false,
};

const baseline = evaluateP27StandardDeepBaseline({ templates, records, patterns, now });
const strings = {
  templatesJson: JSON.stringify(templates),
  baselineJson: JSON.stringify(baseline),
  sourceReceiptJson: JSON.stringify(receipt),
  recordsJson: JSON.stringify(records.map(stripInternal)),
  patternsJson: JSON.stringify(patterns.map(stripInternal)),
};
const publicCases = [];
for (const template of [...templates].sort((a, b) => a.id.localeCompare(b.id))) {
  for (const profile of ['standard', 'deep']) {
    const control = await runP11RuntimeQuery({
      records, patterns,
      request: {
        profile, limit: profile === 'deep' ? 28 : 12,
        surface: template.surface, platform: template.platform,
        job: template.job, dimensions: template.dimensions,
      },
      graphMode: 'legacy', recordUsageEnabled: false, now,
    });
    assert.equal(control.routing.authoritative_source, 'legacy-control');
    publicCases.push({
      source_case_id: template.id, profile,
      public_output_sha256: hash(JSON.stringify(control.result)),
    });
  }
}
strings.publicBaselineJson = JSON.stringify({
  schema_version: 'reference-graph.p34-legacy-public-baseline.v1',
  reference_date: date, cases: publicCases,
});
const digestPins = Object.fromEntries(Object.entries(strings).map(([key, value]) =>
  [key.replace('Json', 'Sha256'), hash(value)]));
const connection = {
  supabaseUrl: 'https://vrznfnxzlxaavpqbzbzd.supabase.co/',
  publishableKey: 'sb_publishable_p37_ci_only',
  asOf: '2026-11-07T12:00:00.000Z',
  timeoutMs: 5000,
};

// CI-generated pins and stubbed HTTP: NOT independent evidence or real Supabase.
const pinnedP33 = await auditP33PinnedProfileParity({
  ...connection, ...strings, ...digestPins,
  fetchImpl: async () => ({ ok: true, async json() { return rows; } }),
});
assert.equal(pinnedP33.record_order_coverage_parity_exact, true);
const approvedP33Sha = hash(JSON.stringify(pinnedP33));

function auditInput(fetchImpl, overrides = {}) {
  return {
    ...connection, ...strings, ...digestPins,
    expectedP33ReportSha256: approvedP33Sha,
    fetchImpl,
    ...overrides,
  };
}
function api(payload = rows, calls = [], serverCap = 500) {
  return async (url, options) => {
    calls.push([url, options]);
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, { apikey: connection.publishableKey });
    assert.equal(new URL(url).pathname,
      '/rest/v1/reference_graph_profile_runtime_projection_p30_v1');
    const parsed = new URL(url);
    const limit = Number(parsed.searchParams.get('limit'));
    const offset = Number(parsed.searchParams.get('offset'));
    const page = payload.slice(offset, offset + Math.min(limit, serverCap));
    return {
      ok: true, status: page.length < limit ? 200 : 206,
      async json() { return page; },
    };
  };
}

test('P37 composes one GET-only verified snapshot into independent P33/P34 48/48 reports', async () => {
  const calls = [];
  const receipt = await auditP37SingleSnapshotPublicParity(auditInput(api(rows, calls)));
  assert.equal(calls.length, 1);
  assert.equal(receipt.schema_version, 'reference-graph.p37-single-snapshot-public-audit.v1');
  assert.equal(receipt.p33.schema_version, 'reference-graph.p33-pinned-profile-parity.v2');
  assert.equal(receipt.p34.schema_version, 'reference-graph.p34-pattern-public-output-parity.v2');
  assert.equal(receipt.p33.exact_order_cases, 48);
  assert.equal(receipt.p34.public_output_exact_cases, 48);
  assert.equal(receipt.p34.candidate_content_bound_to_p33, true);
  assert.equal(receipt.p33_report_pin_matched, true);
  assert.equal(receipt.http_request_count, calls.length);
  for (const field of [
    'live_graph_parity_verified', 'deployment_authorized', 'activation_authorized',
    'repository_default_graph_enabled', 'eligible_for_activation',
  ]) assert.equal(receipt[field], false, field);
  assert.doesNotMatch(JSON.stringify(receipt),
    /search_text|sb_publishable_p37_ci_only|ref-p7-a|canonicalUrl|sourceReceiptJson|recordsJson/);
});

test('P37 handles a server-capped multi-page P30 snapshot with no P34 re-fetch', async () => {
  const calls = [];
  const result = await auditP37SingleSnapshotPublicParity(auditInput(api(rows, calls, 2)));
  assert.ok(calls.length > 1, 'fixture must have more than one page');
  assert.equal(calls.length, Math.ceil(rows.length / 2));
  assert.deepEqual(calls.map(([url]) => Number(new URL(url).searchParams.get('offset'))),
    Array.from({ length: calls.length }, (_, i) => i * 2));
  assert.equal(result.http_request_count, calls.length);
  assert.equal(result.p33.exact_order_cases, 48);
  assert.equal(result.p34.public_output_exact_cases, 48);
  assert.equal(result.p34.candidate_content_bound_to_p33, true);
  assert.equal(result.deployment_authorized, false);
});

test('P37 refuses mixed publication times across HTTP pages without returning candidates', async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    const response = await api(rows, [], 2)(url, options);
    if (calls !== 2) return response;
    return {
      ...response,
      async json() {
        return (await response.json()).map(row => ({
          ...row, refreshed_at: '2026-11-07T11:29:00+00:00',
        }));
      },
    };
  };
  await assert.rejects(auditP37SingleSnapshotPublicParity(auditInput(fetchImpl)),
    error => error instanceof P37SingleSnapshotAuditError
      && error.category === 'p33-transport');
  // P30 validates cross-page refreshed_at during whole-snapshot normalization.
  // It must fail closed after the complete bounded retrieval, never return
  // a partial P37 result or make an extra P34 network read.
  assert.equal(calls, Math.ceil(rows.length / 2));
});

test('P37 rejects an absent, malformed or wrong independently supplied P33 report pin', async () => {
  for (const value of [undefined, '0'.repeat(64), 'not-a-hash']) {
    let calls = 0;
    await assert.rejects(
      auditP37SingleSnapshotPublicParity(auditInput(
        async (...args) => { calls++; return api()(...args); },
        { expectedP33ReportSha256: value },
      )),
      error => error instanceof P37SingleSnapshotAuditError
        && error.category === 'p33-report-pin',
    );
    if (value !== '0'.repeat(64)) assert.equal(calls, 0);
  }
});

test('P37 refuses to run HTTP when any local P34 independent input byte pin is incorrect', async () => {
  for (const key of [
    'templatesSha256', 'baselineSha256', 'recordsSha256',
    'patternsSha256', 'publicBaselineSha256',
  ]) {
    let calls = 0;
    await assert.rejects(auditP37SingleSnapshotPublicParity(auditInput(
      async (...args) => { calls++; return api()(...args); },
      { [key]: '0'.repeat(64) },
    )), P37SingleSnapshotAuditError);
    assert.equal(calls, 0, key);
  }
});

test('P37 rejects altered remote metadata with identical IDs before running public parity', async () => {
  const changed = rows.map((row, i) => i === 0
    ? { ...row, tags: [...row.tags, 'p37-drift-probe'] }
    : row);
  await assert.rejects(auditP37SingleSnapshotPublicParity(
    auditInput(api(changed))),
    error => error instanceof P37SingleSnapshotAuditError
      && error.category === 'p33-report-pin',
  );
});

test('P37 propagates a later page or authorization failure without partial output', async () => {
  let calls = 0;
  await assert.rejects(auditP37SingleSnapshotPublicParity(auditInput(
    async () => { calls++; return { ok: false, status: 401 }; },
  )), error => error instanceof P37SingleSnapshotAuditError
    && error.category === 'p33-transport');
  assert.equal(calls, 1);
});

test('P37 does not continue reading or issue GETs after P30 timeout from abort-ignoring fetch', async () => {
  let releaseLateResponse;
  let parseCount = 0;
  const requests = [];
  const fetchImpl = (url, options) => {
    requests.push({ url, method: options.method, signal: options.signal });
    if (requests.length === 1) {
      return new Promise(resolve => { releaseLateResponse = resolve; });
    }
    return api(rows)(url, options);
  };
  await assert.rejects(
    auditP37SingleSnapshotPublicParity(auditInput(fetchImpl, { timeoutMs: 10 })),
    error => error instanceof P37SingleSnapshotAuditError
      && error.category === 'p33-transport',
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].signal.aborted, true);
  releaseLateResponse({
    ok: true, status: 206,
    async json() {
      parseCount++;
      return rows.slice(0, 2);
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(parseCount, 0, 'do not parse late response after a timeout');
  assert.equal(requests.length, 1, 'do not start P30/P34 GETs after a timeout');
});

test('P37 does not import production routing, write to disk or connect service-role state', () => {
  const src = readFileSync('reference-graph/p37-single-snapshot-public-audit.mjs', 'utf8');
  const router = readFileSync('reference-graph/p11-runtime-router.mjs', 'utf8');
  assert.doesNotMatch(src, /writeFileSync|service_role|SUPABASE_SECRET_KEY|process\.env|recordUsage|runP11RuntimeQuery|apply_migration/);
  assert.doesNotMatch(router, /p37-single-snapshot-public-audit/);
});
