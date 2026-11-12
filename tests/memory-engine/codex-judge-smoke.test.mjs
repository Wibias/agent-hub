import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectCodexJudgeOffline,
  classifyCodexJudgeSmokeFailure,
  parseSmokeArgs,
  runCodexJudgeSmoke,
  SYNTHETIC_CANDIDATE,
} from '../../scripts/smoke-codex-memory-judge.mjs';

test('model probe requires explicit opt-in and does nothing by default', async () => {
  assert.deepEqual(parseSmokeArgs([]), { runModel: false });
  assert.deepEqual(parseSmokeArgs(['--run-model']), { runModel: true });
  assert.deepEqual(parseSmokeArgs(['--inspect-cli']), { inspectCli: true });
  assert.throws(() => parseSmokeArgs(['--run-model', 'user-data']), /usage/);
  let initialized = false;
  const result = await runCodexJudgeSmoke({
    createJudge() { initialized = true; throw new Error('must not be called'); },
  });
  assert.equal(result.status, 'opt_in_required');
  assert.equal(result.model_call_attempted, false);
  assert.equal(result.memory_db_modified, false);
  assert.equal(initialized, false);
});

test('synthetic successful judgment uses strict original parser and closes resources', async () => {
  let closeCount = 0;
  const result = await runCodexJudgeSmoke({
    runModel: true,
    createJudge: async () => ({
      async judge(candidate) {
        assert.deepEqual(candidate, SYNTHETIC_CANDIDATE);
        return JSON.stringify({
          decision: 'ignore', suggested_type: 'decision', durability: 'short',
          future_utility: 'low', specificity: 'low', confidence: 'high',
          meaning_preserved: true, canonical_fact: null, reason: 'Temporary.',
          risk_flags: [],
        });
      },
      async close() { closeCount++; },
    }),
  });
  assert.deepEqual(result, {
    status: 'judge_usable', model_call_attempted: true,
    memory_db_modified: false, judgement_schema_valid: true,
  });
  assert.equal(closeCount, 1);
});

test('broken JSON fails securely and always closes resources', async () => {
  let closeCount = 0;
  const result = await runCodexJudgeSmoke({
    runModel: true,
    createJudge: async () => ({
      judge: async () => 'SECRET_INVALID_RESPONSE',
      async close() { closeCount++; },
    }),
  });
  assert.equal(result.status, 'judge_failed');
  assert.equal(result.model_call_attempted, true);
  assert.equal(result.failure_code, 'invalid_judge_json');
  assert.equal(closeCount, 1);
  assert.ok(!JSON.stringify(result).includes('SECRET_INVALID_RESPONSE'));
});

test('failure classifiers never include source error text, paths or account details', () => {
  for (const [message, expected] of [
    ['spawn codex ENOENT C:\\PRIVATE\\codex.exe', 'cli_not_resolved'],
    ['candidate judge requires an authenticated Codex home containing auth.json', 'auth_file_missing_or_invalid'],
    ['codex candidate judge failed with exit 1: private HTTP 429 rate limit', 'rate_limited_possible'],
    ['codex candidate judge failed with exit 1: Unauthorized token PRIVATE', 'authentication_rejected_possible'],
    ['codex candidate judge failed with exit 1: model gpt-test not available', 'model_unavailable_possible'],
    ['codex candidate judge failed with exit 1: secret PRIVATE path', 'codex_exec_nonzero_unclassified'],
  ]) {
    const result = classifyCodexJudgeSmokeFailure(new Error(message));
    assert.equal(result, expected);
    assert.ok(!result.includes('PRIVATE'));
  }
});


