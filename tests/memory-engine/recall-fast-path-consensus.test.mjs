import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateRecallHybridFastPath,
  calibrateRecallHybridFastPath,
} from '../../memory-engine/recall-fast-path-consensus.mjs';

const cases = [
  {
    id: 'single-rescue',
    relevantClaimIds: ['a'],
    candidates: [
      { claimId: 'a', similarity: 0.90, lexicalRank: 1, semanticRank: 1, finalRank: 1, rrfScore: 0.0328 },
      { claimId: 'b', similarity: 0.85, lexicalRank: 2, semanticRank: 2, finalRank: 2, rrfScore: 0.0322 },
    ],
  },
  {
    id: 'multi-rescue',
    relevantClaimIds: ['a', 'b'],
    candidates: [
      { claimId: 'a', similarity: 0.848, lexicalRank: 1, semanticRank: 1, finalRank: 1, rrfScore: 0.0328 },
      { claimId: 'b', similarity: 0.842, lexicalRank: 2, semanticRank: 2, finalRank: 2, rrfScore: 0.0322 },
      { claimId: 'c', similarity: 0.806, lexicalRank: null, semanticRank: 3, finalRank: 3, rrfScore: 0.0159 },
    ],
  },
  {
    id: 'unsafe-stays-fallback',
    relevantClaimIds: ['a'],
    candidates: [
      { claimId: 'a', similarity: 0.85, lexicalRank: 2, semanticRank: 1, finalRank: 2, rrfScore: 0.0322 },
      { claimId: 'b', similarity: 0.849, lexicalRank: 1, semanticRank: 2, finalRank: 1, rrfScore: 0.0328 },
    ],
  },
];

const baselineCases = [
  { id: 'single-rescue', route: 'fallback', selected_ids: [] },
  { id: 'multi-rescue', route: 'fallback', selected_ids: [] },
  { id: 'unsafe-stays-fallback', route: 'fallback', selected_ids: [] },
];

test('hybrid fast path rescues only consensus-backed fallbacks', () => {
  const result = evaluateRecallHybridFastPath(cases, {
    baselineCases,
    negativeThreshold: 0.84,
    positiveThreshold: 0.86,
    supportThreshold: 0.82,
    singleMarginThreshold: 0.04,
    lexicalK: 2,
    fusedK: 2,
    minVotes: 2,
  });

  assert.deepEqual(
    result.cases.map((entry) => [entry.id, entry.route, entry.selected_ids]),
    [
      ['single-rescue', 'fast_single_consensus', ['a']],
      ['multi-rescue', 'fast_multi_consensus', ['a', 'b']],
      ['unsafe-stays-fallback', 'fallback', []],
    ],
  );
  assert.equal(result.fast_errors, 0);
  assert.equal(result.fast_cases, 2);
});

test('hybrid calibration maximizes zero-error coverage', () => {
  const result = calibrateRecallHybridFastPath(cases, {
    baselineCases,
    negativeThreshold: 0.84,
    positiveThreshold: 0.86,
    supportThresholds: [0.80, 0.82, 0.84],
    singleMarginThresholds: [0.01, 0.04, 0.08],
    lexicalKs: [1, 2],
    fusedKs: [1, 2],
    minVotesValues: [2, 3],
  });

  assert.equal(result.recommended.fast_errors, 0);
  assert.ok(result.recommended.fast_cases >= 2);
  assert.ok(result.sweep.tested_configurations > 0);
  assert.ok(result.sweep.zero_error_configurations > 0);
});


test('v2 preserves every v1 fast decision even when hybrid similarity drifts across the threshold', () => {
  const driftCase = [{
    id: 'baseline-fast',
    relevantClaimIds: ['a'],
    candidates: [
      { claimId: 'a', similarity: 0.858, lexicalRank: 1, semanticRank: 1, finalRank: 1, rrfScore: 0.0328 },
      { claimId: 'b', similarity: 0.78, lexicalRank: 2, semanticRank: 2, finalRank: 2, rrfScore: 0.0322 },
    ],
  }];
  const baseline = [{ id: 'baseline-fast', route: 'fast_positive', selected_ids: ['a'] }];
  const result = evaluateRecallHybridFastPath(driftCase, {
    baselineCases: baseline,
    negativeThreshold: 0.84,
    positiveThreshold: 0.86,
    supportThreshold: 0.86,
    singleMarginThreshold: 0.03,
    lexicalK: 1,
    fusedK: 1,
    minVotes: 3,
  });
  assert.equal(result.cases[0].route, 'fast_positive');
  assert.deepEqual(result.cases[0].selected_ids, ['a']);
  assert.equal(result.cases[0].baseline_preserved, true);
  assert.equal(result.fast_errors, 0);
});
