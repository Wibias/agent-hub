import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLazyRecallRelevanceJudge,
} from '../../memory-engine/lazy-recall-relevance-judge.mjs';

test('disabled lazy recall judge exposes null judge and never creates runtime', async () => {
  let created = 0;
  const lazy = createLazyRecallRelevanceJudge({
    enabled: false,
    createRuntime: async () => { created += 1; return {}; },
  });

  assert.equal(lazy.judge, null);
  await lazy.close();
  assert.equal(created, 0);
});

test('enabled lazy recall judge creates one runtime on first actual judge call and reuses it', async () => {
  let created = 0;
  let closed = 0;
  const calls = [];
  const lazy = createLazyRecallRelevanceJudge({
    enabled: true,
    runtimeOptions: { model: 'gpt-test' },
    createRuntime: async (options) => {
      created += 1;
      assert.deepEqual(options, { model: 'gpt-test' });
      return {
        evaluatorId: 'eval:test',
        judge: async ({ prompt }) => { calls.push(prompt); return '{}'; },
        async close() { closed += 1; },
      };
    },
  });

  assert.equal(created, 0);
  await lazy.judge({ prompt: 'one' });
  await lazy.judge({ prompt: 'two' });
  assert.equal(created, 1);
  assert.deepEqual(calls, ['one', 'two']);
  assert.equal(lazy.evaluatorId(), 'eval:test');

  await lazy.close();
  assert.equal(closed, 1);
});

test('lazy recall judge validates created runtime contract', async () => {
  const lazy = createLazyRecallRelevanceJudge({
    enabled: true,
    createRuntime: async () => ({}),
  });
  await assert.rejects(() => lazy.judge({ prompt: 'x' }), /judge/u);
});
