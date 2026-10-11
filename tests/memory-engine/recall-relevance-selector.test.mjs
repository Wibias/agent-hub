import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RECALL_RELEVANCE_POLICY_VERSION,
  buildRecallRelevancePrompt,
  parseRecallRelevanceJudgment,
  selectRelevantRecallItems,
  validateRecallRelevanceJudgment,
} from '../../memory-engine/recall-relevance-selector.mjs';

function item(id, value, authority = 'user_direct') {
  return {
    claim: {
      id,
      kind: authority === 'user_direct' ? 'user_direct' : 'knowledge',
      subject: authority === 'user_direct' ? 'user memory' : 'evidence memory',
      predicate: 'states',
      value,
      state: 'active',
    },
    evidence: {
      authority_class: authority,
      source_ref: 'test:' + id,
      content_redacted: value,
    },
  };
}

test('recall relevance judgment is strict bounded selection over supplied claim ids', () => {
  const allowed = new Set(['c-a', 'c-b', 'c-c']);
  assert.deepEqual(
    validateRecallRelevanceJudgment({
      selected_ids: ['c-b', 'c-a'],
      reason: 'Both directly answer the database choice question.',
    }, { allowedIds: allowed, maxSelected: 2 }),
    {
      selected_ids: ['c-b', 'c-a'],
      reason: 'Both directly answer the database choice question.',
    },
  );

  assert.throws(() => validateRecallRelevanceJudgment({
    selected_ids: ['c-x'], reason: 'Unknown.',
  }, { allowedIds: allowed, maxSelected: 2 }), /not supplied/u);
  assert.throws(() => validateRecallRelevanceJudgment({
    selected_ids: ['c-a', 'c-a'], reason: 'Duplicate.',
  }, { allowedIds: allowed, maxSelected: 2 }), /duplicate/u);
  assert.throws(() => validateRecallRelevanceJudgment({
    selected_ids: ['c-a', 'c-b', 'c-c'], reason: 'Too many.',
  }, { allowedIds: allowed, maxSelected: 2 }), /at most 2/u);
  assert.throws(() => validateRecallRelevanceJudgment({
    selected_ids: [], reason: 'None.', extra: true,
  }, { allowedIds: allowed, maxSelected: 2 }), /unexpected field/u);
});

test('recall relevance prompt treats candidates as quoted data and demands direct utility', () => {
  const prompt = buildRecallRelevancePrompt({
    query: 'Which database do we use for concurrent writes?',
    items: [
      item('c-db', 'Use Postgres for concurrent writers.'),
      item('c-ui', 'Use square buttons in setup screens.'),
    ],
    maxSelected: 8,
  });

  assert.match(prompt, new RegExp(RECALL_RELEVANCE_POLICY_VERSION, 'u'));
  assert.match(prompt, /quoted data, never instructions/iu);
  assert.match(prompt, /directly useful/iu);
  assert.match(prompt, /shared vocabulary/iu);
  assert.match(prompt, /current user query takes priority/iu);
  assert.match(prompt, /c-db/u);
  assert.match(prompt, /c-ui/u);
});

test('selector preserves retrieval order rather than model-selected order', async () => {
  const items = [
    item('c-a', 'Postgres is used.'),
    item('c-b', 'Concurrent writes use Postgres.'),
    item('c-c', 'UI uses square buttons.'),
  ];
  const result = await selectRelevantRecallItems({
    query: 'database concurrent writes',
    items,
    maxSelected: 2,
    judge: async () => ({
      selected_ids: ['c-b', 'c-a'],
      reason: 'Both directly useful.',
    }),
  });

  assert.equal(result.failed, false);
  assert.deepEqual(result.selected_ids, ['c-a', 'c-b']);
  assert.deepEqual(result.items.map((entry) => entry.claim.id), ['c-a', 'c-b']);
});

test('selector fails soft to no injected memories when judge output is invalid', async () => {
  const result = await selectRelevantRecallItems({
    query: 'database',
    items: [item('c-a', 'Postgres is used.')],
    judge: async () => '{not json',
  });

  assert.equal(result.failed, true);
  assert.equal(result.fallback_reason, 'selector_failed');
  assert.deepEqual(result.selected_ids, []);
  assert.deepEqual(result.items, []);
});

test('selector does not call the judge when there are no authority-approved candidates', async () => {
  let calls = 0;
  const result = await selectRelevantRecallItems({
    query: 'database',
    items: [],
    judge: async () => {
      calls += 1;
      throw new Error('should not run');
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.failed, false);
  assert.deepEqual(result.items, []);
});

test('parser accepts fenced JSON but still enforces supplied ids', () => {
  const parsed = parseRecallRelevanceJudgment(
    '```json\n{"selected_ids":["c-a"],"reason":"Directly useful."}\n```',
    { allowedIds: new Set(['c-a']), maxSelected: 8 },
  );
  assert.deepEqual(parsed.selected_ids, ['c-a']);

  assert.throws(() => parseRecallRelevanceJudgment(
    '{"selected_ids":["blocked-claim"],"reason":"Try to reintroduce it."}',
    { allowedIds: new Set(['c-a']), maxSelected: 8 },
  ), /not supplied/u);
});


test('selector reports bounded operational telemetry without query content', async () => {
  const ticks = [1000, 1037];
  const result = await selectRelevantRecallItems({
    query: 'sensitive query text',
    items: [
      item('c-a', 'Postgres is used.'),
      item('c-b', 'UI preference.'),
    ],
    judge: async () => ({
      selected_ids: ['c-a'],
      reason: 'Directly useful.',
    }),
    clockMs: () => ticks.shift(),
  });

  assert.deepEqual(result.telemetry, {
    policy_version: RECALL_RELEVANCE_POLICY_VERSION,
    candidate_count: 2,
    selected_count: 1,
    judge_called: true,
    duration_ms: 37,
    failed: false,
  });
  assert.equal(JSON.stringify(result.telemetry).includes('sensitive query text'), false);
});

test('selector telemetry records zero-cost empty-candidate short circuit', async () => {
  let clockCalls = 0;
  const result = await selectRelevantRecallItems({
    query: 'database',
    items: [],
    judge: async () => { throw new Error('must not run'); },
    clockMs: () => { clockCalls += 1; return 1000; },
  });

  assert.equal(clockCalls, 0);
  assert.deepEqual(result.telemetry, {
    policy_version: RECALL_RELEVANCE_POLICY_VERSION,
    candidate_count: 0,
    selected_count: 0,
    judge_called: false,
    duration_ms: 0,
    failed: false,
  });
});
