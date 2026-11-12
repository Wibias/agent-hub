import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyCodexJudgeSmokeFailure,
  parseSmokeArgs,
  runCodexJudgeSmoke,
  SYNTHETIC_CANDIDATE,
} from '../../scripts/smoke-codex-memory-judge.mjs';

test('model probe requires explicit opt-in and does nothing by default', async () => {
  assert.deepEqual(parseSmokeArgs([]), { runModel: false });
  assert.deepEqual(parseSmokeArgs(['--run-model']), { runModel: true });
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
