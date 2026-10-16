import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createRecallShadowReplayPacket,
} from '../../memory-engine/recall-shadow-replay-packet.mjs';
import {
  evaluateRecallShadowReplayPacket,
} from '../../memory-engine/recall-shadow-replay-evaluator.mjs';

function candidate(id, value = `value:${id}`) {
  return {
    claim: {
      id,
      kind: 'user_memory',
      subject: 'memory',
      predicate: 'states',
      value,
      state: 'active',
    },
    evidence: {
      authority_class: 'user_direct',
      content_redacted: value,
    },
  };
}

function packet({
  candidates = [candidate('claim-a'), candidate('claim-b')],
  fastResult = {
    route: 'fast_v1',
    selected_ids: ['claim-a'],
    duration_ms: 23,
    failed: false,
  },
  query = 'What command verifies memory health?',
  maxSelected = 8,
} = {}) {
  return createRecallShadowReplayPacket({
    projectId: 'github.com/Wibias/agent-hub',
    branch: 'main',
    sessionId: 'session-eval',
    turnId: 'turn-eval',
    query,
    candidates,
    fastResult,
    retrievalTelemetry: {
      lexical: candidates.map((entry, index) => ({
        id: entry.claim.id,
        rank: index + 1,
      })),
    },
    maxSelected,
    createdAt: '2026-10-14T01:40:00.000Z',
  });
}

function steppedClock(values) {
  let index = 0;
  return () => {
    if (index >= values.length) {
      throw new Error(`clock exhausted after ${values.length} calls`);
    }
    const value = values[index];
    index += 1;
    return value;
  };
}

test('evaluator uses only frozen packet query/candidates and the supplied Judge', async () => {
  const frozen = packet();
  const seen = [];

  const result = await evaluateRecallShadowReplayPacket({
    packet: frozen,
    judge: async (input) => {
      seen.push(input);
      return {
        selected_ids: ['claim-a'],
        reason: 'claim-a directly answers the frozen query',
      };
    },
    clockMs: steppedClock([100, 110, 130, 140]),
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].query, frozen.query);
  assert.deepEqual(seen[0].items, frozen.candidates);
  assert.equal(seen[0].maxSelected, frozen.selectorContract.maxSelected);
  assert.equal(result.status, 'fast_v1_match');
  assert.equal(result.judgeCalled, true);
  assert.deepEqual(result.judgeSelectedIds, ['claim-a']);
  assert.equal(result.candidateCount, 2);
  assert.equal(result.selectedCount, 1);
  assert.equal(result.localDurationMs, 23);
  assert.equal(result.totalDurationMs, 40);
});

test('no_candidates is terminal without invoking Judge', async () => {
  let judgeCalls = 0;
  const result = await evaluateRecallShadowReplayPacket({
    packet: packet({
      candidates: [],
      fastResult: null,
    }),
    judge: async () => {
      judgeCalls += 1;
      throw new Error('must not run');
    },
    clockMs: steppedClock([200, 205]),
  });

  assert.equal(judgeCalls, 0);
  assert.deepEqual(result, {
    status: 'no_candidates',
    judgeCalled: false,
    judgeSelectedIds: [],
    candidateCount: 0,
    selectedCount: 0,
    localDurationMs: 0,
    totalDurationMs: 5,
  });
});

test('fast_path_failed is terminal without invoking Judge', async () => {
  let judgeCalls = 0;
  const result = await evaluateRecallShadowReplayPacket({
    packet: packet({
      fastResult: {
        route: 'fallback',
        selected_ids: [],
        duration_ms: 19,
        failed: true,
        error: 'captured local failure',
      },
    }),
    judge: async () => {
      judgeCalls += 1;
      throw new Error('must not run');
    },
    clockMs: steppedClock([300, 307]),
  });

  assert.equal(judgeCalls, 0);
  assert.equal(result.status, 'fast_path_failed');
  assert.equal(result.judgeCalled, false);
  assert.deepEqual(result.judgeSelectedIds, []);
  assert.equal(result.localDurationMs, 19);
  assert.equal(result.totalDurationMs, 7);
});

test('fast_path_fallback invokes Judge for operational validation but remains fallback', async () => {
  let judgeCalls = 0;
  const result = await evaluateRecallShadowReplayPacket({
    packet: packet({
      fastResult: {
        route: 'fallback',
        selected_ids: [],
        duration_ms: 12,
        failed: false,
      },
    }),
    judge: async () => {
      judgeCalls += 1;
      return {
        selected_ids: ['claim-b'],
        reason: 'Judge still validates the frozen candidates',
      };
    },
    clockMs: steppedClock([400, 410, 420, 430]),
  });

  assert.equal(judgeCalls, 1);
  assert.equal(result.status, 'fast_path_fallback');
  assert.equal(result.judgeCalled, true);
  assert.deepEqual(result.judgeSelectedIds, ['claim-b']);
  assert.equal(result.selectedCount, 1);
  assert.equal(result.localDurationMs, 12);
  assert.equal(result.totalDurationMs, 30);
});

