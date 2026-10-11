import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateClaimTemporalValidity,
  filterTemporallyCurrentRecall,
} from '../../memory-engine/claim-temporal-validity.mjs';

function claim(overrides = {}) {
  return {
    id: 'c-1',
    state: 'active',
    valid_from: null,
    valid_until: null,
    ...overrides,
  };
}

test('unbounded active claim is current', () => {
  assert.deepEqual(
    evaluateClaimTemporalValidity(claim(), { now: '2026-10-11T12:00:00.000Z' }),
    { current: true, effective_state: 'active', reason: null },
  );
});

test('valid_from is inclusive and valid_until is exclusive', () => {
  assert.deepEqual(
    evaluateClaimTemporalValidity(claim({ valid_from: '2026-10-12T00:00:00.000Z' }), {
      now: '2026-10-11T23:59:59.999Z',
    }),
    { current: false, effective_state: 'active', reason: 'not_yet_valid' },
  );
  assert.equal(
    evaluateClaimTemporalValidity(claim({ valid_from: '2026-10-12T00:00:00.000Z' }), {
      now: '2026-10-12T00:00:00.000Z',
    }).current,
    true,
  );
  assert.equal(
    evaluateClaimTemporalValidity(claim({ valid_until: '2026-10-12T00:00:00.000Z' }), {
      now: '2026-10-11T23:59:59.999Z',
    }).current,
    true,
  );
  assert.deepEqual(
    evaluateClaimTemporalValidity(claim({ valid_until: '2026-10-12T00:00:00.000Z' }), {
      now: '2026-10-12T00:00:00.000Z',
    }),
    { current: false, effective_state: 'expired', reason: 'valid_until_reached' },
  );
});

test('non-active canonical lifecycle state never becomes current because of temporal bounds', () => {
  for (const state of ['superseded', 'rejected', 'stale', 'conflicted', 'expired']) {
    const result = evaluateClaimTemporalValidity(claim({ state }), {
      now: '2026-10-11T12:00:00.000Z',
    });
    assert.equal(result.current, false);
    assert.equal(result.effective_state, state);
    assert.equal(result.reason, 'canonical_state_' + state);
  }
});

test('invalid timestamps and inverted intervals fail closed', () => {
  assert.throws(
    () => evaluateClaimTemporalValidity(claim({ valid_until: 'not-a-time' }), {
      now: '2026-10-11T12:00:00.000Z',
    }),
    /valid_until/i,
  );
  assert.throws(
    () => evaluateClaimTemporalValidity(claim({
      valid_from: '2026-10-13T00:00:00.000Z',
      valid_until: '2026-10-12T00:00:00.000Z',
    }), { now: '2026-10-11T12:00:00.000Z' }),
    /before valid_from/i,
  );
});

test('temporal recall filter drops non-current items and disconnected conflicts', () => {
  const result = filterTemporallyCurrentRecall({
    items: [
      { claim: claim({ id: 'c-current' }) },
      { claim: claim({ id: 'c-expired', valid_until: '2026-10-11T12:00:00.000Z' }) },
      { claim: claim({ id: 'c-future', valid_from: '2026-10-12T00:00:00.000Z' }) },
    ],
    conflicts: [
      { claim_a: 'c-current', claim_b: 'c-expired', state: 'open' },
      { claim_a: 'c-expired', claim_b: 'c-future', state: 'open' },
    ],
  }, { now: '2026-10-11T12:00:00.000Z' });

  assert.deepEqual(result.items.map((item) => item.claim.id), ['c-current']);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.excluded.map((entry) => [entry.claim_id, entry.reason]), [
    ['c-expired', 'valid_until_reached'],
    ['c-future', 'not_yet_valid'],
  ]);
});
