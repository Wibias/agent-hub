import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const migrationPath = path.join(root, 'reference-graph/schema/009_reference_graph_runtime_projection.sql');
const readMigration = () => readFileSync(migrationPath, 'utf8');

const PROJECTION = 'reference_graph_quick_runtime_projection_p10';
const REFRESH = 'reference_graph_refresh_quick_runtime_projection_p10';
const P9 = 'reference_graph_quick_candidate_pool_runtime_p9';
const P7 = 'reference_graph_quick_candidate_pool_p7';

function refreshBody(sql) {
  const match = sql.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${REFRESH}\\s*\\(\\s*\\)[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$;`,
    'i',
  ));
  assert.ok(match, `${REFRESH} body must exist`);
  return match[1];
}

test('migration 009 creates the exact P10 quick runtime projection surface', () => {
  const sql = readMigration();
  assert.match(sql, new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+public\\.${PROJECTION}`, 'i'));

  const requiredColumns = [
    'asset_id uuid',
    'legacy_id text',
    'product text',
    'surface_family text',
    'platform text',
    'page_role text',
    'motion text',
    'source_family text',
    'topology text',
    'access_status text',
    'evidence_class text',
    'ordinary_or_failure_prone boolean',
    'multi_state_flow boolean',
    'tags jsonb',
    'search_text text',
    'snapshot_date date',
    'refreshed_at timestamptz',
  ];

  for (const column of requiredColumns) {
    const pattern = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    assert.match(sql, new RegExp(pattern, 'i'), `missing projection column ${column}`);
  }

  assert.match(sql, new RegExp(`primary\\s+key[\\s\\S]*?asset_id|asset_id\\s+uuid[\\s\\S]*?primary\\s+key`, 'i'));
  assert.match(sql, /legacy_id\s+text[\s\S]*?unique/i);
});

test('P10 projection grants runtime roles SELECT only behind current-date RLS', () => {
  const sql = readMigration();

  assert.match(sql, new RegExp(`alter\\s+table\\s+public\\.${PROJECTION}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
  assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+(?:table\\s+)?public\\.${PROJECTION}[\\s\\S]*?from\\s+public,\\s*anon,\\s*authenticated`, 'i'));
  assert.match(sql, new RegExp(`grant\\s+select\\s+on\\s+(?:table\\s+)?public\\.${PROJECTION}[\\s\\S]*?to\\s+anon,\\s*authenticated`, 'i'));
  assert.match(sql, new RegExp(`create\\s+policy[\\s\\S]*?on\\s+public\\.${PROJECTION}[\\s\\S]*?for\\s+select[\\s\\S]*?to\\s+anon,\\s*authenticated[\\s\\S]*?using\\s*\\(\\s*snapshot_date\\s*=\\s*current_date\\s*\\)`, 'i'));

  assert.doesNotMatch(sql, new RegExp(`grant\\s+(?:insert|update|delete|truncate|all)[\\s\\S]*?public\\.${PROJECTION}[\\s\\S]*?to\\s+(?:anon|authenticated)`, 'i'));
});

test('migration 009 closes the public P9 SECURITY DEFINER runtime wrapper', () => {
  const sql = readMigration();

  assert.match(sql, new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${P9}\\(\\)[\\s\\S]*?from\\s+anon,\\s*authenticated`, 'i'));
  assert.doesNotMatch(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${P9}\\(\\)[\\s\\S]*?to\\s+(?:anon|authenticated)`, 'i'));
});

test('P10 refresh is a no-argument current-date service-role-only SECURITY DEFINER RPC', () => {
  const sql = readMigration();
  const body = refreshBody(sql);

  assert.match(sql, new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${REFRESH}\\s*\\(\\s*\\)`, 'i'));
  assert.match(sql, new RegExp(`public\\.${REFRESH}\\s*\\(\\s*\\)[\\s\\S]*?security\\s+definer`, 'i'));
  assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${REFRESH}\\(\\)[\\s\\S]*?from\\s+public,\\s*anon,\\s*authenticated,\\s*service_role`, 'i'));
  assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${REFRESH}\\(\\)[\\s\\S]*?to\\s+service_role`, 'i'));
  assert.doesNotMatch(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${REFRESH}\\(\\)[\\s\\S]*?to\\s+(?:anon|authenticated)`, 'i'));

  assert.match(body, new RegExp(`public\\.${P7}\\s*\\(`, 'i'));
  assert.match(body, /jsonb_build_object\s*\(\s*'reference_date'\s*,\s*current_date::text\s*\)/i);
  assert.match(body, new RegExp(`(?:delete\\s+from|truncate\\s+(?:table\\s+)?)\\s+public\\.${PROJECTION}`, 'i'));
  assert.match(body, new RegExp(`insert\\s+into\\s+public\\.${PROJECTION}`, 'i'));
  assert.doesNotMatch(body, /p_filters|p_reference_date|p_query|embedding|model/i);
});

test('migration 009 does not broaden access to underlying Reference Graph tables or historical RPCs', () => {
  const sql = readMigration();

  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete|all)\s+on\s+(?:table\s+)?reference_graph\./i);
  assert.doesNotMatch(sql, /grant\s+execute[\s\S]*?reference_graph_(?:quick_candidate_pool_p7|lexical_candidates_p6|semantic_candidates_p6|candidate_context_p6)[\s\S]*?to\s+(?:anon|authenticated)/i);
  assert.doesNotMatch(sql, /create\s+or\s+replace\s+function\s+public\.reference_graph_(?:quick_candidate_pool_p7|lexical_candidates_p6|semantic_candidates_p6|candidate_context_p6)\b/i);
});
