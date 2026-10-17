import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureRecallShadowReplayPacket,
  observeRecallFastPath,
} from '../../memory-engine/recall-shadow-replay-capture.mjs';

function candidate(id = 'claim-a') {
  return {
    claim: {
      id,
      type: 'fact',
      value: `value:${id}`,
      state: 'active',
    },
    authority: 'user_direct',
    state: 'active',
  };
}

test('observeRecallFastPath normalizes a valid local observation', async () => {
  let calls = 0;
  const result = await observeRecallFastPath({
    query: 'memory health?',
    items: [candidate()],
    fastPath: async ({ query, items, retrievalTelemetry }) => {
      calls += 1;
      assert.equal(query, 'memory health?');
      assert.equal(items.length, 1);
      assert.deepEqual(retrievalTelemetry, { lexical: [] });
      return {
        route: 'fast_v1',
        selected_ids: ['claim-a'],
        duration_ms: 17.8,
        failed: false,
        decision: 'fast_positive',
        policy_version: 'recall-fast-v1',
      };
    },
    fastPathContext: {
      retrievalTelemetry: { lexical: [] },
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result.selected_ids, ['claim-a']);
  assert.equal(result.duration_ms, 17);
  assert.equal(result.failed, false);
});

test('observeRecallFastPath converts local exceptions into observational failure', async () => {
  let now = 100;
  const result = await observeRecallFastPath({
    query: 'memory health?',
    items: [candidate()],
    fastPath: async () => {
      throw new Error('synthetic local fast failure');
    },
    clockMs: () => {
      now += 7;
      return now;
    },
  });

  assert.equal(result.route, 'fallback');
  assert.deepEqual(result.selected_ids, []);
  assert.equal(result.failed, true);
  assert.equal(result.decision, 'fast_path_failed');
  assert.match(result.error, /synthetic local fast failure/);
});

test('observeRecallFastPath returns null for zero candidates without invoking Fast Path', async () => {
  let calls = 0;
  const result = await observeRecallFastPath({
    query: 'memory health?',
    items: [],
    fastPath: async () => {
      calls += 1;
      throw new Error('must not run');
    },
  });

  assert.equal(result, null);
  assert.equal(calls, 0);
});

test('observeRecallFastPath rejects selected IDs outside the frozen candidate set', async () => {
  const result = await observeRecallFastPath({
    query: 'memory health?',
    items: [candidate()],
    fastPath: async () => ({
      route: 'fast_v1',
      selected_ids: ['missing'],
      duration_ms: 1,
      failed: false,
    }),
  });

  assert.equal(result.route, 'fallback');
  assert.equal(result.failed, true);
  assert.deepEqual(result.selected_ids, []);
  assert.match(result.error, /selected_ids/i);
});

test('captureRecallShadowReplayPacket persists the exact observation snapshot', () => {
  const captured = [];
  const original = candidate();
  const result = captureRecallShadowReplayPacket({
    store: {
      capture(packet) {
        captured.push(packet);
        return { status: 'captured', id: packet.id };
      },
    },
    projectId: 'github.com/Wibias/agent-hub',
    branch: 'main',
    sessionId: 'session-1',
    turnId: 'turn-1',
    query: 'memory health?',
    candidates: [original],
    fastResult: {
      route: 'fast_v1',
      selected_ids: ['claim-a'],
      duration_ms: 17,
      failed: false,
    },
    retrievalTelemetry: {
      lexical: [{ id: 'claim-a', rank: 1 }],
    },
    maxSelected: 8,
    createdAt: '2026-10-14T01:30:00.000Z',
  });

  assert.equal(result.capture.status, 'captured');
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].localFastPath.selected_ids, ['claim-a']);

  original.claim.value = 'mutated after capture';
  assert.equal(captured[0].candidates[0].claim.value, 'value:claim-a');
});