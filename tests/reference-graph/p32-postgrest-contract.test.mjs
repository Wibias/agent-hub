import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = () => readFileSync('reference-graph/schema/014_reference_graph_profile_projection_p31.sql', 'utf8');
const smoke = () => readFileSync('tests/reference-graph/p31-profile-projection-smoke.sql', 'utf8');
const workflow = () => readFileSync('.github/workflows/verify-reference-graph.yml', 'utf8');
const integration = () => readFileSync('tests/reference-graph/p32-postgrest-integration.mjs', 'utf8');
const sqlProbe = () => readFileSync('tests/reference-graph/p32-source-negative-smoke.sql', 'utf8');

test('P32 validates all P28 source metadata before P31 commits a public snapshot', () => {
  const src = sql();
  const beforeWrite = src.split('delete from public.reference_graph_profile_runtime_projection_p30_v1')[0];
  for (const value of ['v_metadata_invalid_count', 'surface_family', 'platform', 'evidence_class', 'access_status']) {
    assert.ok(beforeWrite.includes(value), 'missing fail-closed metadata preflight: ' + value);
  }
  assert.match(beforeWrite, /raise exception 'P31 source has invalid P28 candidate metadata'/);
  assert.match(beforeWrite, /jsonb_typeof\(p\.tags\)/);
  assert.doesNotMatch(src, /update public\.reference_graph_quick_runtime_projection_p10/i);
});

test('P32 retains valid test-only taxonomy fixtures for P31 smoke with no production catalog rewrites', () => {
  assert.match(smoke(), /P32 disposable fixture taxonomy alignment/);
  assert.match(smoke(), /jsonb_set/);
  assert.match(smoke(), /public\.reference_graph_quick_candidate_pool_p7/);
});

test('P32 CI executes official pinned PostgREST and independent source/HTTP/negative probes', () => {
  const src = workflow();
  assert.match(src, /postgrest\/postgrest:v16\.4/);
  assert.match(src, /PGRST_DB_ANON_ROLE=anon/);
  assert.match(src, /p32-postgrest-integration\.mjs/);
  assert.match(src, /p32-source-negative-smoke\.sql/);
  assert.match(src, /POSTGREST_LOCAL_URL/);
  assert.match(src, /P32_SOURCE_RECEIPT/);
});

test('P32 API tests verify read-only HTTP, version, count, metadata, RLS and no live-parity claim', () => {
  const src = integration();
  for (const marker of ['fetchP30ProfileCandidateSnapshot', 'P30ProfileTransportError',
    'expected_candidate_id_set_sha256', 'expected_candidate_count', 'snapshot-stale',
    'fetch(', 'POST', 'PATCH', 'DELETE', 'live_graph_parity_verified']) {
    assert.ok(src.includes(marker), 'missing HTTP test: ' + marker);
  }
  assert.doesNotMatch(src, /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|production\.supabase/i);
  assert.match(sqlProbe(), /rollback/i);
  assert.match(sqlProbe(), /auth/i);
  assert.match(sqlProbe(), /primary_stratum/i);
});

test('P32 cannot be reached by repository production router or collector', () => {
  for (const name of ['reference-graph/p11-runtime-router.mjs',
    'knowledge/design-references/scripts/query.mjs']) {
    const src = readFileSync(name, 'utf8');
    assert.doesNotMatch(src, /p32|p31-profile-projection|p32-postgrest/i);
  }
  assert.doesNotMatch(sql(), /cron\.schedule|create extension/i);
});
