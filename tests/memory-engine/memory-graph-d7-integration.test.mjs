import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryEngine } from '../../memory-engine/index.mjs';
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

test('D7 help returns usage text', async () => {
  const output = [];
  const result = await executeD7({ argv: ['--help'], emit: (x) => output.push(x) });
  assert.equal(result.outcome, 'help');
  assert.match(output[0], /synthetic scale/i);
});

/** Verify that the live CLI honors an explicit disposable SQLite database. */
test('D7 live mode forwards --db-path and reports a read-only scoped result', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-d7-live-path-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const dbPath = join(root, 'memory.sqlite3');
  const projectId = 'github.com/example/d7-live-path';
  const memory = new MemoryEngine({ dbPath });
  try {
    memory.registerProject({ projectId, repoIdentity: projectId });
    const capturedAt = new Date(Date.now() - 60_000).toISOString();
    memory.ingest({
      evidence: {
        id: 'e-d7-live', projectId, harness: 'codex', sessionId: 'd7',
        sourceKind: 'session', sourceRef: 'session:d7', capturedAt,
        branch: 'main', content: 'PRIVATE_D7_LIVE_VALUE', authorityClass: 'user_direct',
        metadata: {},
      },
      claim: {
        id: 'd7-live-claim', kind: 'decision', subject: 'd7',
        predicate: 'validates', value: 'PRIVATE_D7_LIVE_VALUE',
        branchScope: 'main', createdAt: capturedAt,
      },
    });
  } finally {
    memory.close();
  }
  const before = createHash('sha256').update(await readFile(dbPath)).digest('hex');
  const output = [];
  const result = await executeD7({
    argv: ['--live', '--project-id', projectId, '--branch', 'main',
      '--repo-root', root, '--db-path', dbPath, '--samples', '1'],
    emit: (message) => output.push(message),
  });
  assert.equal(result.mode, 'live_read_only');
  assert.equal(result.outcome, 'blocked', 'the real fixture has no repository Evidence');
  assert.equal(result.assessment.repositoryNodes, 0);
  assert.equal(result.assessment.sampleCount, 1);
  assert.equal(result.scope.projectId, projectId);
  assert.ok(result.assessment.notes.includes('no_repository_claims_in_scope'));
  assert.doesNotMatch(output.join('\n'), /PRIVATE_D7_LIVE_VALUE|d7-live-claim|memory\.sqlite3/);
  assert.equal(createHash('sha256').update(await readFile(dbPath)).digest('hex'), before);
});

/** Inherited Git variables must never redirect fixture writes to another repo. */
test('D7 synthetic fixture does not alter an unrelated GIT_DIR checkout', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-d7-isolation-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'existing');
  await mkdir(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
  }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'existing@example.invalid');
  git('config', 'user.name', 'Existing Repo');
  const configPath = join(repo, '.git', 'config');
  const before = await readFile(configPath);
  const source = fileURLToPath(new URL('../../scripts/validate-memory-graph-d7.mjs', import.meta.url));
  // The untrusted environment can block the test, but it must not change the
  // unrelated repository's Git configuration or index/commit history.
  const child = spawnSync(process.execPath, [source, '--samples', '1'], {
    env: { ...process.env, GIT_DIR: join(repo, '.git'),
      GIT_WORK_TREE: repo, GIT_INDEX_FILE: join(repo, '.git', 'index') },
    encoding: 'utf8', timeout: 120_000,
  });
  assert.equal(child.error, undefined, 'child process must run');
  assert.deepEqual(await readFile(configPath), before);
  assert.equal(git('config', 'user.email'), 'existing@example.invalid');
});
