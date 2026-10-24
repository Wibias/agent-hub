import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const migrationPath = path.join(root, 'reference-graph/schema/007_reference_graph_lexical_parity.sql');
const readMigration = () => readFileSync(migrationPath, 'utf8');

const FUNCTION = 'reference_graph_quick_candidate_pool_p7';

function functionBody(sql) {
  const match = sql.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${FUNCTION}\\b[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$;`,
    'i',
  ));
  assert.ok(match, `${FUNCTION} body must exist`);
  return match[1];
}

test('migration 007 adds one service-role-only P7 full-pool RPC', () => {
  const sql = readMigration();

  assert.match(sql, new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${FUNCTION}\\s*\\(\\s*p_filters\\s+jsonb`, 'i'));
  assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${FUNCTION}\\(jsonb\\)[\\s\\S]*?from\\s+public,\\s*anon,\\s*authenticated`, 'i'));
  assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${FUNCTION}\\(jsonb\\)[\\s\\S]*?to\\s+service_role`, 'i'));
  assert.match(sql, /security\s+definer/i);

  assert.doesNotMatch(sql, /drop\s+function\s+public\.reference_graph_(?:lexical_candidates_p6|semantic_candidates_p6|candidate_context_p6)/i);
  assert.doesNotMatch(sql, /create\s+or\s+replace\s+function\s+public\.reference_graph_(?:lexical_candidates_p6|semantic_candidates_p6|candidate_context_p6)\b/i);
});

test('P7 candidate pool preserves current reviewed accessible fresh eligibility only', () => {
  const body = functionBody(readMigration());

  assert.match(body, /reference_graph\.current_assets/i);
  assert.match(body, /provenance->>'review_status'\s*=\s*'reviewed'/i);
  assert.match(body, /coalesce\s*\(\s*a\.metadata->>'access_status'\s*,\s*s\.metadata->>'access_status'\s*\)\s+in\s*\('AVAILABLE',\s*'PAYWALLED'\)/i);
  assert.match(body, /last_verified_at[\s\S]*?ttl_days[\s\S]*?>=\s*p\.reference_date/i);
  assert.match(body, /coalesce\s*\(\s*nullif\s*\(\s*p_filters->>'reference_date'/i);

  assert.doesNotMatch(body, /metadata->>'platform'\s*=\s*(?:p_filters|coalesce\s*\(\s*p_filters)/i);
  assert.doesNotMatch(body, /metadata->>'surface_family'\s*=\s*(?:p_filters|coalesce\s*\(\s*p_filters)/i);
});

test('P7 candidate pool exposes every graph field required by the pure parity policy', () => {
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

  const body = functionBody(sql);
  assert.match(body, /nullif\s*\(\s*trim\s*\(\s*a\.metadata->>'legacy_id'\s*\)\s*,\s*''\s*\)\s+is\s+not\s+null/i);
  assert.match(body, /a\.metadata->>'evidence_class'/i);
  assert.match(body, /a\.metadata->>'ordinary_or_failure_prone'/i);
  assert.match(body, /a\.metadata->>'multi_state_flow'/i);
  assert.match(body, /coalesce\s*\(\s*nullif\s*\(\s*a\.metadata->>'source_family'\s*,\s*''\s*\)\s*,\s*s\.source_family\s*\)/i);
  assert.match(body, /observation_kind\s*=\s*'topology'/i);
});

test('P7 candidate pool reconstructs deterministic full search text and sorted tags', () => {
  const body = functionBody(readMigration());

  assert.match(body, /string_agg\s*\(\s*c\.content\s*,\s*E?'\\n'\s+order\s+by\s+c\.ordinal\s*\)/i);
  assert.match(body, /jsonb_agg\s*\(\s*t\.slug\s+order\s+by\s+t\.slug\s*\)/i);
  assert.match(body, /order\s+by\s+a\.id/i);
  assert.match(body, /order\s+by\s+o\.id[\s\S]*?limit\s+1/i);
});

test('P7 candidate pool is query-agnostic, embedding-free, and read-only', () => {
  const sql = readMigration();
  const signature = sql.match(new RegExp(`function\\s+public\\.${FUNCTION}\\s*\\(([^)]*)\\)`, 'i'));
  assert.ok(signature);
  assert.doesNotMatch(signature[1], /query|embedding|model|limit/i);

  const body = functionBody(sql);
  assert.doesNotMatch(body, /reference_graph\.embeddings/i);
  assert.doesNotMatch(body, /search_vector|tsquery|p_query/i);
  assert.doesNotMatch(body, /\b(?:insert|update|delete|merge|truncate)\b/i);
});
