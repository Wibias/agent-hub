import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateRecallRelevanceCases,
} from '../../memory-engine/recall-relevance-eval.mjs';

function item(id, value = id) {
  return {
    claim: { id, state: 'active', kind: 'fact', subject: 's', predicate: 'p', value },
    evidence: { authority_class: 'user_direct', content_redacted: value },
  };
}

test('relevance eval reports selection quality and negative-query false positives', async () => {
  const cases = [
    { id: 'positive', query: 'db?', items: [item('db'), item('ui')], relevantClaimIds: ['db'] },
    { id: 'negative', query: 'weather?', items: [item('db')], relevantClaimIds: [] },
  ];
  const result = await evaluateRecallRelevanceCases(cases, {
    judge({ query }) {
      return query === 'db?'
        ? { selected_ids: ['db'], reason: 'direct' }
        : { selected_ids: ['db'], reason: 'wrong' };
    },
    clockMs: (() => { let n = 0; return () => (n += 5); })(),
  });

  assert.equal(result.counts.cases, 2);
  assert.equal(result.counts.failures, 0);
  assert.equal(result.quality.true_positive, 1);
  assert.equal(result.quality.false_positive, 1);
  assert.equal(result.quality.false_negative, 0);
  assert.equal(result.quality.precision, 0.5);
  assert.equal(result.quality.recall, 1);
  assert.equal(result.quality.exact_selection_rate, 0.5);
  assert.equal(result.quality.negative_false_positive_rate, 1);
  assert.equal(result.performance.judge_calls, 2);
});

test('relevance eval counts selector failures without treating them as false positives', async () => {
  const result = await evaluateRecallRelevanceCases([
    { id: 'one', query: 'db?', items: [item('db')], relevantClaimIds: ['db'] },
  ], {
    judge() { return 'not-json'; },
  });

  assert.equal(result.counts.failures, 1);
  assert.equal(result.quality.true_positive, 0);
  assert.equal(result.quality.false_positive, 0);
  assert.equal(result.quality.false_negative, 1);
});
