export const RECALL_RELEVANCE_ENABLEMENT_GATE_V1 = Object.freeze({
  policy_version: 'recall-relevance-enablement-v1',
  max_failures: 0,
  min_precision: 0.95,
  min_recall: 0.90,
  min_exact_selection_rate: 0.85,
  max_negative_false_positive_rate: 0,
});

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(name + ' must be a finite number');
  return number;
}

function nonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError(name + ' must be a non-negative integer');
  }
  return number;
}

export function evaluateRecallRelevanceEnablementGate(evaluation) {
  if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) {
    throw new TypeError('evaluation must be an object');
  }

  const observed = {
    failures: nonNegativeInteger(evaluation?.counts?.failures, 'evaluation.counts.failures'),
    precision: finiteNumber(evaluation?.quality?.precision, 'evaluation.quality.precision'),
    recall: finiteNumber(evaluation?.quality?.recall, 'evaluation.quality.recall'),
    exact_selection_rate: finiteNumber(
      evaluation?.quality?.exact_selection_rate,
      'evaluation.quality.exact_selection_rate',
    ),
    negative_false_positive_rate: finiteNumber(
      evaluation?.quality?.negative_false_positive_rate,
      'evaluation.quality.negative_false_positive_rate',
    ),
  };

  const thresholds = {
    max_failures: RECALL_RELEVANCE_ENABLEMENT_GATE_V1.max_failures,
    min_precision: RECALL_RELEVANCE_ENABLEMENT_GATE_V1.min_precision,
    min_recall: RECALL_RELEVANCE_ENABLEMENT_GATE_V1.min_recall,
    min_exact_selection_rate: RECALL_RELEVANCE_ENABLEMENT_GATE_V1.min_exact_selection_rate,
    max_negative_false_positive_rate:
      RECALL_RELEVANCE_ENABLEMENT_GATE_V1.max_negative_false_positive_rate,
  };

  const failedChecks = [];
  if (observed.failures > thresholds.max_failures) failedChecks.push('selector_failures');
  if (observed.precision < thresholds.min_precision) failedChecks.push('precision');
  if (observed.recall < thresholds.min_recall) failedChecks.push('recall');
  if (observed.exact_selection_rate < thresholds.min_exact_selection_rate) {
    failedChecks.push('exact_selection_rate');
  }
  if (observed.negative_false_positive_rate > thresholds.max_negative_false_positive_rate) {
    failedChecks.push('negative_false_positive_rate');
  }

  return {
    policy_version: RECALL_RELEVANCE_ENABLEMENT_GATE_V1.policy_version,
    passed: failedChecks.length === 0,
    thresholds,
    observed,
    failed_checks: failedChecks,
  };
}
