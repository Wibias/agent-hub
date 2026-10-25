import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const SQL_PATH = 'reference-graph/schema/012_reference_graph_safeupdate_refresh.sql';
const REFRESH = 'reference_graph_refresh_quick_runtime_projection_p10';
const PROJECTION = 'reference_graph_quick_runtime_projection_p10';
const P7 = 'reference_graph_quick_candidate_pool_p7';

function sql() {
  assert.equal(existsSync(SQL_PATH), true, 'P20 migration 012 must exist');
  return readFileSync(SQL_PATH, 'utf8');
}

function body(value) {
  const match = value.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${REFRESH}\\s*\\(\\s*\\)[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$;`,
    'i',
  ));
  assert.ok(match, 'P20 must replace the P10 refresh function');
  return match[1];
}

test('P20 migration 012 replaces the refresh with a safeupdate-compatible full delete', () => {
  const migration = sql();
  const functionBody = body(migration);
  assert.match(functionBody, new RegExp(`delete\\s+from\\s+public\\.${PROJECTION}\\s+where\\s+true\\s*;`, 'i'));
  assert.doesNotMatch(functionBody, new RegExp(`delete\\s+from\\s+public\\.${PROJECTION}\\s*;`, 'i'));
});

test('P20 refresh preserves current-date P7 projection semantics', () => {
  const functionBody = body(sql());
  assert.match(functionBody, new RegExp(`public\\.${P7}\\s*\\(`, 'i'));
  assert.match(functionBody, /jsonb_build_object\s*\(\s*'reference_date'\s*,\s*current_date::text\s*\)/i);
  assert.match(functionBody, new RegExp(`insert\\s+into\\s+public\\.${PROJECTION}`, 'i'));
  assert.match(functionBody, /'snapshot_date'\s*,\s*current_date::text/i);
});

test('P20 refresh remains bounded SECURITY DEFINER and service-role-only', () => {
  const migration = sql();
  assert.match(migration, new RegExp(`public\\.${REFRESH}\\s*\\(\\s*\\)[\\s\\S]*?security\\s+definer`, 'i'));
  assert.match(migration, /set\s+search_path\s*=\s*pg_catalog,\s*public,\s*reference_graph/i);
  assert.match(migration, /set\s+statement_timeout\s*=\s*'5s'/i);
  assert.match(migration, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${REFRESH}\\(\\)[\\s\\S]*?from\\s+public,\\s*anon,\\s*authenticated,\\s*service_role`, 'i'));
  assert.match(migration, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${REFRESH}\\(\\)[\\s\\S]*?to\\s+service_role`, 'i'));
  assert.doesNotMatch(migration, new RegExp(`grant\\s+execute[\\s\\S]*?public\\.${REFRESH}\\(\\)[\\s\\S]*?to\\s+(?:anon|authenticated)`, 'i'));
});
