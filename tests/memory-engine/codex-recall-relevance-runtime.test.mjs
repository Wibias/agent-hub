import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCodexRecallRelevanceRuntime,
} from '../../memory-engine/adapters/codex-recall-relevance-runtime.mjs';

test('disabled codex recall relevance runtime is zero-cost and exposes null judge', async () => {
  let judgeRuntimes = 0;
  let recorders = 0;
  const runtime = createCodexRecallRelevanceRuntime({
    enabled: false,
    dbPath: '/tmp/memory.sqlite3',
    projectId: 'project-a',
    branch: 'main',
    createJudgeRuntime: async () => { judgeRuntimes += 1; return {}; },
    createTelemetryRecorder: () => { recorders += 1; return {}; },
  });
  assert.equal(runtime.judge, null);
  await runtime.close();
  assert.equal(judgeRuntimes, 0);
  assert.equal(recorders, 0);
});

test('enabled codex recall relevance runtime lazily wires recorder into one judge runtime', async () => {
  let runtimeCreates = 0;
  let recorderCreates = 0;
  let recorderClosed = 0;
  let runtimeClosed = 0;
  let receivedOnUsage = null;

  const runtime = createCodexRecallRelevanceRuntime({
    enabled: true,
    dbPath: '/tmp/memory.sqlite3',
    projectId: 'project-a',
    branch: 'main',
    model: 'gpt-test',
    reasoningEffort: 'low',
    timeoutMs: 7_500,
    env: { X: '1' },
    createJsonJudge: async () => ({ judge: async () => '{}', close: async () => {} }),
    createTelemetryRecorder(options) {
      recorderCreates += 1;
      assert.equal(options.projectId, 'project-a');
      assert.equal(options.branch, 'main');
      return {
        onUsage: async () => {},
        close() { recorderClosed += 1; },
      };
    },
    createJudgeRuntime: async (options) => {
      runtimeCreates += 1;
      receivedOnUsage = options.onUsage;
      assert.equal(options.model, 'gpt-test');
      assert.equal(options.reasoningEffort, 'low');
      assert.equal(options.timeoutMs, 7_500);
      assert.equal(typeof options.createJsonJudge, 'function');
      return {
        evaluatorId: 'eval:recall',
        judge: async () => '{"selected_ids":[],"reason":"None."}',
        async close() { runtimeClosed += 1; },
      };
    },
  });

  assert.equal(runtimeCreates, 0);
  assert.equal(recorderCreates, 0);
  await runtime.judge({ prompt: 'query selector prompt' });
  await runtime.judge({ prompt: 'query selector prompt 2' });
  assert.equal(runtimeCreates, 1);
  assert.equal(recorderCreates, 1);
  assert.equal(typeof receivedOnUsage, 'function');
  assert.equal(runtime.evaluatorId(), 'eval:recall');

  await runtime.close();
  assert.equal(runtimeClosed, 1);
  assert.equal(recorderClosed, 1);
});


test('enabled default runtime requires an isolated json judge factory', () => {
  assert.throws(
    () => createCodexRecallRelevanceRuntime({
      enabled: true,
      dbPath: '/tmp/memory.sqlite3',
      projectId: 'project-a',
      branch: 'main',
      createJsonJudge: null,
    }),
    /createJsonJudge/u,
  );
});
