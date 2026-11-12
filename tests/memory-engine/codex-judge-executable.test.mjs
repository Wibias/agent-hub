import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexMemoryCandidateJudge } from '../../scripts/judge-memory-candidates.mjs';
import test from 'node:test';

import {
  resolveCodexJudgeExecutable,
} from '../../memory-engine/codex-judge-executable.mjs';

function withFixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'codex-cli-resolver-'));
  try { return fn(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('Windows standalone Codex executable resolves without a shell', () => withFixture((root) => {
  const native = join(root, 'codex.exe');
  writeFileSync(native, 'native executable placeholder');
  const got = resolveCodexJudgeExecutable({
    platform: 'win32',
    userHome: root,
    env: { PATH: root },
  });
  assert.deepEqual(got, { command: native, prefixArgs: [], kind: 'native' });
}));

test('Windows npm codex.cmd resolves to Node JS entrypoint, never cmd.exe', () => withFixture((root) => {
  writeFileSync(join(root, 'codex.cmd'), '@echo off\n');
  const pkgDir = join(root, 'node_modules', '@openai', 'codex', 'bin');
  mkdirSync(pkgDir, { recursive: true });
  const entry = join(pkgDir, 'codex.js');
  writeFileSync(entry, 'process.exit(0);\n');
  const got = resolveCodexJudgeExecutable({
    platform: 'win32',
    nodeExecutable: process.execPath,
    userHome: root,
    env: { PATH: root },
  });
  assert.equal(got.command, process.execPath);
  assert.deepEqual(got.prefixArgs, [entry]);
  assert.equal(got.kind, 'npm_js');
}));

test('standalone executable wins over an npm shim', () => withFixture((root) => {
  const native = join(root, 'codex.exe');
  writeFileSync(native, 'native');
  writeFileSync(join(root, 'codex.cmd'), '@echo off');
  const got = resolveCodexJudgeExecutable({
    platform: 'win32', userHome: root, env: { PATH: root },
  });
  assert.equal(got.command, native);
}));

test('missing Windows CLI fails clearly, not via repeated spawn ENOENT', () => withFixture((root) => {
  assert.throws(() => resolveCodexJudgeExecutable({
    platform: 'win32', userHome: root,
    env: { PATH: root, LOCALAPPDATA: root, APPDATA: root },
  }), /CODEX_JUDGE_CLI_NOT_FOUND/);
}));

test('arbitrary cmd, powershell and bat shims do not invoke an unsafe shell', () => withFixture((root) => {
  for (const filename of ['codex.bat', 'codex.ps1', 'unsafe.cmd']) {
    const path = join(root, filename);
    writeFileSync(path, 'echo unsafe');
    assert.throws(() => resolveCodexJudgeExecutable({
      platform: 'win32', userHome: root, env: {
        PATH: root, AGENT_HUB_MEMORY_JUDGE_CODEX_BIN: path,
      },
    }), /CODEX_JUDGE_EXECUTABLE_INVALID/);
  }
}));

test('invalid explicit override denies even if a native CLI is on PATH', () => withFixture((root) => {
  writeFileSync(join(root, 'codex.exe'), 'native');
  assert.throws(() => resolveCodexJudgeExecutable({
    platform: 'win32', userHome: root,
    env: { PATH: root, AGENT_HUB_MEMORY_JUDGE_CODEX_BIN: 'codex.cmd' },
  }), /override must be an absolute path/);
}));

test('POSIX keeps standard native PATH command unless user explicitly overrides', () => {
  assert.deepEqual(resolveCodexJudgeExecutable({
    platform: 'linux', env: { PATH: '/usr/bin' },
  }), { command: 'codex', prefixArgs: [], kind: 'path_command' });
});

const FAKE_CODEX_SCRIPT = "const { writeFileSync } = require('node:fs');\nconst index = process.argv.indexOf('--output-last-message');\nif (index < 0) process.exit(7);\nconst output = process.argv[index + 1];\nlet input = '';\nprocess.stdin.setEncoding('utf8');\nprocess.stdin.on('data', part => { input += part; });\nprocess.stdin.on('end', () => {\n  if (!input.includes('Importance rule:')) process.exit(8);\n  writeFileSync(output, JSON.stringify({decision:'ignore',suggested_type:'decision',durability:'short',future_utility:'low',specificity:'low',confidence:'high',meaning_preserved:true,canonical_fact:null,reason:'Temporary',risk_flags:[]}));\n});\n";


test('Windows real spawn executes an npm Codex entrypoint without cmd.exe, shell or network', {
  skip: process.platform !== 'win32',
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-cli-real-spawn-'));
  let resource = null;
  try {
    const shim = join(root, 'codex.cmd');
    writeFileSync(shim, '@echo off\nexit /b 123\n');
    const npmBin = join(root, 'node_modules', '@openai', 'codex', 'bin');
    mkdirSync(npmBin, { recursive: true });
    const fakeJs = join(npmBin, 'codex.js');
    writeFileSync(fakeJs, FAKE_CODEX_SCRIPT);
    const authHome = join(root, 'auth-source');
    mkdirSync(authHome);
    writeFileSync(join(authHome, 'auth.json'), '{}');

    // Codex shim dir first; retain PATH to find real git.exe.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PATH'),
    );
    env.PATH = root + ';' + (process.env.Path || process.env.PATH || '');
    env.AGENT_HUB_MEMORY_JUDGE_CODEX_BIN = shim;

    resource = await createCodexMemoryCandidateJudge({
      cwd: root, env, sourceCodexHome: authHome, timeoutMs: 20_000,
    });
    const response = await resource.judge({
      proposed_value: 'We chose a temporary implementation detail.',
      proposed_type: 'decision',
      source_authority: 'user_direct',
      policy_version: 'candidate-v1',
    });
    const parsed = JSON.parse(response);
    assert.equal(parsed.decision, 'ignore');
    assert.equal(parsed.canonical_fact, null);
  } finally {
    if (resource) await resource.close();
    rmSync(root, { recursive: true, force: true });
  }
});
