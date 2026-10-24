import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { assessLegacyControlHealth } from '../../reference-graph/shadow-eval.mjs';

const REFERENCE_TIME = new Date('2026-10-23T12:00:00.000Z');

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

test('P5 quick coverage repair makes the unchanged current catalog a healthy control', () => {
  const records = loadRecords();
  const cases = readJson('../../reference-graph/shadow-cases.json');
  const before = JSON.stringify(records);

  const health = assessLegacyControlHealth({
    records,
    cases,
    now: REFERENCE_TIME,
  });

  assert.equal(health.fresh_pool_count, 275);
  assert.equal(health.case_count, 24);
  assert.equal(health.full_limit_case_count, 24);
  assert.equal(health.cases_with_coverage_gaps, 0);
  assert.deepEqual(health.blockers, []);
  assert.equal(health.healthy, true);
  assert.equal(JSON.stringify(records), before);
});

test('P5 production selector remains independent of shadow benchmark fixtures and diagnosed case ids', () => {
  const productionSources = [
    '../../knowledge/design-references/scripts/selection.mjs',
    '../../knowledge/design-references/scripts/quick-coverage.mjs',
  ].map((relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8'));

  for (const source of productionSources) {
    assert.doesNotMatch(source, /shadow-cases\.json/);
    assert.doesNotMatch(source, /authenticated-home-mobile|auth-mobile|design-system-mobile/);
    assert.doesNotMatch(source, /reference-graph\//);
  }
});

test('P5 leaves immutable P3 and P4 evidence history unchanged', () => {
  const p3 = readJson('../../reference-graph/evidence/p3-live-shadow-evidence.json');
  const p4 = readJson('../../reference-graph/evidence/p4-freshness-quality-evidence.json');

  assert.equal(p3.benchmark_control_health.fresh_pool_count, 600);
  assert.equal(p3.benchmark_control_health.cases_with_coverage_gaps, 0);
  assert.equal(p3.benchmark_control_health.healthy, true);

  assert.equal(p4.current_control_health.fresh_pool_count, 275);
  assert.equal(p4.current_control_health.cases_with_coverage_gaps, 3);
  assert.equal(p4.current_control_health.healthy, false);
  assert.equal(p4.production_source, 'legacy-control');
  assert.equal(p4.decision, 'no-cutover');
  assert.equal(p4.cutover_ready, false);
});
