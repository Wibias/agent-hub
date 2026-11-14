import test from 'node:test';
import assert from 'node:assert/strict';
import {
  codexCandidateFailureCode,
  codexCandidateLaunchFailureCode,
  summarizeCodexCandidateProcessExit,
} from '../../memory-engine/codex-candidate-process-error.mjs';

test('normalizes likely provider errors to fixed codes without exposing text', () => {
  const cases = [
    ['insufficient_quota', 'insufficient_quota'],
    ['You have hit your usage limit', 'usage_limit_reached_possible'],
    ['HTTP 429 Too Many Requests', 'rate_limit'],
    ['HTTP 401 Unauthorized', 'authentication'],
    ['HTTP 403 Forbidden', 'authorization'],
    ['invalid model format', 'model_configuration'],
    ['HTTP 503 Service Unavailable', 'provider_unavailable'],
    ['ECONNRESET', 'connection'],
    ['unexpected provider issue', 'unknown'],
  ];
  for (const [stderr, expected] of cases) {
    const hint = codexCandidateFailureCode({ stderr: stderr + ' SECRET-TOKEN' });
    assert.equal(hint, expected);
    const output = summarizeCodexCandidateProcessExit({
      code: 1,
      stderr: stderr + ' SECRET-TOKEN',
      stdout: 'candidate: PRIVATE-FACT',
    });
    assert.equal(output, 'codex candidate judge failed with exit 1: ' + expected);
    assert.equal(output.includes('SECRET'), false);
    assert.equal(output.includes('PRIVATE'), false);
  }
});

test('normalizes unknown and missing exit codes without copying stdout', () => {
  const output = summarizeCodexCandidateProcessExit({
    code: null, signal: 'SIGTERM',
    stderr: 'private sensitive content',
    stdout: 'more private content',
  });
  assert.equal(output, 'codex candidate judge failed with exit unknown: unknown');
  assert.equal(output.includes('private'), false);
});

test('launch error classification does not leak paths, secrets or unexpected exception text', () => {
  assert.equal(codexCandidateLaunchFailureCode({ code: 'ENOENT', message: 'PRIVATE PATH' }), 'executable_not_found');
  assert.equal(codexCandidateLaunchFailureCode({ code: 'EACCES', message: 'PRIVATE PATH' }), 'permission_denied');
  assert.equal(codexCandidateLaunchFailureCode({ code: 'ETIMEDOUT' }), 'timeout');
  assert.equal(codexCandidateLaunchFailureCode(new Error('password=SECRETVALUE')), 'unknown');
});
