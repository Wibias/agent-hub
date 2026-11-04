import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { executeMemoryGraphDiagnosis } from '../../scripts/diagnose-memory-graph.mjs';

const PROJECT = 'github.com/example/d6-diagnostics';

async function fixture(t, repository = false) {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-d6-diagnostics-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  t.after(async () => rm(root, { recursive: true, force: true }));
  memory.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
  const capturedAt = new Date(Date.now() - 60_000).toISOString();
  memory.ingest({
    evidence: {
      id: 'd6-evidence', projectId: PROJECT, harness: 'codex', sessionId: 'd6-session',
      sourceKind: repository ? 'repository' : 'session',
      sourceRef: repository ? 'docs/guide.md' : 'session:d6-session',
      capturedAt, branch: 'main', commitSha: repository ? 'a'.repeat(40) : null,
      path: repository ? 'docs/guide.md' : null,
      blobOid: repository ? 'b'.repeat(40) : null,
      content: 'SECRET_USER_CONTENT in memory',
      authorityClass: repository ? 'repo_trusted' : 'user_direct', metadata: {},
    },
    claim: {
      id: 'd6-claim', kind: 'decision', subject: 'diagnostics', predicate: 'demonstrates',
      value: 'SECRET_USER_CONTENT in claim', branchScope: 'main', createdAt: capturedAt,
    },
  });
  memory.close();
  return { dbPath };
}

async function fingerprint(dbPath) {
  return createHash('sha256').update(await readFile(dbPath)).digest('hex');
}

test('D6 real SQLite diagnosis is read-only, contains counts only, and leaves DB bytes unchanged', async (t) => {
  const { dbPath } = await fixture(t);
  const before = await fingerprint(dbPath);
  const outputs = [];
  const report = await executeMemoryGraphDiagnosis({
    argv: ['--db-path', dbPath, '--project-id', PROJECT, '--branch', 'main', '--samples', '2'],
    emit: (value) => outputs.push(value),
  });
  assert.equal(report.mode, 'read_only');
  assert.equal(report.outcome, 'pass');
  assert.equal(report.graph.nodes, 1);
  assert.deepEqual(report.graph.freshness, {
    fresh: 0, stale: 0, unchecked: 0, not_repository: 1,
  });
  assert.equal(report.git.status, 'unconfigured');
  assert.equal(report.performance.samples, 2);
  assert.equal(outputs.length, 1);
  assert.doesNotMatch(outputs[0], /SECRET_USER_CONTENT|d6-claim|memory\.sqlite3|agent-hub-d6-diagnostics-/);
  assert.equal(await fingerprint(dbPath), before);
});

test('D6 repo claim without operator-approved Git root is blocked, not falsely fresh', async (t) => {
  const { dbPath } = await fixture(t, true);
  const report = await executeMemoryGraphDiagnosis({
    argv: ['--db-path', dbPath, '--project-id', PROJECT, '--branch', 'main', '--samples', '1'],
    emit: () => {},
  });
  assert.equal(report.outcome, 'blocked');
  assert.equal(report.graph.freshness.unchecked, 1);
  assert.equal(report.graph.reasons.git_unconfigured, 1);
});

test('D6 scope discovery reveals identifiers and counts without memory payload', async (t) => {
  const { dbPath } = await fixture(t);
  const outputs = [];
  const report = await executeMemoryGraphDiagnosis({
    argv: ['--db-path', dbPath, '--list-scopes'], emit: (value) => outputs.push(value),
  });
  assert.deepEqual(report.scopes, [{ projectId: PROJECT, branches: [{ branch: 'main', claims: 1 }] }]);
  assert.doesNotMatch(outputs[0], /SECRET_USER_CONTENT|d6-claim|d6-evidence|memory.sqlite3/);
});
