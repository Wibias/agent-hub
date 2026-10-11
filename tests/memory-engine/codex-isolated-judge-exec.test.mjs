import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCodexIsolatedJudgeExecArgs,
} from '../../memory-engine/codex-isolated-judge-exec.mjs';

test('isolated judge exec args enable json usage stream while preserving last-message file', () => {
  assert.deepEqual(buildCodexIsolatedJudgeExecArgs({
    workspace: '/tmp/work',
    resultPath: '/tmp/result.json',
    reasoningEffort: 'low',
    model: 'gpt-test',
  }), [
    'exec',
    '--cd', '/tmp/work',
    '--ephemeral',
    '--json',
    '--output-last-message', '/tmp/result.json',
    '-c', 'model_reasoning_effort="low"',
    '--model', 'gpt-test',
    '-',
  ]);
});

test('isolated judge exec args validate inputs and omit model when default is requested', () => {
  const args = buildCodexIsolatedJudgeExecArgs({
    workspace: '/tmp/work', resultPath: '/tmp/result.json', reasoningEffort: 'medium',
  });
  assert.equal(args.includes('--model'), false);
  assert.throws(
    () => buildCodexIsolatedJudgeExecArgs({ workspace: '', resultPath: '/x', reasoningEffort: 'low' }),
    /workspace/u,
  );
});
