import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const migrationPath = path.join(root, 'reference-graph/schema/008_reference_graph_runtime_canary.sql');
const readMigration = () => readFileSync(migrationPath, 'utf8');

const P9 = 'reference_graph_quick_candidate_pool_runtime_p9';
const P7 = 'reference_graph_quick_candidate_pool_p7';

function functionBody(sql) {
  const match = sql.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${P9}\\s*\\(\\s*\\)[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$;`,
    'i',
  ));
  assert.ok(match, `${P9} body must exist`);
  return match[1];
}

test('migration 008 adds one zero-argument least-privilege runtime RPC', () => {
  const sql = readMigration();

  assert.match(sql, new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${P9}\\s*\\(\\s*\\)`, 'i'));
  assert.match(sql, /\bstable\b/i);
  assert.match(sql, /security\s+definer/i);
  assert.match(sql, /set\s+search_path\s*=\s*pg_catalog,\s*public,\s*reference_graph/i);
  assert.match(sql, /set\s+statement_timeout\s*=\s*'2s'/i);
});

test('P9 runtime RPC delegates only to the certified P7 pool at current_date', () => {
  const body = functionBody(readMigration());

  assert.match(body, new RegExp(`public\\.${P7}\\s*\\(`, 'i'));
  assert.match(body, /jsonb_build_object\s*\(\s*'reference_date'\s*,\s*current_date::text\s*\)/i);
  assert.doesNotMatch(body, /p_filters|p_reference_date|p_query|embedding|model/i);
  assert.doesNotMatch(body, /\b(?:insert|update|delete|merge|truncate)\b/i);
});

test('P9 runtime RPC exposes exactly the 15 certified P7 candidate columns', () => {
  const sql = readMigration();
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
  ];
  for (const column of requiredColumns) {
    const pattern = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    assert.match(sql, new RegExp(pattern, 'i'), `missing return column ${column}`);
  }
});

test('P9 grants only the narrow wrapper to runtime roles and keeps P7 grants untouched', () => {
  const sql = readMigration();

  assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${P9}\\(\\)[\\s\\S]*?from\\s+public,\\s*anon,\\s*authenticated,\\s*service_role`, 'i'));
  assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${P9}\\(\\)[\\s\\S]*?to\\s+anon,\\s*authenticated,\\s*service_role`, 'i'));

  assert.doesNotMatch(sql, new RegExp(`grant[\\s\\S]*?public\\.${P7}\\(jsonb\\)[\\s\\S]*?to\\s+(?:anon|authenticated)`, 'i'));
  assert.doesNotMatch(sql, new RegExp(`revoke[\\s\\S]*?public\\.${P7}\\(jsonb\\)`, 'i'));
});

test('migration 008 does not broaden table privileges or mutate historical RPC definitions', () => {
  const sql = readMigration();

  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete|all)\s+on\s+(?:table\s+)?reference_graph\./i);
  assert.doesNotMatch(sql, /create\s+or\s+replace\s+function\s+public\.reference_graph_(?:quick_candidate_pool_p7|lexical_candidates_p6|semantic_candidates_p6|candidate_context_p6)\b/i);
  assert.doesNotMatch(sql, /drop\s+function/i);
});
