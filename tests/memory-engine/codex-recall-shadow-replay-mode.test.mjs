import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseCodexHookCliOptions,
  runCodexMemoryHook,
} from '../../memory-engine/adapters/codex-hook-cli.mjs';
import {
  createCodexMemoryHookAdapter,
  resolveCodexRecallSelectionRuntime,
} from '../../memory-engine/adapters/codex-hooks.mjs';
import {
  selectCodexAuthoritativeRecall,
} from '../../memory-engine/adapters/codex-recall-context-selection.mjs';

function item(id, value) {
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

function relianceFor(items) {
  return {
    selected: items,
    blocked: [],
    conflict_resolutions: [],
  };
}

test('CLI parser exposes replay Shadow as default-off', () => {
  const baseline = parseCodexHookCliOptions([
    '--ignore-memory-env',
    '--hybrid-recall',
    '--recall-relevance',
  ]);
  assert.equal(baseline.recallFastPathShadowReplay, undefined);

  const replay = parseCodexHookCliOptions([
    '--ignore-memory-env',
    '--hybrid-recall',
    '--recall-relevance',
    '--recall-fast-path-shadow-replay',
  ]);
  assert.equal(replay.recallFastPathShadowReplay, true);
});

test('replay Shadow is mutually exclusive with authoritative and synchronous Shadow Fast Path', async () => {
  await assert.rejects(
    runCodexMemoryHook({
      event: null,
      configOptions: {
        recallRelevance: true,
        recallFastPath: true,
        recallFastPathShadowReplay: true,
      },
    }),
    /mutually exclusive/i,
  );

  await assert.rejects(
    runCodexMemoryHook({
      event: null,
      configOptions: {
        recallRelevance: true,
        recallFastPathShadow: true,
        recallFastPathShadowReplay: true,
      },
    }),
    /mutually exclusive/i,
  );
});

test('replay Shadow requires recall relevance', async () => {
  await assert.rejects(
    runCodexMemoryHook({
      event: null,
      configOptions: {
        recallFastPathShadowReplay: true,
      },
    }),
    /requires.*recallRelevance|recallRelevance.*required/i,
  );
});

test('selection runtime keeps normal Judge authoritative and moves Fast Path to observer', async () => {
  let fastCalls = 0;
  const judge = async () => ({
    selected_ids: ['claim-b'],
    reason: 'claim-b directly answers the query',
  });
  const fast = async () => {
    fastCalls += 1;
    return {
      route: 'fast_v1',
      selected_ids: ['claim-a'],
      duration_ms: 1,
      failed: false,
    };
  };

  const replay = resolveCodexRecallSelectionRuntime({
    recallRelevanceJudge: judge,
    recallFastPath: fast,
    recallFastPathShadowMode: false,
    recallFastPathShadowReplayMode: true,
  });

  assert.equal(replay.relevanceJudge, judge);
  assert.equal(replay.recallFastPath, null);
  assert.equal(replay.recallFastPathShadow, null);
  assert.equal(typeof replay.recallFastPathObserver, 'function');

  const observed = await replay.recallFastPathObserver({});
  assert.equal(fastCalls, 1);
  assert.deepEqual(observed.selected_ids, ['claim-a']);
});

test('baseline relevance and replay observation return identical authoritative selection with one Judge call each', async () => {
  const items = [
    item('claim-a', 'unrelated memory'),
    item('claim-b', 'run doctor-memory and require healthy'),
  ];

  let baselineJudgeCalls = 0;
  const baseline = await selectCodexAuthoritativeRecall({
    query: 'What command verifies memory health?',
    items,
    conflicts: [],
    evaluateReliance: () => relianceFor(items),
    relevanceJudge: async () => {
      baselineJudgeCalls += 1;
      return {
        selected_ids: ['claim-b'],
        reason: 'claim-b directly answers the query',
      };
    },
  });

  let replayJudgeCalls = 0;
  let fastCalls = 0;
  const observations = [];

  const replay = await selectCodexAuthoritativeRecall({
    query: 'What command verifies memory health?',
    items,
    conflicts: [],
    evaluateReliance: () => relianceFor(items),
    relevanceJudge: async () => {
      replayJudgeCalls += 1;
      return {
        selected_ids: ['claim-b'],
        reason: 'claim-b directly answers the query',
      };
    },
    recallFastPathObserver: async () => {
      fastCalls += 1;
      return {
        route: 'fast_v1',
        selected_ids: ['claim-a'],
        duration_ms: 2,
        failed: false,
      };
    },
    onRecallFastPathObservation: async (observation) => {
      observations.push(observation);
    },
  });

  assert.equal(baselineJudgeCalls, 1);
  assert.equal(replayJudgeCalls, 1);
  assert.equal(fastCalls, 1);
  assert.deepEqual(
    replay.selected.map((entry) => entry.claim.id),
    baseline.selected.map((entry) => entry.claim.id),
  );
  assert.deepEqual(
    replay.selector.selected_ids,
    baseline.selector.selected_ids,
  );
  assert.equal(observations.length, 1);
  assert.deepEqual(
    observations[0].candidates.map((entry) => entry.claim.id),
    ['claim-a', 'claim-b'],
  );
  assert.deepEqual(observations[0].fastResult.selected_ids, ['claim-a']);
});

test('replay capture callback failure is fail-open and does not change Judge authority', async () => {
  const items = [
    item('claim-a', 'unrelated memory'),
    item('claim-b', 'run doctor-memory and require healthy'),
  ];

  let judgeCalls = 0;
  const replay = await selectCodexAuthoritativeRecall({
    query: 'What command verifies memory health?',
    items,
    conflicts: [],
    evaluateReliance: () => relianceFor(items),
    relevanceJudge: async () => {
      judgeCalls += 1;
      return {
        selected_ids: ['claim-b'],
        reason: 'claim-b directly answers the query',
      };
    },
    recallFastPathObserver: async () => ({
      route: 'fast_v1',
      selected_ids: ['claim-a'],
      duration_ms: 2,
      failed: false,
    }),
    onRecallFastPathObservation: async () => {
      throw new Error('synthetic capture failure');
    },
  });

  assert.equal(judgeCalls, 1);
  assert.deepEqual(replay.selector.selected_ids, ['claim-b']);
});

test('real UserPromptSubmit captures stable zero-candidate packet without extra Judge call', async () => {
  let judgeCalls = 0;
  let fastCalls = 0;
  const captured = [];

  const adapter = createCodexMemoryHookAdapter({
    protocol: {
      async handle(request) {
        if (request.operation === 'recall') {
          return {
            ok: true,
            result: {
              items: [],
              conflicts: [],
            },
          };
        }
        throw new Error(`unexpected protocol operation ${request.operation}`);
      },
    },
    memory: {},
    projectId: 'github.com/Wibias/agent-hub',
    recallRelevanceJudge: async () => {
      judgeCalls += 1;
      return {
        selected_ids: [],
        reason: 'none',
      };
    },
    recallFastPath: async () => {
      fastCalls += 1;
      throw new Error('must not run for zero candidates');
    },
    recallFastPathShadowReplayMode: true,
    recallShadowReplayStore: {
      capture(packet) {
        captured.push(packet);
        return { status: 'captured', id: packet.id };
      },
    },
    git: {
      async resolveContext() {
        return {
          branch: 'main',
          revisionSha: 'a'.repeat(40),
          repoPath: 'C:/repo',
        };
      },
      async refreshFreshness() {},
    },
    clock: () => '2026-10-14T01:35:00.000Z',
  });

  const output = await adapter.handle({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'session-real',
    turn_id: 'turn-real',
    cwd: 'C:/repo',
    prompt: 'natural prompt',
  });

  assert.equal(output, null);
  assert.equal(judgeCalls, 0);
  assert.equal(fastCalls, 0);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].source.sessionId, 'session-real');
  assert.equal(captured[0].source.turnId, 'turn-real');
  assert.equal(captured[0].localFastPath, null);
});