test('isolated CLI offline inspection runs only static subcommands and discards sensitive stdout', async () => {
  const root = mkdtempSync(join(tmpdir(), 'judge-offline-test-'));
  try {
    const home = join(root, 'home');
    mkdirSync(home);
    writeFileSync(join(home, 'auth.json'), 'PRIVATE_LOGIN_TOKEN');
    writeFileSync(join(home, 'config.toml'), 'PRIVATE_PROVIDER_CONFIG');

    const fakeCli = join(root, 'fake-codex.js');
    writeFileSync(fakeCli, [
      '#!/usr/bin/env node',
      "import { existsSync, readFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "const home = process.env.CODEX_HOME;",
      "if (!home || !existsSync(join(home, 'auth.json')) || existsSync(join(home, 'config.toml'))) process.exit(8);",
      "if (process.argv.includes('--version')) { console.log('codex-cli 0.222.1'); process.exit(0); }",
      "if (process.argv.includes('login') && process.argv.includes('status')) { console.log('PRIVATE_EMAIL'); process.exit(0); }",
      "if (process.argv.includes('exec') && process.argv.includes('--help')) { console.log('--cd --ephemeral --output-last-message'); process.exit(0); }",
      "process.exit(9);",
    ].join('\n'));
    chmodSync(fakeCli, 0o755);
    const report = await inspectCodexJudgeOffline({
      sourceCodexHome: home,
      env: {
        ...process.env,
        AGENT_HUB_MEMORY_JUDGE_CODEX_BIN: fakeCli,
        AGENT_HUB_MEMORY_DB: join(root, 'never-open.sqlite3'),
      },
    });
    assert.equal(report.status, 'offline_checks_passed');
    assert.equal(report.cli_version, '0.222.1');
    assert.equal(report.version_command, 'ok');
    assert.equal(report.isolated_login_status, 'accepted_by_cli_unverified');
    assert.equal(report.exec_flags, 'supported');
    assert.equal(report.source_config_file, 'present_unread');
    assert.equal(report.isolated_config_copied, false);
    assert.equal(report.model_call_attempted, false);
    assert.equal(report.memory_db_modified, false);
    assert.ok(!JSON.stringify(report).includes('PRIVATE'));
    assert.equal(existsSync(join(root, 'never-open.sqlite3')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('offline inspection reports isolated authentication failure without model or user data', async () => {
  const root = mkdtempSync(join(tmpdir(), 'judge-offline-negative-'));
  try {
    const home = join(root, 'home');
    mkdirSync(home);
    writeFileSync(join(home, 'auth.json'), 'PRIVATE_LOGIN_TOKEN');
    let calls = 0;
    const report = await inspectCodexJudgeOffline({
      sourceCodexHome: home,
      env: {},
      resolveJudge() {
        return { command: 'fake-binary', prefixArgs: [], kind: 'native' };
      },
      async runCommand({ args }) {
        calls++;
        if (args.includes('--version')) {
          return { exitCode: 0, stdout: 'codex-cli 0.123.4 PRIVATE_PATH' };
        }
        if (args.includes('status')) {
          return { exitCode: 1, stdout: 'PRIVATE_EMAIL' };
        }
        return { exitCode: 0, stdout: '--cd --ephemeral --output-last-message' };
      },
    });
    assert.equal(calls, 3);
    assert.equal(report.status, 'offline_checks_incomplete');
    assert.equal(report.isolated_login_status, 'not_accepted_or_unavailable');
    assert.equal(report.model_call_attempted, false);
    assert.ok(!JSON.stringify(report).includes('PRIVATE'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('offline inspection fails closed when CLI cannot be resolved and does not copy auth', async () => {
  let copied = false;
  const result = await inspectCodexJudgeOffline({
    resolveJudge() { throw new Error('PRIVATE_LOCAL_PATH'); },
    async prepareHome() { copied = true; throw new Error('should not run'); },
  });
  assert.equal(result.status, 'offline_check_failed');
  assert.equal(result.model_call_attempted, false);
  assert.equal(copied, false);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

const FAKE_CODEX = [
  '#!/usr/bin/env node',
  "import { writeFileSync } from 'node:fs';",
  "const i = process.argv.indexOf('--output-last-message');",
  "if (i < 0) process.exit(11);",
  "const file = process.argv[i + 1];",
  "let input = '';",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data', x => { input += x; });",
  "process.stdin.on('end', () => {",
  "  if (process.env.FAKE_CODEX_FAIL === '1') {",
  "    console.error('SECRET_ACCOUNT_TOKEN PRIVATE_PATH');",
  "    process.exit(7);",
  "  }",
  "  if (!input.includes('Importance rule:') || !input.includes('temporary implementation detail')) process.exit(12);",
  "  writeFileSync(file, JSON.stringify({",
  "    decision:'ignore',suggested_type:'decision',durability:'short',",
  "    future_utility:'low',specificity:'low',confidence:'high',",
  "    meaning_preserved:true,canonical_fact:null,reason:'Temporary.',risk_flags:[]",
  "  }));",
  "});",
].join('\n');

test('real shell-free CLI smoke executes synthetic isolated judge and leaves canonical file untouched', () => {
  const root = mkdtempSync(join(tmpdir(), 'judge-smoke-cli-'));
  try {
    const fakeCodex = join(root, 'fake-codex.js');
    writeFileSync(fakeCodex, FAKE_CODEX);
    chmodSync(fakeCodex, 0o755);
    const auth = join(root, 'codex-home');
    mkdirSync(auth);
    writeFileSync(join(auth, 'auth.json'), '{"test_only":"PRIVATE_CREDENTIAL"}');
    const canonical = join(root, 'memory.sqlite3');
    writeFileSync(canonical, 'SENTINEL_NOT_A_DATABASE');
    const script = fileURLToPath(new URL('../../scripts/smoke-codex-memory-judge.mjs', import.meta.url));

    const env = {
      ...process.env,
      CODEX_HOME: auth,
      AGENT_HUB_MEMORY_JUDGE_CODEX_BIN: fakeCodex,
      AGENT_HUB_MEMORY_DB: canonical,
    };
    const ok = spawnSync(process.execPath, [script, '--run-model'], {
      encoding: 'utf8', env, timeout: 30_000,
    });
    assert.equal(ok.status, 0, ok.stderr);
    const good = JSON.parse(ok.stdout);
    assert.equal(good.status, 'judge_usable');
    assert.equal(good.judgement_schema_valid, true);
    assert.equal(good.model_call_attempted, true);
    assert.equal(good.memory_db_modified, false);
    assert.ok(!ok.stdout.includes('PRIVATE'));
    assert.equal(readFileSync(canonical, 'utf8'), 'SENTINEL_NOT_A_DATABASE');

    const failed = spawnSync(process.execPath, [script, '--run-model'], {
      encoding: 'utf8', env: { ...env, FAKE_CODEX_FAIL: '1' }, timeout: 30_000,
    });
    assert.equal(failed.status, 2);
    const result = JSON.parse(failed.stdout);
    assert.equal(result.status, 'judge_failed');
    assert.equal(result.failure_code, 'codex_exec_nonzero_unclassified');
    assert.equal(result.model_call_attempted, true);
    assert.ok(!failed.stdout.includes('PRIVATE'));
    assert.ok(!failed.stderr.includes('PRIVATE'));
    assert.equal(readFileSync(canonical, 'utf8'), 'SENTINEL_NOT_A_DATABASE');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
