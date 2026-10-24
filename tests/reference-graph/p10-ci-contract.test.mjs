import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const WORKFLOW = readFileSync(new URL('../../.github/workflows/verify-reference-graph.yml', import.meta.url), 'utf8');
const README = readFileSync(new URL('../../reference-graph/README.md', import.meta.url), 'utf8');
const CLIENT = readFileSync(new URL('../../reference-graph/p10-runtime-client.mjs', import.meta.url), 'utf8');
const CLI = readFileSync(new URL('../../reference-graph/cli/p10-runtime-canary.mjs', import.meta.url), 'utf8');
const RUNTIME_SOURCE = `${CLIENT}\n${CLI}`;

test('P10 governance secret-scans optional P10 evidence with the P10 receipt contract', () => {
  assert.match(WORKFLOW, /assertSecretFreeP10Receipt/);
  assert.match(WORKFLOW, /reference-graph\/evidence\/p10-runtime-projection-evidence\.json/);
});

test('P10 historical runtime projection remains immutable while P11 owns current opt-in routing', () => {
  assert.match(WORKFLOW, /009_reference_graph_runtime_projection\.sql/);
  assert.match(WORKFLOW, /Verify immutable P10 runtime projection evidence/);
  assert.match(WORKFLOW, /p10-runtime-projection-evidence\.json/);
  assert.match(WORKFLOW, /Verify P11 production runtime default-off and profile isolation/);
  assert.match(WORKFLOW, /SUPABASE_PUBLISHABLE_KEY/);
});

test('P10 permanent DB smoke proves projection RLS, closed P9 runtime, and service-only refresh', () => {
  assert.match(WORKFLOW, /Smoke-test P10 runtime projection RLS, refresh grants, and P9 closure/);
  assert.match(WORKFLOW, /reference_graph_quick_runtime_projection_p10/);
  assert.match(WORKFLOW, /reference_graph_refresh_quick_runtime_projection_p10/);
  assert.match(WORKFLOW, /reference_graph_quick_candidate_pool_runtime_p9/);
  assert.match(WORKFLOW, /has_function_privilege\('anon'/);
  assert.match(WORKFLOW, /has_function_privilege\('authenticated'/);
  assert.match(WORKFLOW, /has_function_privilege\('service_role'/);
  assert.match(WORKFLOW, /snapshot_date/);
  assert.match(WORKFLOW, /set role anon/);
  assert.match(WORKFLOW, /set role authenticated/);
  assert.match(WORKFLOW, /insert into public\.reference_graph_quick_runtime_projection_p10/);
  assert.match(WORKFLOW, /update public\.reference_graph_quick_runtime_projection_p10/);
  assert.match(WORKFLOW, /delete from public\.reference_graph_quick_runtime_projection_p10/);
});

test('P10 runtime sources have no service-role path and remain separate from production routing', () => {
  assert.doesNotMatch(RUNTIME_SOURCE, /SUPABASE_SERVICE_ROLE_KEY|service[_-]?role[_-]?(?:key|token|secret)/i);
  assert.doesNotMatch(RUNTIME_SOURCE, /ReferenceGraphSupabaseStore/);
  assert.doesNotMatch(RUNTIME_SOURCE, /knowledge\/design-references\/scripts\/query\.mjs|from ['"].*query\.mjs['"]/i);
  assert.match(CLIENT, /reference_graph_quick_runtime_projection_p10/);
  assert.doesNotMatch(CLIENT, /\/rest\/v1\/rpc\//i);
});

test('P10 README documents RLS projection, stale-snapshot fail-closed behavior, and no activation', () => {
  assert.match(README, /P10/i);
  assert.match(README, /projection/i);
  assert.match(README, /row level security|RLS/i);
  assert.match(README, /snapshot/i);
  assert.match(README, /stale/i);
  assert.match(README, /legacy-control/);
  assert.match(README, /standard/i);
  assert.match(README, /deep/i);
  assert.match(README, /no production activation|production activation.*false|activation.*later/i);
});
