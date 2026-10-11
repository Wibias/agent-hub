import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runInstrumentedMemoryJudge,
} from '../../memory-engine/model-judge-telemetry.mjs';

test('instrumented judge emits content-free success telemetry with optional token usage', async () => {
  const ticks = [100, 145];
  const events = [];
  const result = await runInstrumentedMemoryJudge({
    stage: 'recall_relevance',
    evaluatorId: 'codex:test:recall-v1',
    prompt: 'PRIVATE PROMPT',
    judge: async () => '{"ok":true}',
    getUsage: () => ({
      input_tokens: 1000,
      cached_input_tokens: 600,
      cache_write_input_tokens: null,
      output_tokens: 30,
      reasoning_output_tokens: 12,
    }),
    onUsage: (event) => events.push(event),
    clockMs: () => ticks.shift(),
  });

  assert.equal(result, '{"ok":true}');
  assert.deepEqual(events, [{
    stage: 'recall_relevance',
    evaluator_id: 'codex:test:recall-v1',
    status: 'success',
    duration_ms: 45,
    input_tokens: 1000,
    cached_input_tokens: 600,
    cache_write_input_tokens: null,
    output_tokens: 30,
    reasoning_output_tokens: 12,
  }]);
  assert.equal(JSON.stringify(events).includes('PRIVATE PROMPT'), false);
});

test('instrumented judge emits failure telemetry and rethrows original error', async () => {
  const events = [];
  const error = new Error('judge failed');
  await assert.rejects(
    () => runInstrumentedMemoryJudge({
      stage: 'support',
      evaluatorId: 'eval:support',
      prompt: 'private',
      judge: async () => { throw error; },
      getUsage: () => null,
      onUsage: (event) => events.push(event),
      clockMs: (() => { const ticks = [5, 9]; return () => ticks.shift(); })(),
    }),
    (caught) => caught === error,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'failed');
  assert.equal(events[0].duration_ms, 4);
  assert.equal(events[0].input_tokens, null);
});