test('v1 selected IDs compare as sets', async () => {
  const result = await evaluateRecallShadowReplayPacket({
    packet: packet({
      fastResult: {
        route: 'fast_v1',
        selected_ids: ['claim-b', 'claim-a'],
        duration_ms: 8,
        failed: false,
      },
    }),
    judge: async () => ({
      selected_ids: ['claim-a', 'claim-b'],
      reason: 'both are relevant',
    }),
    clockMs: steppedClock([500, 501, 502, 503]),
  });

  assert.equal(result.status, 'fast_v1_match');
  assert.deepEqual(result.judgeSelectedIds, ['claim-a', 'claim-b']);
  assert.equal(result.selectedCount, 2);
});

test('v1 mismatch is reported without changing the frozen local result', async () => {
  const result = await evaluateRecallShadowReplayPacket({
    packet: packet({
      fastResult: {
        route: 'fast_v1',
        selected_ids: ['claim-a'],
        duration_ms: 9,
        failed: false,
      },
    }),
    judge: async () => ({
      selected_ids: ['claim-b'],
      reason: 'only claim-b is relevant',
    }),
    clockMs: steppedClock([600, 601, 602, 603]),
  });

  assert.equal(result.status, 'fast_v1_mismatch');
  assert.deepEqual(result.judgeSelectedIds, ['claim-b']);
});

test('v2 match and mismatch reuse the same frozen Judge contract', async () => {
  const match = await evaluateRecallShadowReplayPacket({
    packet: packet({
      fastResult: {
        route: 'fast_v2',
        selected_ids: ['claim-b'],
        duration_ms: 15,
        failed: false,
      },
    }),
    judge: async () => ({
      selected_ids: ['claim-b'],
      reason: 'claim-b is relevant',
    }),
    clockMs: steppedClock([700, 701, 702, 703]),
  });

  assert.equal(match.status, 'fast_v2_match');

  const mismatch = await evaluateRecallShadowReplayPacket({
    packet: packet({
      fastResult: {
        route: 'fast_v2',
        selected_ids: ['claim-a'],
        duration_ms: 16,
        failed: false,
      },
    }),
    judge: async () => ({
      selected_ids: ['claim-b'],
      reason: 'claim-b is relevant',
    }),
    clockMs: steppedClock([800, 801, 802, 803]),
  });

  assert.equal(mismatch.status, 'fast_v2_mismatch');
});

for (const [name, judge] of [
  [
    'Judge rejection',
    async () => {
      throw new Error('synthetic isolated Judge timeout');
    },
  ],
  [
    'Judge parse failure',
    async () => 'not-json',
  ],
]) {
  test(`${name} becomes terminal judge_unavailable`, async () => {
    const result = await evaluateRecallShadowReplayPacket({
      packet: packet(),
      judge,
      clockMs: steppedClock([900, 910, 920, 930]),
    });

    assert.equal(result.status, 'judge_unavailable');
    assert.equal(result.judgeCalled, true);
    assert.deepEqual(result.judgeSelectedIds, []);
    assert.equal(result.selectedCount, 0);
    assert.equal(result.totalDurationMs, 30);
  });
}

test('missing Judge function becomes judge_unavailable without claiming invocation', async () => {
  const result = await evaluateRecallShadowReplayPacket({
    packet: packet(),
    judge: null,
    clockMs: steppedClock([1000, 1009]),
  });

  assert.equal(result.status, 'judge_unavailable');
  assert.equal(result.judgeCalled, false);
  assert.deepEqual(result.judgeSelectedIds, []);
  assert.equal(result.totalDurationMs, 9);
});

test('packet maxSelected is reused by the existing relevance selector', async () => {
  const frozen = packet({ maxSelected: 1 });

  const result = await evaluateRecallShadowReplayPacket({
    packet: frozen,
    judge: async ({ maxSelected }) => {
      assert.equal(maxSelected, 1);
      return {
        selected_ids: ['claim-a'],
        reason: 'one selected',
      };
    },
    clockMs: steppedClock([1100, 1101, 1102, 1103]),
  });

  assert.equal(result.status, 'fast_v1_match');
});

test('evaluator source has no retrieval, DB, embedding, or repository resolver dependency', () => {
  const source = fs.readFileSync(
    new URL('../../memory-engine/recall-shadow-replay-evaluator.mjs', import.meta.url),
    'utf8',
  );

  for (const forbidden of [
    'MemoryEngine',
    'HybridMemoryRetriever',
    'embedding-worker',
    'embedding-worker-client',
    'resolveGitContext',
    'repository-resolver',
    'better-sqlite3',
    'sqlite',
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `evaluator must not depend on ${forbidden}`,
    );
  }
});