import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { captureD9RepositoryFile } from '../../memory-engine/memory-graph-d9-capture.mjs';
import { executeD11Monitor, parseD11Args } from '../../scripts/monitor-memory-graph-d11.mjs';

const PROJECT = 'github.com/example/d11-live-fixture';
/** Hash the disposable SQLite file to prove D11 never modifies it. */
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const D11_CLI = fileURLToPath(new URL('../../scripts/monitor-memory-graph-d11.mjs', import.meta.url));

/** Execute the real CLI entrypoint and preserve its status, stdout and stderr. */
function runD11Cli(argv) {
  const run = spawnSync(process.execPath, [D11_CLI, ...argv], {
    encoding: 'utf8', timeout: 90000,
  });
  assert.equal(run.error, undefined);
  return run;
}

/** Build a disposable committed Git checkout plus a separately scoped SQLite. */
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-hub-d11-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'checkout');
  await mkdir(join(root, 'docs'), { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'd11@example.invalid');
  git('config', 'user.name', 'D11 test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  await mkdir(join(dir, 'empty-hooks'));
  git('config', 'core.hooksPath', join(dir, 'empty-hooks'));
  git('remote', 'add', 'origin', 'https://github.com/example/d11-live-fixture.git');
  const path = join(root, 'docs', 'test.md');
  await writeFile(path, 'PRIVATE_SOURCE_NOT_IN_RECEIPT\n');
  git('add', 'docs/test.md');
  git('commit', '-m', 'original file');
  const dbPath = join(dir, 'store.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  memory.registerProject({ projectId: PROJECT, repoIdentity: PROJECT, canonicalRemote: PROJECT });
  memory.close();
  const argv = ['--db-path', dbPath, '--repo-root', root,
    '--project-id', PROJECT, '--branch', 'main', '--samples', '1', '--max-p95-ms', '600000'];
  return { root, dbPath, argv, git, path, dir };
}

test('D11 rejects unsafe/implicit arguments, and --help never needs an existing database', async () => {
  assert.equal(parseD11Args(['--help']).help, true);
  assert.throws(() => parseD11Args([]), /required/);
  assert.throws(() => parseD11Args(['--write']), /unknown flag/);
  assert.throws(() => parseD11Args(['--samples', '25']), /required/);
  const scoped = ['--db-path', 'store.sqlite3', '--repo-root', 'checkout',
    '--project-id', PROJECT, '--branch', 'main'];
  for (const invalid of ['25', '0', '1.5', '-1', 'not-a-number']) {
    assert.throws(() => parseD11Args([...scoped, '--samples', invalid]), /1\\.\\.5/, invalid);
  }
  const emitted = [];
  const result = await executeD11Monitor({ argv: ['--help'], emit: (x) => emitted.push(x) });
  assert.equal(result.outcome, 'help');
  assert.match(emitted[0], /never writes any file/);
});

test('D11 monitors real Git and SQLite read-only, including pass to stale regression', {
  timeout: 90_000,
}, async (t) => {
  const { root, dbPath, argv, git, path, dir } = await fixture(t);
  const memory = new MemoryEngine({ dbPath });
  try {
    const captured = captureD9RepositoryFile({
      memory, repoRoot: root, projectId: PROJECT, branch: 'main',
      path: 'docs/test.md', write: true,
    });
    assert.equal(captured.outcome, 'captured');
  } finally { memory.close(); }
  const before = hash(await readFile(dbPath));
  const outputs = [];
  const pass = await executeD11Monitor({ argv, emit: (x) => outputs.push(x) });
  assert.equal(pass.outcome, 'pass');
  assert.equal(pass.repository.nodes, 1);
  assert.equal(pass.repository.fresh, 1);
  assert.equal(pass.transition, 'first_observation');
  assert.equal(hash(await readFile(dbPath)), before);

  const previousPath = join(dir, 'previous.json');
  await writeFile(previousPath, JSON.stringify(pass));
  const unchanged = await executeD11Monitor({
    argv: [...argv, '--previous-report', previousPath], emit: (x) => outputs.push(x),
  });
  assert.equal(unchanged.outcome, 'pass');
  assert.equal(unchanged.transition, 'unchanged');
  assert.equal(hash(await readFile(dbPath)), before);

  await writeFile(path, 'PRIVATE_CHANGED_SOURCE_NOT_IN_RECEIPT\n');
  git('add', 'docs/test.md');
  git('commit', '-m', 'update committed source');
  const stale = await executeD11Monitor({
    argv: [...argv, '--previous-report', previousPath], emit: (x) => outputs.push(x),
  });
  assert.equal(stale.outcome, 'blocked');
  assert.equal(stale.transition, 'regressed');
  assert.ok(stale.reasonCodes.includes('stale_repository_evidence'));
  assert.match(stale.remediation, /operator_approved_lifecycle_action/);
  assert.equal(hash(await readFile(dbPath)), before);
  assert.doesNotMatch(outputs.join('\n'), /PRIVATE_|docs\/test|store\.sqlite3|agent-hub-d11-/);
});

test('D11 CLI exit codes and stderr remain deterministic and path-free', {
  timeout: 90000,
}, async (t) => {
  const { dbPath, argv, git, path, root, dir } = await fixture(t);
  const memory = new MemoryEngine({ dbPath });
  try {
    assert.equal(captureD9RepositoryFile({
      memory, repoRoot: root, projectId: PROJECT, branch: 'main',
      path: 'docs/test.md', write: true,
    }).outcome, 'captured');
  } finally { memory.close(); }
  const before = hash(await readFile(dbPath));
  const passed = runD11Cli(argv);
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(JSON.parse(passed.stdout).outcome, 'pass');
  assert.equal(passed.stderr, '');

  await writeFile(path, 'PRIVATE_CHANGED_SOURCE_CLI_TEST\n');
  git('add', 'docs/test.md');
  git('commit', '-m', 'make original Evidence stale');
  const blocked = runD11Cli(argv);
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).outcome, 'blocked');
  assert.equal(blocked.stderr, '');

  const invalid = runD11Cli([...argv, '--write']);
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.deepEqual(JSON.parse(invalid.stderr), {
    schemaVersion: 1, mode: 'd11_read_only_monitor', outcome: 'fail',
    code: 'invalid_args_or_previous_report',
  });

  const absent = runD11Cli([
    '--db-path', join(dir, 'database-absent.sqlite3'),
    ...argv.slice(2),
  ]);
  assert.equal(absent.status, 1);
  assert.equal(absent.stdout, '');
  assert.deepEqual(JSON.parse(absent.stderr), {
    schemaVersion: 1, mode: 'd11_read_only_monitor', outcome: 'fail',
    code: 'database_not_found',
  });
  assert.equal(hash(await readFile(dbPath)), before);
  for (const run of [passed, blocked, invalid, absent]) {
    assert.doesNotMatch(run.stdout + run.stderr,
      /PRIVATE_|docs\\/test|store\\.sqlite3|agent-hub-d11-/);
  }
});