test('real hook replay-store failure is fail-open', async () => {
  const adapter = createCodexMemoryHookAdapter({
    protocol: {
      async handle(request) {
        if (request.operation === 'recall') {
          return {
            ok: true,
            result: {
              items: [],
              conflicts: [],
            },
          };
        }
        throw new Error(`unexpected protocol operation ${request.operation}`);
      },
    },
    memory: {},
    projectId: 'github.com/Wibias/agent-hub',
    recallRelevanceJudge: async () => ({
      selected_ids: [],
      reason: 'none',
    }),
    recallFastPath: async () => {
      throw new Error('must not run for zero candidates');
    },
    recallFastPathShadowReplayMode: true,
    recallShadowReplayStore: {
      capture() {
        throw new Error('synthetic replay disk failure');
      },
    },
    git: {
      async resolveContext() {
        return {
          branch: 'main',
          revisionSha: 'a'.repeat(40),
          repoPath: 'C:/repo',
        };
      },
      async refreshFreshness() {},
    },
    clock: () => '2026-10-14T01:35:00.000Z',
  });

  const output = await adapter.handle({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'session-fail-open',
    turn_id: 'turn-fail-open',
    cwd: 'C:/repo',
    prompt: 'natural prompt',
  });

  assert.equal(output, null);
});