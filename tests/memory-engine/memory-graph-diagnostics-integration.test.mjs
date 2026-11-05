import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

/** Run the verified Git-scope diagnostic through the actual CLI entry point. */
test('D6 CLI verifies a real repository Evidence blob in a trusted checkout', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-d6-verified-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout');
  await mkdir(join(checkout, 'docs'), { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', checkout, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000,
  }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'd6@example.invalid');
  git('config', 'user.name', 'D6 Fixture');
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', `https://${PROJECT}.git`);
  await writeFile(join(checkout, 'docs', 'guide.md'), 'Verified Git Evidence.\n', 'utf8');
  git('add', 'docs/guide.md');
  git('commit', '-m', 'fixture');
  const revision = git('rev-parse', 'HEAD');
  const blobOid = git('rev-parse', `${revision}:docs/guide.md`);
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  try {
    memory.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
    const capturedAt = new Date(Date.now() - 60_000).toISOString();
    memory.ingest({
      evidence: {
        id: 'd6-git-evidence', projectId: PROJECT, harness: 'codex', sessionId: 'git',
        sourceKind: 'repository', sourceRef: 'docs/guide.md',
        capturedAt, branch: 'main', commitSha: revision,
        path: 'docs/guide.md', blobOid, content: 'SECRET_TEST_EVIDENCE',
        authorityClass: 'repo_trusted', metadata: {},
      },
      claim: {
        id: 'd6-git-claim', kind: 'code_observation', subject: 'git',
        predicate: 'documents', value: 'SECRET_TEST_CLAIM',
        branchScope: 'main', createdAt: capturedAt,
      },
    });
  } finally {
    memory.close();
  }
  const before = await fingerprint(dbPath);
  const output = [];
  const report = await executeMemoryGraphDiagnosis({
    argv: ['--db-path', dbPath, '--project-id', PROJECT, '--branch', 'main',
      '--repo-root', checkout, '--samples', '2'],
    emit: (value) => output.push(value),
  });
  assert.equal(report.outcome, 'pass');
  assert.equal(report.git.status, 'verified');
  assert.equal(report.git.stable, true);
  assert.equal(report.graph.repositoryNodes, 1);
  assert.equal(report.graph.freshness.fresh, 1);
  assert.deepEqual(report.notes, []);
  assert.doesNotMatch(output[0], /SECRET_TEST_|d6-git-claim|d6-git-evidence|agent-hub-d6-verified-|memory\.sqlite3/);
  assert.equal(await fingerprint(dbPath), before);
});
