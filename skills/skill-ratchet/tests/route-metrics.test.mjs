import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'scripts', 'route-metrics.mjs');
const canonical = readFileSync(path.join(skillRoot, 'tests/evals/cases.jsonl'), 'utf8')
  .trim().split(/\r?\n/).map(JSON.parse).filter(row => row.category !== 'config');
const revision = 'a'.repeat(40);
function observations() {
  // Synthetic CLI unit-test data only. Never Skill Ratchet review receipts.
  return canonical.map(row => ({
    case_id: row.id, run_id: 'unit-fixture', model: 'synthetic-cli-test', revision,
    evidence_ref: 'test-fixture:' + row.id,
    selected_skills: row.category !== 'must-not-trigger' && row.expected_skill === 'skill-ratchet'
      ? ['skill-ratchet'] : [],
  }));
}
function withInput(rows, run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ratchet-route-metrics-'));
  try {
    const input = path.join(dir, 'observations.jsonl');
    writeFileSync(input, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const cliResult = spawnSync(process.execPath, [cli, '--skill-root', skillRoot, '--observations', input, '--json'], { encoding: 'utf8' });
    run(cliResult);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('complete source-backed observations score positives and must-not-trigger negatives', () => {
  withInput(observations(), cliResult => {
    assert.equal(cliResult.status, 0, cliResult.stderr);
    const out = JSON.parse(cliResult.stdout);
    assert.equal(out.status, 'DESCRIPTIVE_ONLY');
    assert.equal(out.complete_runs, 1);
    assert.equal(out.canonical_cases, canonical.length);
    assert.equal(out.summary.accuracy, 1);
    assert.equal(out.summary.falseTriggerRate, 0);
    assert.equal(out.summary.fn, 0);
    assert.equal(out.summary.fp, 0);
    assert.match(out.evidence_boundary, /not attested/i);
  });
});
test('wrongly triggered negative routes appear as false positives with trace links', () => {
  const rows = observations();
  rows.find(row => row.case_id === 'N1').selected_skills = ['skill-ratchet'];
  withInput(rows, result => {
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.summary.fp, 1);
    assert.ok(out.summary.precision < 1);
    assert.deepEqual(out.runs[0].false_triggers, [{ case_id: 'N1', evidence_ref: 'test-fixture:N1' }]);
  });
});
test('missing cases remain incomplete and cannot produce a passing accuracy score', () => {
  withInput(observations().slice(0, -1), result => {
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.status, 'NO_COMPLETE_RUNS');
    assert.equal(out.summary, null);
    assert.equal(out.runs[0].metrics, null);
    assert.equal(out.runs[0].missing_cases.length, 1);
  });
});
test('duplicate, unknown and ungrounded rows are rejected', () => {
  const cases = [
    [...observations(), observations()[0]],
    [{ ...observations()[0], case_id: 'not-a-case' }],
    [{ ...observations()[0], evidence_ref: '' }],
    [{ ...observations()[0], revision: 'short' }],
  ];
  for (const rows of cases) {
    withInput(rows, result => {
      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /route-metrics:/);
    });
  }
});
