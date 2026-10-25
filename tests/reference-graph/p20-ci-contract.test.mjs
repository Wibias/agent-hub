import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const WORKFLOW_PATH = '.github/workflows/verify-reference-graph-p20.yml';
const WORKFLOW = readFileSync(WORKFLOW_PATH, 'utf8');

test('P20 governance runs contracts and disposable PostgreSQL smoke', () => {
  assert.match(WORKFLOW, /^name:\s*Reference graph P20 governance/m);
  assert.match(WORKFLOW, /pull_request\s*:/);
  assert.match(WORKFLOW, /push\s*:[\s\S]*branches\s*:[\s\S]*-\s+main/);
  assert.match(WORKFLOW, /node --test tests\/reference-graph\/p20-\*\.test\.mjs/);
  assert.match(WORKFLOW, /image:\s*pgvector\/pgvector:pg16/);
  assert.match(WORKFLOW, /012_reference_graph_safeupdate_refresh\.sql/);
  assert.match(WORKFLOW, /reference_graph_refresh_quick_runtime_projection_p10/);
});

test('P20 governance keeps the production target and credentials out of CI', () => {
  assert.doesNotMatch(WORKFLOW, /vrznfnxzlxaavpqbzbzd/);
  assert.doesNotMatch(WORKFLOW, /SUPABASE_(?:SECRET_KEY|SERVICE_ROLE_KEY|PUBLISHABLE_KEY|URL)/);
});

test('P20 PostgreSQL smoke checks service-role-only refresh privilege', () => {
  assert.match(WORKFLOW, /has_function_privilege\(\s*'anon'.*reference_graph_refresh_quick_runtime_projection_p10.*EXECUTE/is);
  assert.match(WORKFLOW, /has_function_privilege\(\s*'authenticated'.*reference_graph_refresh_quick_runtime_projection_p10.*EXECUTE/is);
  assert.match(WORKFLOW, /has_function_privilege\(\s*'service_role'.*reference_graph_refresh_quick_runtime_projection_p10.*EXECUTE/is);
});
