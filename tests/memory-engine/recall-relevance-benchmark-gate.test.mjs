import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RECALL_RELEVANCE_ENABLEMENT_GATE_V1,
  evaluateRecallRelevanceEnablementGate,
} from '../../memory-engine/recall-relevance-benchmark-gate.mjs';

function evaluation(overrides = {}) {
  return {
    counts: { failures: 0, ...(overrides.counts ?? {}) },
    quality: {
      precision: 0.95,
      recall: 0.90,
      exact_selection_rate: 0.85,
      negative_false_positive_rate: 0,
      ...(overrides.quality ?? {}),
    },
  };
}

test('recall relevance enablement gate passes exactly at the v1 thresholds', () => {
  const result = evaluateRecallRelevanceEnablementGate(evaluation());
  assert.equal(result.policy_version, 'recall-relevance-enablement-v1');
  assert.equal(result.passed, true);
  assert.deepEqual(result.failed_checks, []);
  assert.deepEqual(result.thresholds, {
    max_failures: 0,
    min_precision: 0.95,
    min_recall: 0.90,
    min_exact_selection_rate: 0.85,
    max_negative_false_positive_rate: 0,
  });
  assert.equal(RECALL_RELEVANCE_ENABLEMENT_GATE_V1.min_precision, 0.95);
});

test('recall relevance enablement gate reports every failed quality guard', () => {
  const result = evaluateRecallRelevanceEnablementGate(evaluation({
    counts: { failures: 1 },
    quality: {
      precision: 0.94,
      recall: 0.89,
      exact_selection_rate: 0.84,
      negative_false_positive_rate: 0.01,
    },
  }));
  assert.equal(result.passed, false);
  assert.deepEqual(result.failed_checks, [
    'selector_failures',
    'precision',
    'recall',
    'exact_selection_rate',
    'negative_false_positive_rate',
  ]);
});

test('recall relevance enablement gate rejects incomplete benchmark results', () => {
  assert.throws(
    () => evaluateRecallRelevanceEnablementGate({ counts: { failures: 0 }, quality: {} }),
    /precision must be a finite number/u,
  );
});
