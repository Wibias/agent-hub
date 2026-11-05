import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { validD9FilePath, captureD9RepositoryFile }
  from '../../memory-engine/memory-graph-d9-capture.mjs';
import { executeD9Capture, parseD9Args } from '../../scripts/capture-memory-graph-d9.mjs';
import { executeD8EvidenceAudit } from '../../scripts/audit-memory-graph-d8.mjs';
import { runLiveD7 } from '../../scripts/validate-memory-graph-d7.mjs';

const PROJECT = 'github.com/example/d9-capture';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Disposable Git checkout and registered SQLite store. */
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-hub-d9-'));
  t.after(async () => rm(dir, { force: true, recursive: true }));
  const repoRoot = join(dir, 'checkout');
  await mkdir(join(repoRoot, 'docs'), { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
  }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'd9@example.invalid');
  git('config', 'user.name', 'D9 Fixture');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  await mkdir(join(dir, 'no-hooks'));
  git('config', 'core.hooksPath', join(dir, 'no-hooks'));
  git('remote', 'add', 'origin', 'https://github.com/example/d9-capture.git');
  const file = join(repoRoot, 'docs', 'guide.md');
  await writeFile(file, 'PRIVATE_D9_SOURCE_CONTENT\n');
  git('add', 'docs/guide.md');
  git('commit', '-m', 'tracked file');
  const dbPath = join(dir, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  memory.registerProject({ projectId: PROJECT, repoIdentity: PROJECT,
    canonicalRemote: PROJECT });
  memory.close();
  const argv = ['--db-path', dbPath, '--repo-root', repoRoot,
    '--project-id', PROJECT, '--branch', 'main', '--path', 'docs/guide.md'];
  return { dir, repoRoot, dbPath, file, argv, git };
}

test('D9 requires explicit database, repository, scope, path, and write opt-in', () => {
  assert.equal(parseD9Args(['--help']).help, true);
  assert.throws(() => parseD9Args(['--write']), /required/);
  assert.throws(() => parseD9Args(['--db-path', 'a', '--db-path', 'b']), /duplicate/);
  assert.throws(() => parseD9Args(['--help', '--write']), /unknown/);
  assert.throws(() => parseD9Args(['--unsafe']), /unknown/);
  assert.equal(validD9FilePath('docs/guide.md'), true);
  for (const invalid of ['', '../secret', '/etc/passwd', '.\\secret',
    'a//b', 'a/./b', 'a/../b', 'a/*', 'a?[1]', 'C:/secret']) {
    assert.equal(validD9FilePath(invalid), false, invalid);
  }
});

test('D9 dry-run is read-only, then explicit write yields D8 and D7 live coverage', {
  timeout: 90_000,
}, async (t) => {
  const { repoRoot, dbPath, argv, file, git } = await fixture(t);
  const before = digest(await readFile(dbPath));
  const output = [];
  const dry = executeD9Capture({ argv, emit: (x) => output.push(x) });
  assert.equal(dry.outcome, 'ready');
  assert.equal(dry.recorded, false);
  assert.equal(digest(await readFile(dbPath)), before);
  assert.doesNotMatch(output.join('\n'), /docs\/guide|PRIVATE_D9|memory\.sqlite3|checkout/);

  const write = executeD9Capture({ argv: [...argv, '--write'], emit: (x) => output.push(x) });
  assert.equal(write.outcome, 'captured');
  assert.equal(write.recorded, true);
  const reopened = new MemoryEngine({ dbPath, readOnly: true });
  try {
    const canonical = reopened.exportCanonical();
    assert.equal(canonical.claims.length, 1);
    assert.equal(canonical.evidence.length, 1);
    assert.equal(canonical.evidence[0].authority_class, 'repo_trusted');
    assert.equal(canonical.evidence[0].source_kind, 'repository');
    assert.equal(canonical.evidence[0].path, 'docs/guide.md');
    assert.match(canonical.evidence[0].blob_oid, /^[a-f0-9]{40}$/);
    assert.equal(canonical.claims[0].created_from_evidence_id, canonical.evidence[0].id);
    assert.doesNotMatch(JSON.stringify(canonical), /PRIVATE_D9_SOURCE_CONTENT/);
  } finally { reopened.close(); }
  const twice = executeD9Capture({ argv: [...argv, '--write'], emit: (x) => output.push(x) });
  assert.equal(twice.outcome, 'already_recorded');
  assert.equal(twice.recorded, false);

  const audit = await executeD8EvidenceAudit({
    argv: ['--db-path', dbPath, '--project-id', PROJECT, '--branch', 'main'],
    emit: () => {},
  });
  assert.equal(audit.outcome, 'ready_for_d7_live');
  assert.equal(audit.claims.repositoryVisibleActiveWithCompleteEvidence, 1);
  const live = await runLiveD7({ projectId: PROJECT, branch: 'main',
    repoRoot, dbPath, samples: 1 });
  assert.equal(live.outcome, 'pass');
  assert.equal(live.assessment.freshRepositoryNodes, 1);

  await writeFile(file, 'PRIVATE_D9_SOURCE_CONTENT_v2\n');
  git('add', 'docs/guide.md');
  git('commit', '-m', 'replace tracked blob');
  const after = await runLiveD7({ projectId: PROJECT, branch: 'main',
    repoRoot, dbPath, samples: 1 });
  assert.equal(after.outcome, 'blocked');
  assert.ok(after.assessment.notes.includes('repository_nodes_stale'));
  assert.doesNotMatch(output.join('\n'), /PRIVATE_D9|docs\/guide|memory\.sqlite3|checkout/);
});

