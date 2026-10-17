import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRecallShadowReplayPacket,
  recallShadowReplayPacketId,
  validateRecallShadowReplayPacket,
} from '../../memory-engine/recall-shadow-replay-packet.mjs';

function candidate(id, value = `memory ${id}`) {
  return {
    claim: {
      id,
      type: 'fact',
      value,
      state: 'active',
      project_id: 'github.com/Wibias/agent-hub',
      branch: 'main',
    },
    evidence: [
      {
        id: `evidence:${id}`,
        authority: 'user_direct',
        value,
      },
    ],
    authority: 'user_direct',
    state: 'active',
  };
}

function baseInput(overrides = {}) {
  return {
    projectId: 'github.com/Wibias/agent-hub',
    branch: 'main',
    sessionId: 'session-123',
    turnId: 'turn-456',
    query: 'What command verifies memory health?',
    candidates: [
      candidate('claim-a', 'Run node .\\scripts\\doctor-memory.mjs and require healthy.'),
      candidate('claim-b', 'Install dependencies from the committed lockfile.'),
    ],
    fastResult: {
      route: 'fast_v1',
      selected_ids: ['claim-a'],
      duration_ms: 23,
      failed: false,
      decision: 'fast_positive',
      policy_version: 'recall-fast-v1',
    },
    retrievalTelemetry: {
      lexical: [{ id: 'claim-a', rank: 1 }],
      semantic: [{ id: 'claim-a', rank: 1 }],
      fused: [{ id: 'claim-a', rank: 1 }],
    },
    maxSelected: 8,
    createdAt: '2026-10-13T23:40:00.000Z',
    ...overrides,
  };
}

test('packet identity is deterministic from exact scope plus Codex turn identity', () => {
  const first = recallShadowReplayPacketId({
    projectId: 'project-a',
    branch: 'main',
    sessionId: 'session-1',
    turnId: 'turn-1',
  });
  const second = recallShadowReplayPacketId({
    projectId: 'project-a',
    branch: 'main',
    sessionId: 'session-1',
    turnId: 'turn-1',
  });

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);

  for (const changed of [
    { projectId: 'project-b', branch: 'main', sessionId: 'session-1', turnId: 'turn-1' },
    { projectId: 'project-a', branch: 'feature/x', sessionId: 'session-1', turnId: 'turn-1' },
    { projectId: 'project-a', branch: 'main', sessionId: 'session-2', turnId: 'turn-1' },
    { projectId: 'project-a', branch: 'main', sessionId: 'session-1', turnId: 'turn-2' },
  ]) {
    assert.notEqual(recallShadowReplayPacketId(changed), first);
  }
});

test('createdAt and content never influence deterministic packet identity', () => {
  const first = createRecallShadowReplayPacket(baseInput({
    createdAt: '2026-10-13T23:40:00.000Z',
  }));
  const second = createRecallShadowReplayPacket(baseInput({
    createdAt: '2026-10-14T00:40:00.000Z',
    query: 'Different natural prompt in an intentionally synthetic identity test',
  }));

  assert.equal(first.id, second.id);
});

test('packet freezes exact JSON-safe Judge candidate evidence and Fast Path observation', () => {
  const input = baseInput();
  const packet = createRecallShadowReplayPacket(input);

  assert.equal(packet.schemaVersion, 1);
  assert.equal(packet.type, 'recall_shadow_replay_packet');
  assert.deepEqual(packet.scope, {
    projectId: input.projectId,
    branch: input.branch,
  });
  assert.deepEqual(packet.source, {
    sessionId: input.sessionId,
    turnId: input.turnId,
  });
  assert.equal(packet.query, input.query);
  assert.deepEqual(packet.candidates, input.candidates);
  assert.deepEqual(packet.localFastPath, input.fastResult);
  assert.deepEqual(packet.retrieval, {
    candidate_count: 2,
    telemetry: input.retrievalTelemetry,
  });
  assert.deepEqual(packet.selectorContract, { maxSelected: 8 });

  input.candidates[0].claim.value = 'MUTATED AFTER CAPTURE';
  input.fastResult.selected_ids.push('claim-b');
  input.retrievalTelemetry.lexical[0].rank = 99;

  assert.equal(
    packet.candidates[0].claim.value,
    'Run node .\\scripts\\doctor-memory.mjs and require healthy.',
  );
  assert.deepEqual(packet.localFastPath.selected_ids, ['claim-a']);
  assert.equal(packet.retrieval.telemetry.lexical[0].rank, 1);
});

