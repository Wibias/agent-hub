import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyJudgeProbeSetupError,
  parseJudgeProbeArgs,
  runCodexCandidateJudgeProbe,
  summarizeJudgeProbeFailure,
} from '../../scripts/doctor-codex-candidate-judge.mjs';

const VALID_IGNORE = JSON.stringify({
  decision: 'ignore',
  suggested_type: 'constraint',
  durability: 'short',
  future_utility: 'low',
  specificity: 'medium',
  confidence: 'high',
  meaning_preserved: true,
  canonical_fact: null,
  reason: 'One-off example; not a persistent project constraint.',
  risk_flags: ['transient'],
});

test('probe requires explicit permitted flags and no DB path', () => {
  assert.deepEqual(parseJudgeProbeArgs([]), { model: null, reasoningEffort: 'medium' });
  assert.deepEqual(
    parseJudgeProbeArgs(['--model','gpt-test','--reasoning-effort','high']),
    { model: 'gpt-test', reasoningEffort: 'high' },
  );
  assert.throws(() => parseJudgeProbeArgs(['--db-path','/secret']), /supported options/);
  assert.throws(() => parseJudgeProbeArgs(['--model']), /non-empty/);
});

test('probe uses a benign fixed candidate, validates response, and closes isolation', async () => {
  let received = null;
  let closed = false;
  const output = await runCodexCandidateJudgeProbe({
    model: 'model-test',
    createJudge: async (args) => {
      assert.equal(args.model, 'model-test');
      return {
        async judge(candidate) {
          received = candidate;
          return VALID_IGNORE;
        },
        async close() { closed = true; },
      };
    },
  });
  assert.deepEqual(output, { status: 'ok', executionSucceeded: true, judgeResponseValid: true });
  assert.equal(received.source_authority, 'user_direct');
  assert.equal(received.proposed_type, 'constraint');
  assert.equal(closed, true);
  assert.equal(JSON.stringify(output).includes(received.proposed_value), false);
});

test('probe reports safe exit categories without stdout, stderr or auth strings', async () => {
  const secret = 'PRIVATE-TOKEN-SHOULD-NOT-LEAK';
  let closed = false;
  const output = await runCodexCandidateJudgeProbe({
    createJudge: async () => ({
      async judge() {
        throw new Error('codex candidate judge failed with exit 1: 429 Too Many Requests ' + secret);
      },
      async close() { closed = true; },
    }),
  });
  assert.deepEqual(output, {
    status: 'failed', origin: 'judge_process_exit', category: 'rate_limit', exitCode: 1,
    failedStage: 'execution', executionSucceeded: false,
  });
  assert.equal(closed, true);
  assert.equal(JSON.stringify(output).includes(secret), false);

  const generic = summarizeJudgeProbeFailure(new Error(
    'codex candidate judge failed with exit 2: error sending request ' + secret,
  ));
  assert.deepEqual(generic, {
    status: 'failed', origin: 'judge_process_exit', category: 'judge_process_failure', exitCode: 2,
  });
  assert.equal(JSON.stringify(generic).includes(secret), false);
});

test('probe does not accept malformed model responses as success', async () => {
  const output = await runCodexCandidateJudgeProbe({
    createJudge: async () => ({
      async judge() { return 'not JSON'; },
      async close() {},
    }),
  });
  assert.equal(output.status, 'failed');
  assert.equal(output.origin, 'candidate_validator');
  assert.equal(output.category, 'response_validation');
  assert.equal(output.executionSucceeded, true);
  assert.equal(output.judgeResponseValid, false);
  assert.equal(output.failedStage, 'response_validation');
});

test('setup failure is distinguished from a provider failure without exposing paths', async () => {
  const cases = [
    [new Error('candidate judge requires an authenticated Codex home containing auth.json'), 'missing_codex_auth'],
    [new Error('failed to initialize isolated judge workspace: PRIVATE-PATH'), 'git_workspace_setup'],
    [Object.assign(new Error('spawn PRIVATE-PATH ENOENT'), { code: 'ENOENT' }), 'missing_executable_or_file'],
    [Object.assign(new Error('access PRIVATE-PATH EACCES'), { code: 'EACCES' }), 'filesystem_permission'],
    [new Error('PRIVATE-TOKEN UNKNOWN FAILURE'), 'unknown'],
  ];
  for (const [error, expected] of cases) {
    assert.equal(classifyJudgeProbeSetupError(error), expected);
    const output = await runCodexCandidateJudgeProbe({
      async createJudge() { throw error; },
    });
    assert.equal(output.status, 'failed');
    assert.equal(output.failedStage, 'setup');
    assert.equal(output.setupIssue, expected);
    assert.equal(output.executionSucceeded, false);
    assert.equal(JSON.stringify(output).includes('PRIVATE'), false);
  }
});
