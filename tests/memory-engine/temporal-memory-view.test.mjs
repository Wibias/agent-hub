import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTemporalMemoryView,
} from '../../memory-engine/temporal-memory-view.mjs';

function item(id, overrides = {}) {
  return {
    claim: {
      id,
      state: 'active',
      valid_from: null,
      valid_until: null,
      ...overrides,
    },
    evidence: { authority_class: 'user_direct' },
  };
}

function fakeMemory() {
  const claims = new Map([
    ['current', item('current').claim],
    ['expired', item('expired', { valid_until: '2026-10-11T12:00:00.000Z' }).claim],
    ['future', item('future', { valid_from: '2026-10-12T00:00:00.000Z' }).claim],
  ]);
  return {
    marker: 7,
    getClaim(id) { return claims.get(id) ?? null; },
    recall() {
      return {
        items: [item('current'), item('expired', { valid_until: '2026-10-11T12:00:00.000Z' })],
        conflicts: [{ claim_a: 'current', claim_b: 'expired', state: 'open' }],
      };
    },
    materializeRecall() {
      return {
        items: [item('future', { valid_from: '2026-10-12T00:00:00.000Z' }), item('current')],
        conflicts: [],
      };
    },
    semanticCandidates() {
      return [
        { claim_id: 'current', dimensions: 2 },
        { claim_id: 'expired', dimensions: 2 },
        { claim_id: 'future', dimensions: 2 },
      ];
    },
    passthrough(value) { return this.marker + value; },
  };
}

test('temporal view filters current recall and keeps historical recall untouched', () => {
  const view = createTemporalMemoryView({
    memory: fakeMemory(),
    now: () => '2026-10-11T12:00:00.000Z',
  });
  const current = view.recall({ mode: 'current' });
  assert.deepEqual(current.items.map((entry) => entry.claim.id), ['current']);
  assert.deepEqual(current.conflicts, []);

  const historical = view.recall({ mode: 'historical' });
  assert.deepEqual(historical.items.map((entry) => entry.claim.id), ['current', 'expired']);
  assert.equal(historical.conflicts.length, 1);
});

test('temporal view filters current materialization and semantic candidates', () => {
  const view = createTemporalMemoryView({
    memory: fakeMemory(),
    now: () => '2026-10-11T12:00:00.000Z',
  });
  assert.deepEqual(
    view.materializeRecall({ mode: 'current' }).items.map((entry) => entry.claim.id),
    ['current'],
  );
  assert.deepEqual(
    view.semanticCandidates({ mode: 'current' }).map((entry) => entry.claim_id),
    ['current'],
  );
  assert.deepEqual(
    view.semanticCandidates({ mode: 'historical' }).map((entry) => entry.claim_id),
    ['current', 'expired', 'future'],
  );
});

test('temporal view preserves unrelated MemoryEngine methods with bound receiver', () => {
  const memory = fakeMemory();
  const view = createTemporalMemoryView({ memory, now: () => '2026-10-11T12:00:00.000Z' });
  assert.equal(view.passthrough(5), 12);
  assert.equal(view.getClaim('current'), memory.getClaim('current'));
});
