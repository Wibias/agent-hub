import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { resolveCodexCandidateLaunch } from '../../memory-engine/codex-candidate-launch.mjs';

function simulate(files, env = { Path: 'C:\\Fixture\\npm' }) {
  return resolveCodexCandidateLaunch({
    platform: 'win32',
    env,
    nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe',
    fileExists: (file) => files.includes(file),
  });
}

test('Windows npm PowerShell shim resolves directly to its Node CLI (no shell)', () => {
  const dir = 'C:\\Fixture\\npm';
  const ps1 = win32.join(dir, 'codex.ps1');
  const js = win32.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  assert.deepEqual(simulate([ps1, js]), {
    command: 'C:\\Program Files\\nodejs\\node.exe',
    prefixArgs: [js],
    kind: 'npm_node',
  });
});

test('Windows native executable and PATH precedence remain supported', () => {
  const first = 'C:\\A';
  const second = 'C:\\B';
  const exe = win32.join(first, 'codex.exe');
  const shim = win32.join(second, 'codex.cmd');
  const js = win32.join(second, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  assert.deepEqual(simulate([exe, shim, js], { PATH: first + ';' + second }), {
    command: exe,
    prefixArgs: [],
    kind: 'native',
  });
  assert.deepEqual(simulate([shim, js], { PATH: first + ';' + second }), {
    command: 'C:\\Program Files\\nodejs\\node.exe',
    prefixArgs: [js],
    kind: 'npm_node',
  });
});

test('Explicit Windows Codex .exe and npm .ps1 paths are handled without a shell', () => {
  const ps1 = 'C:\\Tools\\codex.ps1';
  const js = 'C:\\Tools\\node_modules\\@openai\\codex\\bin\\codex.js';
  assert.deepEqual(simulate([ps1, js], { CODEX_BIN: ps1 }), {
    command: 'C:\\Program Files\\nodejs\\node.exe',
    prefixArgs: [js],
    kind: 'npm_node',
  });
  assert.deepEqual(simulate([], { CODEX_BIN: 'C:\\Tools\\codex.exe' }), {
    command: 'C:\\Tools\\codex.exe',
    prefixArgs: [],
    kind: 'native',
  });
});

test('Windows shim without Node CLI fails closed; POSIX behavior remains unchanged', () => {
  const shim = 'C:\\Tools\\codex.ps1';
  assert.throws(
    () => simulate([shim], { Path: 'C:\\Tools' }),
    (error) => error.code === 'CODEX_NPM_ENTRYPOINT_MISSING',
  );
  assert.throws(
    () => simulate([], { Path: 'C:\\Tools' }),
    (error) => error.code === 'CODEX_NOT_FOUND',
  );
  assert.deepEqual(resolveCodexCandidateLaunch({
    platform: 'linux', env: { PATH: '/usr/bin' },
  }), { command: 'codex', prefixArgs: [], kind: 'native' });
});

test('Windows npm entrypoint actually starts with Node without cmd or PowerShell', {
  skip: process.platform !== 'win32',
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-npm-launch-'));
  try {
    const npmDir = join(root, 'npm');
    const bin = join(npmDir, 'node_modules', '@openai', 'codex', 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(npmDir, 'codex.ps1'), '# test shim\n');
    await writeFile(join(bin, 'codex.js'), "process.stdout.write('codex-cli fixture 1.0.0\\n');\n");
    const invocation = resolveCodexCandidateLaunch({
      platform: 'win32',
      env: { Path: npmDir },
      fileExists: existsSync,
    });
    const result = spawnSync(
      invocation.command,
      [...invocation.prefixArgs, '--version'],
      { encoding: 'utf8', timeout: 10_000, windowsHide: true },
    );
    assert.equal(invocation.kind, 'npm_node');
    assert.equal(result.status, 0, String(result.error?.code || result.stderr));
    assert.match(result.stdout, /codex-cli fixture/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
