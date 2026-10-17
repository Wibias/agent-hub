import test from 'node:test';
import assert from 'node:assert/strict';

import { filterRecallRelianceForContext } from '../../memory-engine/recall-relevance-pipeline.mjs';

function item(id, value = id) {
  return {
    claim: { id, kind: 'knowledge', subject: id, predicate: 'states', value, state: 'active' },
    evidence: { authority_class: 'user_direct', content_redacted: value },
  };
}

function reliance(items) {
  return { use: 'answer', selected: items, blocked: [], conflict_resolutions: [] };
}

test('fast v1 selection bypasses the model judge', async () => {
  let judgeCalls = 0;
  const result = await filterRecallRelianceForContext({
    query: 'database',
    reliance: reliance([item('a'), item('b')]),
    fastPath: async () => ({
      route: 'fast_v1', selected_ids: ['a'], duration_ms: 11,
      failed: false, policy_version: 'recall-fast-path-v2',
    }),
    judge: async () => {
      judgeCalls += 1;
      return { selected_ids: ['b'], reason: 'must not run' };
    },
  });
  assert.equal(judgeCalls, 0);
  assert.deepEqual(result.selected.map((entry) => entry.claim.id), ['a']);
  assert.equal(result.selector.telemetry.route, 'fast_v1');
  assert.equal(result.selector.telemetry.judge_called, false);
  assert.equal(result.selector.telemetry.local_duration_ms, 11);
});

test('fast fallback invokes the judge and keeps local plus total timing', async () => {
  const ticks = [100, 125];
  const result = await filterRecallRelianceForContext({
    query: 'database',
    reliance: reliance([item('a'), item('b')]),
    fastPath: async () => ({
      route: 'fallback', selected_ids: [], duration_ms: 7,
      failed: false, policy_version: 'recall-fast-path-v2',
    }),
    judge: async () => ({ selected_ids: ['b'], reason: 'direct' }),
    clockMs: () => ticks.shift(),
  });
  assert.deepEqual(result.selected.map((entry) => entry.claim.id), ['b']);
  assert.equal(result.selector.telemetry.route, 'judge');
  assert.equal(result.selector.telemetry.judge_called, true);
  assert.equal(result.selector.telemetry.local_duration_ms, 7);
  assert.equal(result.selector.telemetry.total_duration_ms, 32);
});

test('fast-path failure falls through to judge while judge failure still fails closed', async () => {
  const result = await filterRecallRelianceForContext({
    query: 'database',
    reliance: reliance([item('a')]),
    fastPath: async () => { throw new Error('worker unavailable'); },
    judge: async () => { throw new Error('judge unavailable'); },
  });
  assert.deepEqual(result.selected, []);
  assert.equal(result.selector.failed, true);
  assert.equal(result.selector.telemetry.route, 'judge');
  assert.equal(result.selector.telemetry.judge_called, true);
});
