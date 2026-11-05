import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLiveCandidateProbeArgs,
  runLiveCandidateProbe,
  summarizeLiveCandidateProbeError,
} from '../../scripts/doctor-codex-candidate-live.mjs';

test('live candidate probe accepts only one optional model and effort', () => {
  assert.deepEqual(parseLiveCandidateProbeArgs([]), { model: null, reasoningEffort: 'medium' });
  assert.deepEqual(parseLiveCandidateProbeArgs(['--model', 'synthetic-model', '--reasoning-effort', 'low']), {
    model: 'synthetic-model', reasoningEffort: 'low',
  });
  assert.throws(() => parseLiveCandidateProbeArgs(['--apply']), /Expected/);
  assert.throws(() => parseLiveCandidateProbeArgs(['--model', 'a', '--model', 'b']), /Expected/);
  assert.throws(() => parseLiveCandidateProbeArgs(['--db-path', '/private']), /Expected/);
});

test('uses one synthetic candidate and closes resource without emitting the response', async () => {
  let judged = 0;
  let closed = 0;
  const result = await runLiveCandidateProbe({
    createJudge: async () => ({
      async judge(candidate) {
        judged++;
        assert.equal(candidate.source_authority, 'user_direct');
        assert.equal(candidate.proposed_type, 'constraint');
        assert.match(candidate.proposed_value, /synthetic test project/);
        return 'SECRET-RESPONSE';
      },
      async close() { closed++; },
    }),
    parseResponse(response) { assert.equal(response, 'SECRET-RESPONSE'); },
  });
  assert.deepEqual(result, {
    status: 'ok', judgeExecutionSucceeded: true, judgeResponseValid: true,
  });
  assert.equal(judged, 1);
  assert.equal(closed, 1);
  assert.equal(JSON.stringify(result).includes('SECRET-RESPONSE'), false);
});

test('categorizes quota exit without leaking provider stderr or private text', async () => {
  const result = await runLiveCandidateProbe({
    createJudge: async () => ({
      async judge() {
        throw new Error('codex candidate judge failed with exit 1: insufficient_quota');
      },
      async close() {},
    }),
  });
  assert.deepEqual(result, {
    status: 'failed', failedStage: 'execution', issue: 'insufficient_quota',
    exitCode: 1, judgeExecutionSucceeded: false,
  });
  const withSecret = summarizeLiveCandidateProbeError(
    new Error('codex candidate judge failed with exit 2: PRIVATE-SERVICE-DUMP'),
    'execution',
  );
  assert.deepEqual(withSecret, {
    status: 'failed', failedStage: 'execution', issue: 'unknown',
  });
  assert.equal(JSON.stringify(withSecret).includes('PRIVATE'), false);
});

test('setup errors and invalid model response are distinguished without leaking payloads', async () => {
  const setup = await runLiveCandidateProbe({
    createJudge: async () => {
      throw Object.assign(new Error('PRIVATE FILE'), { code: 'CODEX_NPM_ENTRYPOINT_MISSING' });
    },
  });
  assert.deepEqual(setup, {
    status: 'failed', failedStage: 'setup', issue: 'CODEX_NPM_ENTRYPOINT_MISSING',
    judgeExecutionSucceeded: false,
  });
  assert.equal(JSON.stringify(setup).includes('PRIVATE'), false);

  const validation = await runLiveCandidateProbe({
    createJudge: async () => ({
      async judge() { return '{"decision":"ignore"}'; },
      async close() {},
    }),
    parseResponse() { throw new Error('candidate response contained PRIVATE PAYLOAD'); },
  });
  assert.deepEqual(validation, {
    status: 'failed', failedStage: 'validation',
    issue: 'invalid_judge_response', judgeExecutionSucceeded: true,
  });
  assert.equal(JSON.stringify(validation).includes('PRIVATE'), false);
});

test('resource cleanup failures do not replace a valid observation', async () => {
  const result = await runLiveCandidateProbe({
    createJudge: async () => ({
      async judge() { return '{}'; },
      async close() { throw new Error('PRIVATE CLEANUP FAILURE'); },
    }),
    parseResponse() {},
  });
  assert.equal(result.status, 'ok');
});
