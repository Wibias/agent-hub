import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '../../scripts/eval-semantic-relations.mjs');
const fixture = resolve(here, '../fixtures/semantic-relation-shadow-sample.json');

test('D3 CLI runs deterministic fixture without writing and hides claim text', () => {
  const raw = execFileSync(process.execPath, [script, '--fixture', fixture], { encoding: 'utf8' });
  const result = JSON.parse(raw);
  assert.equal(result.mode, 'shadow');
  assert.equal(result.complete, true);
  assert.equal(result.counts.cases, 4);
  assert.equal(result.counts.truePositiveEdges, 1);
  assert.equal(result.counts.falseEdges, 1);
  assert.equal(result.counts.missingEdges, 1);
  assert.equal(result.metrics.precision, 0.5);
  assert.equal(result.metrics.recall, 0.5);
  assert.equal(result.metrics.coverage, 0.5);
  assert.doesNotMatch(raw, /Windows hook dispatch|encoded command payload|agent memory test harness/);
  assert.equal(result.usage.totals, null);
});

test('D3 CLI rejects unrequested modes without touching memory or stack traces', () => {
  const result = spawnSync(process.execPath, [script, '--apply', fixture], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /failed validation/);
  assert.doesNotMatch(result.stderr, /stack|\bat\s+file:/);
});
