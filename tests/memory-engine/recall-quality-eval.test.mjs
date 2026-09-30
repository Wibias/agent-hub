import test from 'node:test';
import assert from 'node:assert/strict';

import {
  summarizeRecallQuality,
  sweepSemanticThresholds,
} from '../../memory-engine/recall-quality-eval.mjs';

const cases = [
  {
    id: 'positive-top1',
    relevantClaimIds: ['c-a'],
    rankings: {
      lexical: ['c-a', 'c-x'],
      semantic: ['c-a', 'c-x'],
      fused: ['c-a', 'c-x'],
    },
    semanticCandidates: [
      { claimId: 'c-a', similarity: 0.84 },
      { claimId: 'c-x', similarity: 0.61 },
    ],
  },
  {
    id: 'positive-rank2',
    relevantClaimIds: ['c-b'],
    rankings: {
      lexical: [],
      semantic: ['c-x', 'c-b'],
      fused: ['c-x', 'c-b'],
    },
    semanticCandidates: [
      { claimId: 'c-x', similarity: 0.78 },
      { claimId: 'c-b', similarity: 0.74 },
    ],
  },
  {
    id: 'negative-empty-lexical',
    relevantClaimIds: [],
    rankings: {
      lexical: [],
      semantic: ['c-x'],
      fused: ['c-x'],
    },
    semanticCandidates: [
      { claimId: 'c-x', similarity: 0.58 },
    ],
  },
  {
    id: 'negative-noisy',
    relevantClaimIds: [],
    rankings: {
      lexical: ['c-y'],
      semantic: ['c-y'],
      fused: ['c-y'],
    },
    semanticCandidates: [
      { claimId: 'c-y', similarity: 0.72 },
    ],
  },
];

test('recall quality summary measures hit rate, false negatives, MRR, and negative noise per route', () => {
  const summary = summarizeRecallQuality(cases, {
    kValues: [1, 2],
  });

  assert.deepEqual(summary.counts, {
    queries: 4,
    positiveQueries: 2,
    negativeQueries: 2,
  });

  assert.deepEqual(summary.routes.lexical, {
    hitRateAtK: {
      1: 0.5,
      2: 0.5,
    },
    falseNegativeRateAtK: {
      1: 0.5,
      2: 0.5,
    },
    meanReciprocalRank: 0.5,
    negativeNonEmptyRate: 0.5,
  });

  assert.deepEqual(summary.routes.semantic, {
    hitRateAtK: {
      1: 0.5,
      2: 1,
    },
    falseNegativeRateAtK: {
      1: 0.5,
      2: 0,
    },
    meanReciprocalRank: 0.75,
    negativeNonEmptyRate: 1,
  });

  assert.deepEqual(summary.routes.fused, summary.routes.semantic);

  assert.deepEqual(summary.semanticSimilarity, {
    positiveRelevant: {
      count: 2,
      min: 0.74,
      max: 0.84,
      mean: 0.79,
      median: 0.79,
    },
    negativeTop1: {
      count: 2,
      min: 0.58,
      max: 0.72,
      mean: 0.65,
      median: 0.65,
    },
  });
});

test('semantic threshold sweep separates relevant recall from negative-query noise', () => {
  const sweep = sweepSemanticThresholds(cases, {
    thresholds: [0.6, 0.75, 0.8],
    k: 2,
  });

  assert.deepEqual(sweep, [
    {
      threshold: 0.6,
      truePositiveQueries: 2,
      falsePositiveQueries: 1,
      falseNegativeQueries: 0,
      trueNegativeQueries: 1,
      precision: 2 / 3,
      recall: 1,
      f1: 0.8,
      positiveHitRate: 1,
      negativeSuppressionRate: 0.5,
    },
    {
      threshold: 0.75,
      truePositiveQueries: 1,
      falsePositiveQueries: 1,
      falseNegativeQueries: 1,
      trueNegativeQueries: 1,
      precision: 0.5,
      recall: 0.5,
      f1: 0.5,
      positiveHitRate: 0.5,
      negativeSuppressionRate: 0.5,
    },
    {
      threshold: 0.8,
      truePositiveQueries: 1,
      falsePositiveQueries: 0,
      falseNegativeQueries: 1,
      trueNegativeQueries: 2,
      precision: 1,
      recall: 0.5,
      f1: 2 / 3,
      positiveHitRate: 0.5,
      negativeSuppressionRate: 1,
    },
  ]);
});

test('recall quality helpers reject malformed evaluation cases instead of hiding bad fixtures', () => {
  assert.throws(
    () => summarizeRecallQuality([], { kValues: [1, 5] }),
    /case/i,
  );

  assert.throws(
    () => summarizeRecallQuality([
      {
        id: 'bad',
        relevantClaimIds: ['c-a'],
        rankings: {
          lexical: ['c-a'],
          semantic: ['c-a'],
        },
        semanticCandidates: [],
      },
    ]),
    /fused|rank/i,
  );

  assert.throws(
    () => sweepSemanticThresholds(cases, {
      thresholds: [0.7, 0.7],
      k: 2,
    }),
    /threshold/i,
  );
});
