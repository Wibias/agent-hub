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

test('foundation preserves historical P0 boundaries while current docs enforce P3 safety', () => {
  const readme = read('reference-graph/README.md');
  const p0Spec = read('docs/superpowers/specs/2026-10-23-reference-graph-foundation-design.md');

  assert.match(readme, /legacy design-reference selector.*control|control.*legacy design-reference selector/i);
  assert.match(readme, /fallback/i);
  assert.match(readme, /external content.*data.*not instructions/i);
  assert.match(readme, /relevance.*never.*authority/i);
  assert.match(readme, /memory.*explicit.*promotion|explicit.*promotion.*memory/i);
  assert.match(p0Spec, /does not deploy Supabase|live infrastructure deployment is intentionally deferred/i);
  assert.match(readme, /must not mutate an ambiguously identified Supabase project|not considered a Reference Graph target by assumption/i);
  assert.match(readme, /does not add a browser extension|no browser extension/i);
  assert.match(readme, /does not switch production selection|production_source.*legacy-control|legacy selector remains production/i);
});

test('permanent Reference Graph governance secret-scans evidence and separates historical benchmark from current control', () => {
  const workflow = read('.github/workflows/verify-reference-graph.yml');

  assert.match(workflow, /Scan P3 committed artifacts for secrets/i);
  assert.match(workflow, /reference-graph\/target\.json/);
  assert.match(workflow, /reference-graph\/evidence\/p3-live-shadow-evidence\.json/);
  assert.match(workflow, /assertSecretFreeReceipt/);
  assert.match(workflow, /Scan Reference Graph tree for common secrets/i);
  assert.match(workflow, /scan_secrets\.py\s+reference-graph/);
  assert.match(workflow, /tests\/reference-graph\/\*\.test\.mjs/);
  assert.match(workflow, /Verify immutable P2\/P3 historical benchmark evidence/i);
  assert.match(workflow, /2026-07-21T12:00:00\.000Z/);
  assert.match(workflow, /Measure current P4 legacy control health/i);
  assert.match(workflow, /--current-control\s+--reference-date\s+2026-10-23/);
  assert.doesNotMatch(workflow, /--offline\s+--control-date\s+2026-07-21/);
});
