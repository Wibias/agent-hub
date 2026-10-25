import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const SQL_PATH = 'reference-graph/schema/013_reference_graph_daily_refresh_cron.sql';
const JOB_NAME = 'reference-graph-p10-daily-refresh';
const SCHEDULE = '0,5 0 * * *';
const REFRESH = 'reference_graph_refresh_quick_runtime_projection_p10';

function sql() {
  assert.equal(existsSync(SQL_PATH), true, 'P21 migration 013 must exist');
  return readFileSync(SQL_PATH, 'utf8');
}

test('P21 migration 013 enables pg_cron and owns one exact named schedule', () => {
  const migration = sql();

  assert.match(migration, /create\s+extension\s+if\s+not\s+exists\s+pg_cron\s*;/i);
  assert.match(migration, /cron\.schedule\s*\(/i);
  assert.match(migration, new RegExp(`['"]${JOB_NAME}['"]`, 'i'));
  assert.match(migration, new RegExp(`['"]${SCHEDULE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'i'));
});

test('P21 cron command calls only the governed P10 refresh function', () => {
  const migration = sql();

  assert.match(
    migration,
    new RegExp(`select\\s+public\\.${REFRESH}\\s*\\(\\s*\\)\\s*;`, 'i'),
  );

  assert.doesNotMatch(migration, /https?:\/\//i);
  assert.doesNotMatch(migration, /pg_net|net\.http_|edge[_ -]?function/i);
  assert.doesNotMatch(migration, /SUPABASE_(?:URL|PUBLISHABLE_KEY|SECRET_KEY|SERVICE_ROLE_KEY)/i);
  assert.doesNotMatch(migration, /sb_(?:secret|publishable)_/i);
  assert.doesNotMatch(migration, /vault\./i);
});

test('P21 does not widen P10 refresh privileges or mutate activation controls', () => {
  const migration = sql();

  assert.doesNotMatch(migration, /grant\s+execute/i);
  assert.doesNotMatch(migration, /activation_grant|consume_activation|quick_graph_enabled|repository_default_graph_enabled/i);
  assert.doesNotMatch(migration, /reference_graph_activation_state|p17/i);
});
