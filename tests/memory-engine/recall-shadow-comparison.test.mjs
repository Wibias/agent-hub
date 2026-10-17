import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveRecallShadowStatus,
  selectedIdSetsEqual,
} from '../../memory-engine/recall-shadow-comparison.mjs';

test('selectedIdSetsEqual compares IDs as sets', () => {
  assert.equal(selectedIdSetsEqual(['a', 'b'], ['b', 'a']), true);
  assert.equal(selectedIdSetsEqual(['a'], ['a', 'b']), false);
  assert.throws(() => selectedIdSetsEqual(['a', 'a'], ['a']), /unique/i);
  assert.throws(() => selectedIdSetsEqual(['a'], ['a', 'a']), /unique/i);
});

test('deriveRecallShadowStatus maps the exact eight Shadow statuses', () => {
  assert.equal(deriveRecallShadowStatus({
    candidateCount: 0,
    fastResult: null,
    judgeSelectedIds: [],
    judgeAvailable: false,
  }), 'no_candidates');

  assert.equal(deriveRecallShadowStatus({
    candidateCount: 3,
    fastResult: { route: 'fast_v1', selected_ids: ['a'], failed: false },
    judgeSelectedIds: ['a'],
    judgeAvailable: true,
  }), 'fast_v1_match');

  assert.equal(deriveRecallShadowStatus({
    candidateCount: 3,
    fastResult: { route: 'fast_v1', selected_ids: ['a'], failed: false },
    judgeSelectedIds: ['b'],
    judgeAvailable: true,
  }), 'fast_v1_mismatch');

  assert.equal(deriveRecallShadowStatus({
    candidateCount: 3,
    fastResult: { route: 'fast_v2', selected_ids: ['a', 'b'], failed: false },
    judgeSelectedIds: ['b', 'a'],
    judgeAvailable: true,
  }), 'fast_v2_match');

  assert.equal(deriveRecallShadowStatus({
    candidateCount: 3,
    fastResult: { route: 'fast_v2', selected_ids: ['a'], failed: false },
    judgeSelectedIds: ['a', 'b'],
    judgeAvailable: true,
  }), 'fast_v2_mismatch');

  assert.equal(deriveRecallShadowStatus({
    candidateCount: 3,
    fastResult: { route: 'fallback', selected_ids: [], failed: false },
    judgeSelectedIds: ['a'],
    judgeAvailable: true,
  }), 'fast_path_fallback');

  assert.equal(deriveRecallShadowStatus({
    candidateCount: 3,
    fastResult: { route: 'fallback', selected_ids: [], failed: true },
    judgeSelectedIds: [],
    judgeAvailable: true,
  }), 'fast_path_failed');

  assert.equal(deriveRecallShadowStatus({
    candidateCount: 3,
    fastResult: { route: 'fast_v1', selected_ids: ['a'], failed: false },
    judgeSelectedIds: [],
    judgeAvailable: false,
  }), 'judge_unavailable');
});

test('Judge unavailability preserves current synchronous Shadow precedence', () => {
  assert.equal(deriveRecallShadowStatus({
    candidateCount: 3,
    fastResult: { route: 'fallback', selected_ids: [], failed: true },
    judgeSelectedIds: [],
    judgeAvailable: false,
  }), 'judge_unavailable');
});

test('deriveRecallShadowStatus validates counts and routes', () => {
  assert.throws(() => deriveRecallShadowStatus({
    candidateCount: -1,
    fastResult: null,
    judgeSelectedIds: [],
    judgeAvailable: true,
  }), /candidateCount/i);

  assert.throws(() => deriveRecallShadowStatus({
    candidateCount: 1,
    fastResult: { route: 'legacy', selected_ids: [], failed: false },
    judgeSelectedIds: [],
    judgeAvailable: true,
  }), /route/i);
});