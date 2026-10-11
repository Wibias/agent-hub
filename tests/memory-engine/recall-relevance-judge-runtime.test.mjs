import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRecallRelevanceJudgeRuntime,
} from '../../memory-engine/recall-relevance-judge-runtime.mjs';
import { RECALL_RELEVANCE_POLICY_VERSION } from '../../memory-engine/recall-relevance-selector.mjs';

test('recall relevance runtime reuses one isolated judge and exposes evaluator identity', async () => {
  const factoryCalls = [];
  const prompts = [];
  let closed = 0;

  const runtime = await createRecallRelevanceJudgeRuntime({
    model: 'gpt-test',
    reasoningEffort: 'low',
    timeoutMs: 8_000,
    env: { X: '1' },
    createJsonJudge: async (options) => {
      factoryCalls.push(options);
      return {
        judge: async (prompt) => {
          prompts.push(prompt);
          return '{"selected_ids":[],"reason":"None."}';
        },
        async close() { closed += 1; },
      };
    },
  });

  assert.equal(factoryCalls.length, 1);
  assert.equal(factoryCalls[0].workspaceLabel, 'recall-relevance');
  assert.equal(factoryCalls[0].policyVersion, RECALL_RELEVANCE_POLICY_VERSION);
  assert.equal(factoryCalls[0].reasoningEffort, 'low');
  assert.equal(factoryCalls[0].timeoutMs, 8_000);
  assert.equal(runtime.evaluatorId, 'codex:gpt-test:' + RECALL_RELEVANCE_POLICY_VERSION);

  const raw = await runtime.judge({ prompt: 'selector prompt' });
  assert.match(raw, /selected_ids/u);
  assert.deepEqual(prompts, ['selector prompt']);

  await runtime.close();
  assert.equal(closed, 1);
});

test('recall relevance runtime validates configuration and prompt contract', async () => {
  await assert.rejects(
    () => createRecallRelevanceJudgeRuntime({ createJsonJudge: null }),
    /createJsonJudge/u,
  );

  const runtime = await createRecallRelevanceJudgeRuntime({
    createJsonJudge: async () => ({ judge: async () => '{}', close: async () => {} }),
  });
  await assert.rejects(() => runtime.judge({ prompt: '' }), /prompt/u);
  await runtime.close();
});

test('recall relevance runtime emits token telemetry without exposing prompt content', async () => {
  const usageEvents = [];
  let usage = null;
  const ticks = [20, 44];
  const runtime = await createRecallRelevanceJudgeRuntime({
    createJsonJudge: async () => ({
      judge: async () => {
        usage = {
          input_tokens: 300,
          cached_input_tokens: 180,
          cache_write_input_tokens: null,
          output_tokens: 15,
          reasoning_output_tokens: 6,
        };
        return '{"selected_ids":[],"reason":"None."}';
      },
      lastUsage: () => usage,
      close: async () => {},
    }),
    onUsage: (event) => usageEvents.push(event),
    clockMs: () => ticks.shift(),
  });

  await runtime.judge({ prompt: 'PRIVATE RECALL QUERY' });
  assert.equal(usageEvents.length, 1);
  assert.equal(usageEvents[0].stage, 'recall_relevance');
  assert.equal(usageEvents[0].duration_ms, 24);
  assert.equal(usageEvents[0].input_tokens, 300);
  assert.equal(JSON.stringify(usageEvents).includes('PRIVATE RECALL QUERY'), false);
  await runtime.close();
});
