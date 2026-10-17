import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  evaluateRecallRelevanceCases,
} from '../../memory-engine/recall-relevance-eval.mjs';

const fixtureUrl = new URL('./fixtures/recall-relevance-benchmark-v1.json', import.meta.url);

async function readCases() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

test('recall relevance benchmark v1 is a 25-case gold set', async () => {
  const cases = await readCases();
  assert.equal(cases.length, 25);
  assert.equal(new Set(cases.map((entry) => entry.id)).size, 25);

  const negativeCases = cases.filter((entry) => entry.relevantClaimIds.length === 0);
  const multiRelevantCases = cases.filter((entry) => entry.relevantClaimIds.length > 1);
  assert.ok(negativeCases.length >= 5, 'expected at least five no-match cases');
  assert.ok(multiRelevantCases.length >= 4, 'expected at least four multi-memory cases');
  assert.ok(cases.every((entry) => entry.items.length >= 5 && entry.items.length <= 10));

  const authorities = new Set(cases.flatMap((entry) => (
    entry.items.map((item) => item.evidence.authority_class)
  )));
  assert.deepEqual(
    [...authorities].sort(),
    ['repo_trusted', 'tool_observation', 'user_direct'],
  );
});

test('recall relevance benchmark v1 is accepted by the production evaluator', async () => {
  const cases = await readCases();
  const expectedByQuery = new Map(cases.map((entry) => [entry.query, entry.relevantClaimIds]));
  const result = await evaluateRecallRelevanceCases(cases, {
    judge({ query }) {
      return {
        selected_ids: expectedByQuery.get(query),
        reason: 'gold oracle',
      };
    },
  });

  assert.equal(result.counts.cases, 25);
  assert.equal(result.counts.failures, 0);
  assert.equal(result.quality.precision, 1);
  assert.equal(result.quality.recall, 1);
  assert.equal(result.quality.exact_selection_rate, 1);
  assert.equal(result.quality.negative_false_positive_rate, 0);
});