test('validated packet round-trips through JSON without semantic drift', () => {
  const packet = createRecallShadowReplayPacket(baseInput());
  const roundTripped = JSON.parse(JSON.stringify(packet));
  assert.deepEqual(validateRecallShadowReplayPacket(roundTripped), packet);
});

test('stable scope, turn identity, query and selection contract are required', () => {
  for (const [field, value] of [
    ['projectId', ''],
    ['branch', '   '],
    ['sessionId', ''],
    ['turnId', null],
    ['query', ''],
  ]) {
    assert.throws(
      () => createRecallShadowReplayPacket(baseInput({ [field]: value })),
      new RegExp(field, 'i'),
    );
  }

  for (const maxSelected of [0, -1, 1.5, '8']) {
    assert.throws(
      () => createRecallShadowReplayPacket(baseInput({ maxSelected })),
      /maxSelected/i,
    );
  }
});

test('candidate claim IDs are non-empty and unique', () => {
  assert.throws(
    () => createRecallShadowReplayPacket(baseInput({
      candidates: [candidate('claim-a'), candidate('claim-a')],
    })),
    /candidate.*unique|unique.*candidate/i,
  );

  assert.throws(
    () => createRecallShadowReplayPacket(baseInput({
      candidates: [{ claim: { id: '' } }],
    })),
    /claim.*id/i,
  );
});

test('Fast Path selected IDs must be unique supplied candidate IDs', () => {
  assert.throws(
    () => createRecallShadowReplayPacket(baseInput({
      fastResult: {
        route: 'fast_v1',
        selected_ids: ['claim-missing'],
        duration_ms: 1,
        failed: false,
      },
    })),
    /selected_ids/i,
  );

  assert.throws(
    () => createRecallShadowReplayPacket(baseInput({
      fastResult: {
        route: 'fast_v1',
        selected_ids: ['claim-a', 'claim-a'],
        duration_ms: 1,
        failed: false,
      },
    })),
    /selected_ids/i,
  );

  assert.throws(
    () => createRecallShadowReplayPacket(baseInput({
      fastResult: {
        route: 'fallback',
        selected_ids: ['claim-a'],
        duration_ms: 1,
        failed: false,
      },
    })),
    /fallback/i,
  );
});

test('zero-candidate packet may carry null localFastPath and preserves no-candidate replay input', () => {
  const packet = createRecallShadowReplayPacket(baseInput({
    candidates: [],
    fastResult: null,
    retrievalTelemetry: null,
  }));

  assert.equal(packet.retrieval.candidate_count, 0);
  assert.equal(packet.localFastPath, null);
  assert.equal(packet.retrieval.telemetry, null);
});

test('non-JSON-safe candidate state is rejected instead of silently captured', () => {
  const withFunction = candidate('claim-a');
  withFunction.runtimeOnly = () => {};

  assert.throws(
    () => createRecallShadowReplayPacket(baseInput({
      candidates: [withFunction],
      fastResult: {
        route: 'fast_v1',
        selected_ids: ['claim-a'],
        duration_ms: 1,
        failed: false,
      },
    })),
    /JSON-safe|function/i,
  );

  const withCycle = candidate('claim-a');
  withCycle.self = withCycle;

  assert.throws(
    () => createRecallShadowReplayPacket(baseInput({
      candidates: [withCycle],
      fastResult: {
        route: 'fast_v1',
        selected_ids: ['claim-a'],
        duration_ms: 1,
        failed: false,
      },
    })),
    /cyclic|JSON-safe/i,
  );
});

test('validator detects tampered deterministic packet identity', () => {
  const packet = createRecallShadowReplayPacket(baseInput());
  assert.throws(
    () => validateRecallShadowReplayPacket({
      ...packet,
      id: '0'.repeat(64),
    }),
    /id/i,
  );
});