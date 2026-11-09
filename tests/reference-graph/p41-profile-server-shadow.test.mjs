import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPatterns, loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { buildP28OfflineProfileCandidatePool } from '../../reference-graph/p28-profile-candidate-contract.mjs';
import { auditP41ProfileServerShadow } from '../../reference-graph/p41-profile-server-shadow.mjs';

const records = loadRecords();
const patterns = loadPatterns();
const now = new Date('2026-11-07T11:32:00.000Z');
const candidates = buildP28OfflineProfileCandidatePool({
  records, now: new Date('2026-11-07T00:00:00.000Z'),
});
const idSha = s => createHash('sha256').update(s, 'utf8').digest('hex');
const legacyHash = idSha(candidates.map(x => x.legacy_id).sort().join('\n'));
const witness = {
  schema_version: 'reference-graph.p40-readonly-source-witness.v1',
  source_method: 'p7-vs-p31-read-only',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  projection_version: 'reference-graph.profile-runtime.p30.v1',
  snapshot_date: '2026-11-07',
  refreshed_at: '2026-11-07T11:30:00.000Z',
  observed_at: '2026-11-07T11:31:00.000Z',
  expected_candidate_count: candidates.length,
  expected_candidate_id_set_sha256: legacyHash,
  published_candidate_count: candidates.length,
  published_candidate_id_set_sha256: legacyHash,
  membership_mismatch_count: 0,
  metadata_mismatch_count: 0,
  refresh_instant_count: 1,
  activation_authorized: false,
  repository_default_graph_enabled: false,
};
const templates = JSON.parse(readFileSync('reference-graph/shadow-cases.json', 'utf8'));
const rows = [...candidates].sort((a,b) =>
  a.asset_id < b.asset_id ? -1 : a.asset_id > b.asset_id ? 1 : 0).map(x => ({
  ...x,
  projection_version: 'reference-graph.profile-runtime.p30.v1',
  snapshot_date: '2026-11-07',
  refreshed_at: '2026-11-07T11:30:00+00:00',
}));
const witnessJson = JSON.stringify(witness);
const base = {
  records, patterns, now, sourceWitnessJson: witnessJson,
  sourceWitnessSha256: idSha(witnessJson),
  supabaseUrl: 'https://vrznfnxzlxaavpqbzbzd.supabase.co/',
  serviceKey: 'sb_secret_p41_mock_only',
  accessMode: 'server',
};

function requestFor(template, profile) {
  return {
    profile,
    limit: profile === 'deep' ? 28 : 12,
    surface: template.surface,
    platform: template.platform,
    job: template.job,
    dimensions: template.dimensions,
  };
}
function api(payload = rows, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    assert.equal(new URL(url).pathname,
      '/rest/v1/reference_graph_profile_candidates_server_p30_v1');
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, {
      apikey: base.serviceKey,
      Prefer: 'count=exact',
    });
    const u = new URL(url);
    const offset = Number(u.searchParams.get('offset'));
    const limit = Number(u.searchParams.get('limit'));
    const page = payload.slice(offset, offset + limit);
    return {
      ok: true, status: 206,
      headers: { get(key) {
        return key.toLowerCase() === 'content-range'
          ? offset + '-' + (offset + page.length - 1) + '/' + payload.length
          : null;
      } },
      async json() { return page; },
    };
  };
}

test('P41 server-only shadow matches 48 Standard/Deep requests, never activates, never exposes records', async () => {
  let total = 0;
  const calls = [];
  for (const t of templates) {
    for (const profile of ['standard', 'deep']) {
      const r = await auditP41ProfileServerShadow({
        ...base, request: requestFor(t, profile),
        fetchImpl: api(rows, calls),
      });
      total += 1;
      assert.equal(r.status, 'exact', t.id + ':' + profile);
      assert.equal(r.record_order_exact, true);
      assert.equal(r.pattern_order_exact, true);
      assert.equal(r.authoritative_source, 'legacy-control');
      assert.equal(r.public_output_unchanged, true);
      assert.equal(r.usage_recording_performed, false);
      assert.equal(r.graph_runtime_activated, false);
      assert.equal(r.activation_authorized, false);
      assert.equal(r.repository_default_graph_enabled, false);
      assert.doesNotMatch(JSON.stringify(r),
        /sb_secret_|search_text|sourceWitnessJson|canonicalUrl/);
    }
  }
  assert.equal(total, 48);
  assert.equal(calls.length, 48);
});

test('P41 invalid witness, config and Quick abort BEFORE any service HTTP request', async () => {
  const request = requestFor(templates[0], 'standard');
  for (const patch of [
    { serviceKey: undefined },
    { accessMode: 'publishable' },
    { supabaseUrl: 'https://other.supabase.co/' },
    { sourceWitnessSha256: '0'.repeat(64) },
    { sourceWitnessJson: JSON.stringify({ ...witness, metadata_mismatch_count: 1 }) },
    { request: { ...request, profile: 'quick' } },
    { request: { ...request, unexpected: true } },
    { now: new Date('2026-11-07T11:50:00.000Z') },
  ]) {
    let calls = 0;
    const result = await auditP41ProfileServerShadow({
      ...base, request, ...patch,
      fetchImpl: async (...args) => { calls++; return api()(...args); },
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.authoritative_source, 'legacy-control');
    assert.equal(result.graph_runtime_activated, false);
    assert.equal(calls, 0, JSON.stringify(patch).slice(0,100));
  }
});

test('P41 transport error and timestamp drift preserve Legacy and return safe categories', async () => {
  const request = requestFor(templates[0], 'standard');
  const failed = await auditP41ProfileServerShadow({
    ...base, request, fetchImpl: async () => {
      throw new Error('SECRET-DO-NOT-LEAK');
    },
  });
  assert.equal(failed.status, 'blocked');
  assert.equal(failed.reason, 'server-fetch-failed');
  assert.equal(failed.authoritative_source, 'legacy-control');
  assert.equal(JSON.stringify(failed).includes('SECRET-DO-NOT-LEAK'), false);

  const shifted = rows.map(row => ({
    ...row,
    refreshed_at: '2026-11-07T11:29:00+00:00',
  }));
  const drift = await auditP41ProfileServerShadow({
    ...base, request, fetchImpl: api(shifted),
  });
  assert.equal(drift.status, 'blocked');
  assert.equal(drift.reason, 'snapshot-refresh-mismatch');
  assert.equal(drift.activation_authorized, false);
});

test('P41 48-case parity does not touch production query or historical P35 pins', () => {
  const src = readFileSync('reference-graph/p41-profile-server-shadow.mjs', 'utf8');
  const router = readFileSync('reference-graph/p11-runtime-router.mjs', 'utf8');
  const query = readFileSync('knowledge/design-references/scripts/query.mjs', 'utf8');
  assert.doesNotMatch(router, /p41-profile-server-shadow/);
  assert.doesNotMatch(query, /p41-profile-server-shadow|P40_SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(src, /writeFile|recordUsageFn\(|process\.env|apply_migration/);
});