test('D9 refuses dirty, absent, and wrong-branch files without insertion', async (t) => {
  const { repoRoot, dbPath, argv, file, git } = await fixture(t);
  const memory = new MemoryEngine({ dbPath });
  try {
    await writeFile(file, 'uncommitted change\n');
    assert.throws(() => captureD9RepositoryFile({
      memory, repoRoot, projectId: PROJECT, branch: 'main',
      path: 'docs/guide.md', write: true,
    }), /uncommitted/);
    assert.throws(() => captureD9RepositoryFile({
      memory, repoRoot, projectId: PROJECT, branch: 'main',
      path: 'docs/unknown.md', write: true,
    }), /not a regular committed/);
    git('checkout', '--', 'docs/guide.md');
    git('checkout', '-b', 'feature/d9');
    assert.throws(() => captureD9RepositoryFile({
      memory, repoRoot, projectId: PROJECT, branch: 'main',
      path: 'docs/guide.md', write: true,
    }), /branch or revision mismatch/);
    assert.equal(memory.exportCanonical().claims.length, 0);
    assert.equal(memory.exportCanonical().evidence.length, 0);
  } finally { memory.close(); }
});

test('D9 does not grant trust to a different project or invalid Git path', async (t) => {
  const { repoRoot, dbPath } = await fixture(t);
  const memory = new MemoryEngine({ dbPath });
  try {
    assert.throws(() => captureD9RepositoryFile({
      memory, repoRoot, projectId: 'github.com/example/not-d9', branch: 'main',
      path: 'docs/guide.md', write: true,
    }), /registered repository identity required/);
    assert.throws(() => captureD9RepositoryFile({
      memory, repoRoot, projectId: PROJECT, branch: 'main',
      path: '../secret', write: true,
    }), /invalid relative Git file path/);
    assert.equal(memory.exportCanonical().claims.length, 0);
  } finally { memory.close(); }
});

test('D9 rejects committed Git symlinks without creating claims', async (t) => {
  if (process.platform === 'win32') {
    t.skip('creating Git symlinks requires Windows developer privileges');
    return;
  }
  const { repoRoot, dbPath, git } = await fixture(t);
  await symlink('guide.md', join(repoRoot, 'docs', 'link.md'));
  git('add', 'docs/link.md');
  git('commit', '-m', 'add symlink');
  const memory = new MemoryEngine({ dbPath });
  try {
    assert.throws(() => captureD9RepositoryFile({
      memory, repoRoot, projectId: PROJECT, branch: 'main',
      path: 'docs/link.md', write: true,
    }), /not a regular committed blob/);
    assert.equal(memory.exportCanonical().claims.length, 0);
  } finally { memory.close(); }
});

test('D9 Git capture ignores inherited GIT_DIR and GIT_WORK_TREE overrides', async (t) => {
  const { dir, dbPath, argv } = await fixture(t);
  const other = join(dir, 'other-checkout');
  await mkdir(other);
  const gitOther = (...args) => execFileSync('git', ['-C', other, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
  }).trim();
  gitOther('init', '-b', 'main');
  gitOther('config', 'user.email', 'other@example.invalid');
  const configuration = join(other, '.git', 'config');
  const before = await readFile(configuration);
  const vars = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];
  const previous = vars.map((name) => process.env[name]);
  try {
    process.env.GIT_DIR = join(other, '.git');
    process.env.GIT_WORK_TREE = other;
    process.env.GIT_INDEX_FILE = join(other, '.git', 'index');
    const result = executeD9Capture({ argv, emit: () => {} });
    assert.equal(result.outcome, 'ready');
  } finally {
    for (let i = 0; i < vars.length; i++) {
      if (previous[i] === undefined) delete process.env[vars[i]];
      else process.env[vars[i]] = previous[i];
    }
  }
  assert.deepEqual(await readFile(configuration), before);
  const memory = new MemoryEngine({ dbPath, readOnly: true });
  try {
    assert.equal(memory.exportCanonical().evidence.length, 0);
  } finally { memory.close(); }
});
