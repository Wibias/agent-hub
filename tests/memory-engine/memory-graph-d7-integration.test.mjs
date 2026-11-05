import test from 'node:test';
import assert from 'node:assert/strict';

import { parseD7Args, runSyntheticD7, executeD7 } from '../../scripts/validate-memory-graph-d7.mjs';

// This test constructs four temporary SQLite databases and a real Git checkout.
// It does not change or require any existing local repository or Memory database.
test('D7 real Git/SQLite scale, freshness, fail-closed and concurrent HTTP verification',
  { timeout: 120_000 }, async () => {
    const report = await runSyntheticD7({ samples: 2 });
    assert.equal(report.outcome, 'pass');
    assert.deepEqual(report.profiles.map((p) => [p.claims, p.graphNodes, p.omittedClaims]), [
      [100, 100, 0], [250, 250, 0], [500, 500, 0], [501, 500, 1],
    ]);
    assert.deepEqual(report.profiles.map((p) => p.status), ['pass', 'pass', 'pass', 'pass']);
    assert.equal(report.freshness.initial, 'fresh');
    assert.equal(report.freshness.changedCommit, 'stale');
    assert.equal(report.freshness.wrongBranch, 'unchecked');
    assert.equal(report.freshness.noRoot, 'unchecked');
    assert.equal(report.freshness.typedEdgesBefore, 1);
    assert.equal(report.freshness.typedEdgesAfter, 0);
    assert.equal(report.freshness.gitFailureFailClosed, true);
    assert.equal(report.concurrency.requests, 4);
    assert.equal(report.databasesUnchanged, true);
    assert.doesNotMatch(JSON.stringify(report), /EPHEMERAL_|PRIVATE_GIT_FAILURE|agent-hub-d7-validation-|\\checkout/);
  });

test('D7 refuses unknown flags, implicit live scope, and unsupported sample counts', () => {
  assert.equal(parseD7Args([]).samples, 3);
  assert.throws(() => parseD7Args(['--live']), /explicit/);
  assert.throws(() => parseD7Args(['--project-id', 'x']), /synthetic/);
  assert.throws(() => parseD7Args(['--samples', '6']), /1 and 5/);
  assert.throws(() => parseD7Args(['--unsafe']), /unknown/);
  assert.throws(() => parseD7Args(['--live', '--project-id', 'x', '--branch', 'main',
    '--repo-root', 'a', '--repo-root', 'b']), /duplicate/);
});

test('D7 help is side-effect-free and does not open a database or checkout', async () => {
  const output = [];
  const result = await executeD7({ argv: ['--help'], emit: (x) => output.push(x) });
  assert.equal(result.outcome, 'help');
  assert.match(output[0], /synthetic scale/i);
});
