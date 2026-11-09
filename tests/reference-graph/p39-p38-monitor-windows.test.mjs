import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RUNNER = join(ROOT, 'reference-graph', 'ops', 'p39-p38-monitor-runner.ps1');
const REGISTER = join(ROOT, 'reference-graph', 'ops', 'register-p39-p38-monitor.ps1');
const WINDOWS = process.platform === 'win32';

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'p39-guard-'));
  const run = args => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    if (result.status !== 0) throw new Error('git failed: ' + result.stderr);
    return result.stdout.trim();
  };
  run(['init', '-q']);
  run(['config', 'user.email', 'p39-test@example.invalid']);
  run(['config', 'user.name', 'P39 Test']);
  writeFileSync(join(dir, 'README.md'), 'p39 guard fixture\n', 'utf8');
  run(['add', 'README.md']);
  run(['commit', '-qm', 'fixture']);
  run(['branch', '-m', 'p39-test-branch']);
  return { dir, run };
}

function guardFixture(kind) {
  const { dir, run } = tempRepo();
  const head = run(['rev-parse', 'HEAD']);
  const branch = run(['branch', '--show-current']);
  if (kind === 'dirty') writeFileSync(join(dir, 'dirty.txt'), 'dirty\n', 'utf8');
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify({
    schema_version: 'test-only',
    supabase_url: 'https://example.invalid/',
    supabase_publishable_key: 'sb_publishable_guard_test',
  }), 'utf8');
  const statePath = join(dir, 'state.json');
  const logPath = join(dir, 'alerts.jsonl');
  const runLogPath = join(dir, 'runs.jsonl');
  const expectedBranch = kind === 'branch' ? 'wrong-branch' : branch;
  const expectedHead = kind === 'commit' ? '0'.repeat(40) : head;
  const result = spawnSync('pwsh', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', RUNNER,
    '-RepoPath', dir,
    '-ExpectedBranch', expectedBranch,
    '-ExpectedHead', expectedHead,
    '-ConfigPath', configPath,
    '-StatePath', statePath,
    '-LogPath', logPath,
    '-RunLogPath', runLogPath,
    '-WebhookSecretPath', join(dir, 'webhook.dpapi'),
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPABASE_SECRET_KEY: 'must-not-appear',
      SUPABASE_SERVICE_ROLE_KEY: 'must-not-appear',
    },
  });
  return { dir, result, runLogPath, statePath, logPath };
}

test('P39 Windows guard returns process exit 3 for wrong commit, branch or dirty tree',
  { skip: !WINDOWS }, () => {
    for (const kind of ['commit', 'branch', 'dirty']) {
      const fixture = guardFixture(kind);
      try {
        assert.equal(fixture.result.status, 3, kind + ': ' + fixture.result.stderr);
        const records = readFileSync(fixture.runLogPath, 'utf8').trim().split('\n')
          .map(line => JSON.parse(line));
        assert.equal(records.length, 1);
        assert.equal(records[0].status, 'WATCH_GUARD_FAIL');
        assert.equal(records[0].exit_code, 3);
        if (kind === 'dirty') assert.ok(records[0].output.dirty_count >= 1);
        assert.equal(existsSync(fixture.statePath), false);
        assert.equal(existsSync(fixture.statePath + '.lock'), false);
        assert.equal(existsSync(fixture.logPath), false);
        assert.doesNotMatch(readFileSync(fixture.runLogPath, 'utf8'), /must-not-appear/);
      } finally {
        rmSync(fixture.dir, { recursive: true, force: true });
      }
    }
  });

test('P39 registration dry-run exits 0 without registering the task',
  { skip: !WINDOWS }, () => {
    const taskPresence = () => spawnSync('pwsh', [
      '-NoProfile', '-NonInteractive', '-Command',
      "if (Get-ScheduledTask -TaskName 'AgentHub Reference Graph P38 Monitor' -ErrorAction SilentlyContinue) { 'present' } else { 'absent' }",
    ], { encoding: 'utf8' }).stdout.trim();
    const before = taskPresence();
    const result = spawnSync('pwsh', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', REGISTER,
      '-ExpectedBranch', 'p39-test-branch',
      '-ExpectedHead', '0'.repeat(40),
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DRY-RUN ONLY/);
    assert.equal(taskPresence(), before,
      'registration dry-run must not change P38 monitor task presence');
  });
