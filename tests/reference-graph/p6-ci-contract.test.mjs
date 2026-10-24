import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

const workflow = () => read('.github/workflows/verify-reference-graph.yml');

test('permanent governance executes P6 contracts, migration 006, and P6 secret scanning', () => {
  const source = workflow();
  assert.match(source, /tests\/reference-graph\/\*\.test\.mjs/);
  assert.match(source, /assertSecretFreeP6Receipt/);
  assert.match(source, /p6-retrieval-quality-evidence\.json/);
  assert.match(source, /006_reference_graph_retrieval_quality\.sql/);
  assert.match(source, /Verify P6 retrieval policy is benchmark independent/i);
  assert.match(source, /Smoke-test P6 retrieval eligibility, preference semantics, and RPC grants/i);
});

test('P6 production retrieval sources stay independent from benchmark outcomes and expected ids', () => {
  const sources = [
    'reference-graph/retrieval-policy.mjs',
    'reference-graph/p6-live-shadow.mjs',
    'reference-graph/supabase-store.mjs',
    'reference-graph/schema/006_reference_graph_retrieval_quality.sql',
  ];
  const forbidden = /p5-live-shadow-evidence\.json|p6-retrieval-quality-evidence\.json|authenticated-home-mobile|auth-mobile|design-system-mobile|expected[_-]?legacy|legacy[_-]?expected/i;
  for (const file of sources) {
    assert.doesNotMatch(read(file), forbidden, file);
  }

  const operator = read('reference-graph/cli/p6-live-quality.mjs');
  assert.doesNotMatch(operator, /p5-live-shadow-evidence\.json|p6-retrieval-quality-evidence\.json|authenticated-home-mobile|auth-mobile|design-system-mobile|expected[_-]?legacy/i);
});

test('permanent P6 DB smoke preserves P5 RPCs while proving soft preference and hard eligibility', () => {
  const source = workflow();
  for (const rpc of [
    'reference_graph_lexical_candidates_p6',
    'reference_graph_semantic_candidates_p6',
    'reference_graph_candidate_context_p6',
  ]) {
    assert.match(source, new RegExp(rpc));
  }
  for (const historicalRpc of [
    'reference_graph_lexical_candidates',
    'reference_graph_semantic_candidates',
    'reference_graph_candidate_context',
  ]) {
    assert.match(source, new RegExp(historicalRpc));
  }
  assert.match(source, /cross[-_ ]surface|cross[-_ ]platform|soft preference/i);
  assert.match(source, /stale/i);
  assert.match(source, /unreviewed/i);
  assert.match(source, /blocked/i);
  assert.match(source, /set role anon/i);
  assert.match(source, /set role authenticated/i);
  assert.match(source, /set role service_role/i);
});

test('permanent governance pins P3 P4 and P5 evidence history while measuring current control', () => {
  const source = workflow();
  assert.match(source, /p3-live-shadow-evidence\.json/);
  assert.match(source, /p4-freshness-quality-evidence\.json/);
  assert.match(source, /p5-control-coverage-evidence\.json|p5-live-shadow-evidence\.json/);
  assert.match(source, /Verify immutable P3, P4(?:, and P5|, P5, and P6) historical evidence/i);
  assert.match(source, /Measure current P5 legacy control health/i);
  assert.match(source, /fresh_pool_count[^\n]*275|275[^\n]*fresh_pool_count/i);
  assert.match(source, /full_limit_case_count[^\n]*24|24[^\n]*full_limit_case_count/i);
  assert.match(source, /cases_with_coverage_gaps[^\n]*0|0[^\n]*cases_with_coverage_gaps/i);
});
