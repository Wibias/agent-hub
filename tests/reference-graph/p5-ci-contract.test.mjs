import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

test('permanent governance verifies the repaired P5 current control while preserving P4 evidence history', () => {
  const workflow = read('.github/workflows/verify-reference-graph.yml');

  assert.match(workflow, /p5-live-quality\.mjs --current-control --reference-date 2026-10-23/);
  assert.match(workflow, /fresh_pool_count[^\n]*275|fresh_pool_count\) !== 275/);
  assert.match(workflow, /full_limit_case_count[^\n]*24|full_limit_case_count\) !== 24/);
  assert.match(workflow, /cases_with_coverage_gaps[^\n]*0|cases_with_coverage_gaps\) !== 0/);
  assert.match(workflow, /healthy[^\n]*(?:true|!== true)/);

  assert.match(workflow, /p4-freshness-quality-evidence\.json/);
  assert.match(workflow, /P4[^\n]*(?:3|coverage gaps)|cases_with_coverage_gaps[^\n]*3/i);
});

test('permanent governance secret-scans optional P5 evidence with the P5 receipt contract', () => {
  const workflow = read('.github/workflows/verify-reference-graph.yml');

  assert.match(workflow, /assertSecretFreeP5Receipt/);
  assert.match(workflow, /p5-control-coverage-evidence\.json/);
  assert.match(workflow, /p5-live-shadow-evidence\.json/);
});

test('permanent governance carries a source-level anti-benchmark-leakage gate for P5 selector code', () => {
  const workflow = read('.github/workflows/verify-reference-graph.yml');

  assert.match(workflow, /selection\.mjs/);
  assert.match(workflow, /quick-coverage\.mjs/);
  assert.match(workflow, /shadow-cases/);
  assert.match(workflow, /benchmark|leak/i);
});
