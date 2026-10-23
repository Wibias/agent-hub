import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const workflow = () => read('.github/workflows/verify-reference-graph.yml');

test('permanent governance executes P7 contracts, migration 007, identity checks, and P7 secret scanning', () => {
  const source = workflow();
  assert.match(source, /tests\/reference-graph\/\*\.test\.mjs/);
  assert.match(source, /assertSecretFreeP7Receipt/);
  assert.match(source, /p7-lexical-parity-evidence\.json/);
  assert.match(source, /007_reference_graph_lexical_parity\.sql/);
  assert.match(source, /P7.*benchmark independent|benchmark independent.*P7/i);
  assert.match(source, /P7.*identity|identity.*P7/i);
  assert.match(source, /Smoke-test P7.*candidate pool|candidate pool.*P7/i);
});

test('P7 production sources stay independent from benchmark outcomes and legacy selector implementation', () => {
  const productionSources = [
    'reference-graph/p7-parity-policy.mjs',
    'reference-graph/p7-live-shadow.mjs',
    'reference-graph/legacy-import.mjs',
    'reference-graph/supabase-store.mjs',
    'reference-graph/schema/007_reference_graph_lexical_parity.sql',
  ];
  const productionForbidden = /shadow-cases\.json|p[3-7].*evidence\.json|authenticated-home-mobile|auth-mobile|design-system-mobile|expected[_-]?legacy|legacy[_-]?expected|knowledge\/design-references\/scripts\/selection\.mjs/i;
  for (const file of productionSources) {
    assert.doesNotMatch(read(file), productionForbidden, file);
  }

  // The read-only operator intentionally loads the fixed shadow cases to evaluate
  // the policy. It must still stay independent from expected IDs, evidence outcomes,
  // and the legacy selector implementation itself.
  const operator = read('reference-graph/cli/p7-live-quality.mjs');
  assert.doesNotMatch(
    operator,
    /p[3-7].*evidence\.json|authenticated-home-mobile|auth-mobile|design-system-mobile|expected[_-]?legacy|legacy[_-]?expected|knowledge\/design-references\/scripts\/selection\.mjs/i,
  );
});

test('permanent P7 DB smoke proves full eligible pool fields, hard eligibility, and service-only grants', () => {
  const source = workflow();
  assert.match(source, /reference_graph_quick_candidate_pool_p7/);
  for (const token of [
    'legacy_id',
    'search_text',
    'product',
    'surface_family',
    'platform',
    'page_role',
    'motion',
    'source_family',
    'topology',
    'access_status',
    'evidence_class',
    'ordinary_or_failure_prone',
    'multi_state_flow',
    'tags',
  ]) {
    assert.match(source, new RegExp(token));
  }
  assert.match(source, /stale/i);
  assert.match(source, /candidate|unreviewed/i);
  assert.match(source, /blocked/i);
  assert.match(source, /set role service_role/i);
  assert.match(source, /set role anon/i);
  assert.match(source, /set role authenticated/i);
});

test('permanent governance pins P3 through P6 evidence and current-control invariants', () => {
  const source = workflow();
  for (const evidence of [
    'p3-live-shadow-evidence.json',
    'p4-freshness-quality-evidence.json',
    'p5-live-shadow-evidence.json',
    'p6-retrieval-quality-evidence.json',
  ]) {
    assert.match(source, new RegExp(evidence.replaceAll('.', '\\.')));
  }
  assert.match(source, /immutable P3, P4, P5, and P6|P3.*P4.*P5.*P6/i);
  assert.match(source, /Measure current P5 legacy control health/i);
  assert.match(source, /fresh_pool_count[^\n]*275|275[^\n]*fresh_pool_count/i);
  assert.match(source, /full_limit_case_count[^\n]*24|24[^\n]*full_limit_case_count/i);
  assert.match(source, /cases_with_coverage_gaps[^\n]*0|0[^\n]*cases_with_coverage_gaps/i);
});
