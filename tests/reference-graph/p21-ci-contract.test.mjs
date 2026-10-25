import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const WORKFLOW_PATH = '.github/workflows/verify-reference-graph-p21.yml';

function workflow() {
  assert.equal(existsSync(WORKFLOW_PATH), true, 'P21 governance workflow must exist');
  return readFileSync(WORKFLOW_PATH, 'utf8');
}

test('P21 governance runs contracts on PRs and main with Supabase Postgres 17', () => {
  const value = workflow();

  assert.match(value, /^name:\s*Reference graph P21 governance/m);
  assert.match(value, /pull_request\s*:/);
  assert.match(value, /push\s*:[\s\S]*branches\s*:[\s\S]*-\s+main/);
  assert.match(value, /node --test tests\/reference-graph\/p21-\*\.test\.mjs/);
  assert.match(value, /image:\s*supabase\/postgres:17\.11\.0\.007/);
  assert.match(value, /013_reference_graph_daily_refresh_cron\.sql/);
});

test('P21 governance proves exact cron identity and idempotence', () => {
  const value = workflow();

  assert.match(value, /Reapply P21 scheduler migration to prove idempotence/);
  assert.match(value, /cron\.job/);
  assert.match(value, /reference-graph-p10-daily-refresh/);
  assert.match(value, /0,5 0 \* \* \*/);
  assert.match(value, /reference_graph_refresh_quick_runtime_projection_p10/);
  assert.match(value, /count\(\*\)[\s\S]*cron\.job/is);
});

test('P21 governance retains the P10 privilege boundary', () => {
  const value = workflow();

  assert.match(value, /has_function_privilege\(\s*'anon'.*reference_graph_refresh_quick_runtime_projection_p10.*EXECUTE/is);
  assert.match(value, /has_function_privilege\(\s*'authenticated'.*reference_graph_refresh_quick_runtime_projection_p10.*EXECUTE/is);
  assert.match(value, /has_function_privilege\(\s*'service_role'.*reference_graph_refresh_quick_runtime_projection_p10.*EXECUTE/is);
});

test('P21 CI contains no production target or production credentials', () => {
  const value = workflow();

  assert.doesNotMatch(value, /vrznfnxzlxaavpqbzbzd/);
  assert.doesNotMatch(value, /SUPABASE_(?:SECRET_KEY|SERVICE_ROLE_KEY|PUBLISHABLE_KEY|URL)/);
  assert.doesNotMatch(value, /sb_(?:secret|publishable)_/i);
});
