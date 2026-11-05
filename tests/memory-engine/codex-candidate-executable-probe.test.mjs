import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCodexCandidateExecutable } from '../../scripts/doctor-codex-candidate-executable.mjs';

const launch = () => ({
  command: 'C:\\Program Files\\nodejs\\node.exe',
  prefixArgs: ['C:\\Fixture\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'],
  kind: 'npm_node',
});

test('version probe invokes only --version through native Node, no shell', () => {
  let called = 0;
  const result = verifyCodexCandidateExecutable({
    resolveLaunch: launch,
    spawnProcess(command, args, options) {
      called += 1;
      assert.equal(command, 'C:\\Program Files\\nodejs\\node.exe');
      assert.deepEqual(args, [...launch().prefixArgs, '--version']);
      assert.equal(options.shell, false);
      return { status: 0, stdout: 'codex-cli 1.0.0', stderr: '' };
    },
  });
  assert.equal(called, 1);
  assert.deepEqual(result, {
    status: 'ok', launchKind: 'npm_node', versionCommandSucceeded: true,
  });
});

test('version probe returns fixed codes without exposing paths or provider stderr', () => {
  const response = verifyCodexCandidateExecutable({
    resolveLaunch: launch,
    spawnProcess: () => ({
      status: 1,
      stdout: 'PRIVATE PROMPT',
      stderr: 'Missing optional dependency @openai/codex-win32-x64 PRIVATE-LOCATION',
    }),
  });
  assert.deepEqual(response, {
    status: 'failed', stage: 'execution', launchKind: 'npm_node',
    issue: 'missing_platform_dependency', exitCode: 1,
  });
  assert.equal(JSON.stringify(response).includes('PRIVATE'), false);
});

test('version probe fails closed when Windows shim is not resolvable', () => {
  const response = verifyCodexCandidateExecutable({
    resolveLaunch() {
      throw Object.assign(new Error('PRIVATE FILE'), {
        code: 'CODEX_NPM_ENTRYPOINT_MISSING',
      });
    },
  });
  assert.deepEqual(response, {
    status: 'failed', stage: 'resolution', issue: 'CODEX_NPM_ENTRYPOINT_MISSING',
  });
  assert.equal(JSON.stringify(response).includes('PRIVATE'), false);
});
