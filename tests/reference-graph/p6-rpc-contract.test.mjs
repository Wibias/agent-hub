import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const migrationPath = path.join(root, 'reference-graph/schema/006_reference_graph_retrieval_quality.sql');
const readMigration = () => readFileSync(migrationPath, 'utf8');

const functions = [
  'reference_graph_lexical_candidates_p6',
  'reference_graph_semantic_candidates_p6',
  'reference_graph_candidate_context_p6',
];

function functionBody(sql, name) {
  const match = sql.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$;`,
    'i',
  ));
  assert.ok(match, `${name} body must exist`);
  return match[1];
}

test('migration 006 adds versioned P6 RPCs without replacing historical functions', () => {
  const sql = readMigration();

  for (const name of functions) {
    assert.match(sql, new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`, 'i'));
    assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\([\\s\\S]*?from\\s+public,\\s*anon,\\s*authenticated`, 'i'));
    assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([\\s\\S]*?to\\s+service_role`, 'i'));
  }

  assert.doesNotMatch(sql, /drop\s+function\s+public\.reference_graph_(?:lexical|semantic)_candidates\b/i);
});

test('P6 candidate RPCs preserve current reviewed accessible fresh eligibility', () => {
  const sql = readMigration();

  assert.match(sql, /reference_graph\.current_assets/i);
  assert.match(sql, /provenance->>'review_status'\s*=\s*'reviewed'/i);
  assert.match(sql, /access_status[\s\S]*?in\s*\('AVAILABLE',\s*'PAYWALLED'\)/i);
  assert.match(sql, /last_verified_at[\s\S]*?ttl_days[\s\S]*?>=\s*p\.reference_date/i);

  assert.match(sql, /e\.model_id\s*=\s*p_model_id/i);
  assert.match(sql, /e\.model_revision\s*=\s*p_model_revision/i);
});

test('P6 treats requested surface and platform as policy preference rather than SQL eligibility', () => {
  const sql = readMigration();

  assert.doesNotMatch(sql, /metadata->>'platform'\s*=\s*(?:p_filters|coalesce\s*\(\s*p_filters)/i);
  assert.doesNotMatch(sql, /metadata->>'surface_family'\s*=\s*(?:p_filters|coalesce\s*\(\s*p_filters)/i);
  assert.doesNotMatch(sql, /surfaceFamily[\s\S]{0,100}=\s*coalesce\s*\(\s*p_filters/i);
});

test('P6 context exposes source family and deterministic topology for pure policy ranking', () => {
  const sql = readMigration();

  assert.match(sql, /'source_family'\s*,\s*a\.source_family/i);
  assert.match(sql, /'topology'\s*,\s*a\.topology/i);
  assert.match(sql, /observation_kind\s*=\s*'topology'/i);
  assert.match(sql, /order\s+by\s+o\.id/i);
  assert.match(sql, /limit\s+1/i);
});

test('P6 candidate functions remain bounded and deterministic', () => {
  const sql = readMigration();

  assert.match(sql, /limit\s+greatest\(1,\s*least\(coalesce\(p_limit,\s*48\),\s*100\)\)/i);
  assert.match(sql, /row_number\(\)\s+over\s*\(order\s+by\s+scored\.score\s+desc,\s*scored\.asset_id\)/i);
  assert.match(sql, /row_number\(\)\s+over\s*\(order\s+by\s+scored\.distance\s+asc,\s*scored\.asset_id\)/i);
});

test('P6 semantic candidates collapse multi-chunk matches to one best row per asset', () => {
  const body = functionBody(readMigration(), 'reference_graph_semantic_candidates_p6');

  assert.match(body, /group\s+by\s+c\.asset_id/i);
  assert.match(body, /min\s*\(\s*e\.embedding\s*<=>\s*p_embedding_text::extensions\.vector\s*\)\s+as\s+distance/i);
  assert.match(body, /1\s*-\s*min\s*\(\s*e\.embedding\s*<=>\s*p_embedding_text::extensions\.vector\s*\)\s+as\s+score/i);
});
