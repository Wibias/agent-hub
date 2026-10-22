import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

const REQUIRED_FILES = [
  'reference-graph/README.md',
  'reference-graph/schema/001_reference_graph.sql',
  'reference-graph/capture.mjs',
  'reference-graph/legacy-import.mjs',
  'reference-graph/retrieval.mjs',
  'reference-graph/memory-promotion.mjs',
];

test('reference graph P0 exposes the agreed repository-native foundation', () => {
  for (const relative of REQUIRED_FILES) {
    assert.equal(existsSync(path.join(root, relative)), true, `${relative} must exist`);
  }
});

test('postgres contract covers the reference graph entities and keeps exposed access closed by default', () => {
  const sql = read('reference-graph/schema/001_reference_graph.sql');

  assert.match(sql, /create extension if not exists vector/i);
  assert.match(sql, /create schema if not exists reference_graph/i);

  for (const table of [
    'sources',
    'assets',
    'chunks',
    'tags',
    'asset_tags',
    'relations',
    'observations',
    'collections',
    'collection_items',
    'embeddings',
    'usage_feedback',
  ]) {
    assert.match(sql, new RegExp(`create table(?: if not exists)? reference_graph\\.${table}\\b`, 'i'));
    assert.match(sql, new RegExp(`alter table reference_graph\\.${table} enable row level security`, 'i'));
  }

  assert.match(sql, /revoke all on schema reference_graph from anon, authenticated/i);
  assert.match(sql, /revoke all on all tables in schema reference_graph from anon, authenticated/i);
});

test('P0 vector retrieval stays exact until model-scoped ANN has measured justification', () => {
  const sql = read('reference-graph/schema/001_reference_graph.sql');
  const readme = read('reference-graph/README.md');

  assert.doesNotMatch(sql, /using\s+(?:hnsw|ivfflat)\b/i);
  assert.match(sql, /model_id\s+text\s+not null/i);
  assert.match(sql, /model_revision\s+text\s+not null/i);
  assert.match(readme, /exact.*vector|vector.*exact/i);
  assert.match(readme, /model_id.*model_revision|model identity.*revision/i);
  assert.match(readme, /ann.*defer|defer.*ann|hnsw.*defer/i);
});

test('foundation preserves the legacy control and authority boundaries', () => {
  const readme = read('reference-graph/README.md');

  assert.match(readme, /legacy design-reference selector.*control|control.*legacy design-reference selector/i);
  assert.match(readme, /fallback/i);
  assert.match(readme, /external content.*data.*not instructions/i);
  assert.match(readme, /relevance.*never.*authority/i);
  assert.match(readme, /memory.*explicit.*promotion|explicit.*promotion.*memory/i);
  assert.match(readme, /no live supabase deployment|does not deploy supabase/i);
  assert.match(readme, /no browser extension|does not add a browser extension/i);
});
