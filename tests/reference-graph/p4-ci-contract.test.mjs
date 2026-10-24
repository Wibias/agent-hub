import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

test('permanent Reference Graph CI executes P4 migration and scans P3/P4 evidence artifacts', () => {
  const workflow = read('.github/workflows/verify-reference-graph.yml');

  assert.match(workflow, /005_reference_graph_freshness\.sql/);
  assert.match(workflow, /p3-live-shadow-evidence\.json/);
  assert.match(workflow, /p4-revalidation-results\.json/);
  assert.match(workflow, /p4-freshness-quality-evidence\.json/);
  assert.match(workflow, /assertSecretFreeP4Receipt/);
});

test('permanent CI smoke covers current asset freshness hash coverage and idempotent verification evidence', () => {
  const workflow = read('.github/workflows/verify-reference-graph.yml');

  for (const evidence of [
    'current_assets',
    'reference_date',
    'reference_graph_embedding_coverage',
    'text_hash_mismatch_count',
    'reference_graph_record_verifications',
    'decision_hash',
  ]) {
    assert.match(workflow, new RegExp(evidence));
  }
  assert.match(workflow, /set role anon/i);
  assert.match(workflow, /set role authenticated/i);
  assert.match(workflow, /unexpectedly executed/i);
});

test('P4 documentation keeps link health separate from revalidation authority and explains full unbiased maintenance', () => {
  const graphReadme = read('reference-graph/README.md');
  const catalogReadme = read('knowledge/design-references/README.md');
  const combined = `${graphReadme}\n${catalogReadme}`;

  assert.match(combined, /link health[^\n]*(?:triage|maintenance)/i);
  assert.match(combined, /benchmark[- ]independent/i);
  assert.match(combined, /full stale maintainable|entire stale maintainable/i);
  assert.match(combined, /reviewedAt[^\n]*(?:not|never)[^\n]*(?:rewrite|change|advance)/i);
  assert.match(graphReadme, /--export-rows/);
  assert.match(graphReadme, /--verify-embeddings/);
  assert.match(graphReadme, /current[^\n]*historical|historical[^\n]*current/i);
  assert.match(graphReadme, /no cutover|does not perform a cutover|never performs a cutover/i);
});
