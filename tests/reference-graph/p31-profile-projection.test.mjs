import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sqlPath = new URL('../../reference-graph/schema/014_reference_graph_profile_projection_p31.sql', import.meta.url);
const workflowPath = new URL('../../.github/workflows/verify-reference-graph.yml', import.meta.url);
const smokePath = new URL('./p31-profile-projection-smoke.sql', import.meta.url);

const readSql = () => readFileSync(sqlPath, 'utf8');
const readWorkflow = () => readFileSync(workflowPath, 'utf8');
const readSmoke = () => readFileSync(smokePath, 'utf8');

test('P31 defines a separate P30-compatible projection with strict source strata and version', () => {
  const sql = readSql();
  assert.match(sql, /create table public\.reference_graph_profile_runtime_projection_p30_v1\s*\(/i);
  for (const field of [
    'asset_id uuid', 'legacy_id text', 'search_text text',
    'product text', 'surface_family text', 'platform text', 'page_role text',
    'motion text', 'source_family text', 'topology text', 'access_status text',
    'evidence_class text', 'ordinary_or_failure_prone boolean',
    'multi_state_flow boolean', 'tags jsonb', 'primary_stratum text',
    'projection_version text', 'snapshot_date date', 'refreshed_at timestamptz',
  ]) {
    assert.ok(sql.includes(field), 'Missing field ' + field);
  }
  for (const stratum of [
    'direct-domain', 'evidence-craft', 'adjacent-domain', 'outside-domain',
  ]) assert.ok(sql.includes("'" + stratum + "'"));
  assert.match(sql, /legacy_id text not null unique/i);
  assert.match(sql, /asset_id uuid primary key/i);
  assert.match(sql, /primary_stratum text not null check/i);
  assert.match(sql, /projection_version text not null check/i);
});

test('P31 RLS limits published candidates to current UTC date and runtime roles to SELECT', () => {
  const sql = readSql();
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.reference_graph_profile_runtime_projection_p30_v1\s+from public, anon, authenticated/i);
  assert.match(sql, /grant select on table public\.reference_graph_profile_runtime_projection_p30_v1\s+to anon, authenticated/i);
  assert.match(sql, /for select\s+to anon, authenticated\s+using\s*\(/i);
  assert.match(sql, /statement_timestamp\(\)\s+at time zone 'UTC'/i);
  assert.doesNotMatch(sql, /grant (?:insert|update|delete|truncate|all) on table public\.reference_graph_profile_runtime_projection_p30_v1 to (?:anon|authenticated)/i);
});

test('P31 refresh fails closed on source metadata before replacement and verifies independent membership', () => {
  const sql = readSql();
  assert.match(sql, /create or replace function public\.reference_graph_refresh_profile_runtime_projection_p31\(\)/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /reference_graph_quick_candidate_pool_p7/i);
  assert.match(sql, /reference_graph\.current_assets/i);
  assert.match(sql, /metadata->>'primary_stratum'/i);
  assert.match(sql, /v_invalid_count/i);
  assert.match(sql, /raise exception/i);
  assert.match(sql, /delete from public\.reference_graph_profile_runtime_projection_p30_v1/i);
  assert.match(sql, /v_source_hash/i);
  assert.match(sql, /v_published_hash/i);
  assert.match(sql, /sha256\s*\(\s*convert_to/i);
  assert.match(sql, /candidate_id_set_sha256/i);
  assert.match(sql, /revoke all on function public\.reference_graph_refresh_profile_runtime_projection_p31\(\)\s+from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant execute on function public\.reference_graph_refresh_profile_runtime_projection_p31\(\)\s+to service_role/i);
  assert.doesNotMatch(sql, /create extension|cron\.schedule|insert into reference_graph\.usage_feedback/i);
  assert.doesNotMatch(sql, /create or replace function public\.reference_graph_refresh_quick_runtime_projection_p10\(/i);
});

test('P31 CI exercises the migration and disposable Postgres role/RLS/rollback smoke', () => {
  const workflow = readWorkflow();
  assert.match(workflow, /014_reference_graph_profile_projection_p31\.sql/);
  assert.match(workflow, /p31-profile-projection-smoke\.sql/);
  const smoke = readSmoke();
  assert.match(smoke, /set role anon/i);
  assert.match(smoke, /set role authenticated/i);
  assert.match(smoke, /set role service_role/i);
  assert.match(smoke, /reference_graph_refresh_profile_runtime_projection_p31/i);
  assert.match(smoke, /has_function_privilege/i);
  assert.match(smoke, /pg_policies/i);
  assert.match(smoke, /snapshot_date/i);
  assert.match(smoke, /candidate_id_set_sha256/i);
  assert.match(smoke, /rollback/i);
  assert.match(smoke, /primary_stratum/i);
  assert.match(smoke, /reference_graph_quick_runtime_projection_p10/i);
});

test('P31 is not connected to production query routing or default activation', () => {
  const p11 = readFileSync(new URL('../../reference-graph/p11-runtime-router.mjs', import.meta.url), 'utf8');
  const query = readFileSync(new URL('../../knowledge/design-references/scripts/query.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(p11 + query, /p31|profile_runtime_projection_p30_v1/);
  assert.doesNotMatch(readSql(), /update public\.reference_graph_quick_runtime_projection_p10|alter table public\.reference_graph_quick_runtime_projection_p10/i);
});
