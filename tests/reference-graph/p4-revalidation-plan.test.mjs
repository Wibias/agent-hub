import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function row(overrides = {}) {
  return {
    id: 'ref-reviewed-old',
    reviewStatus: 'reviewed',
    lastVerifiedAt: '2026-06-01',
    ttlDays: 90,
    ...overrides,
  };
}

const NOW = new Date('2026-10-23T12:00:00.000Z');

async function loadPlanner() {
  return import('../../reference-graph/revalidation-plan.mjs');
}

test('full stale maintainable population enters target ids while fresh and non-maintainable records are separated', async () => {
  const { planP4RevalidationQueue } = await loadPlanner();
  const records = [
    row({ id: 'ref-reviewed-old' }),
    row({ id: 'ref-stale-old', reviewStatus: 'stale', lastVerifiedAt: '2026-08-01', ttlDays: 60 }),
    row({ id: 'ref-reviewed-fresh', lastVerifiedAt: '2026-10-20', ttlDays: 30 }),
    row({ id: 'ref-candidate-old', reviewStatus: 'candidate' }),
    row({ id: 'ref-archived-old', reviewStatus: 'archived' }),
  ];

  const plan = planP4RevalidationQueue({ records, currentNow: NOW, waveSize: 50 });

  assert.deepEqual(plan.target_ids, ['ref-stale-old', 'ref-reviewed-old']);
  assert.deepEqual(plan.already_fresh_ids, ['ref-reviewed-fresh']);
  assert.deepEqual(plan.excluded_ids, [
    { id: 'ref-archived-old', reason: 'archived' },
    { id: 'ref-candidate-old', reason: 'review-status:candidate' },
  ]);
  assert.deepEqual(plan.pending_ids, plan.target_ids);
  assert.deepEqual(plan.completed_ids, []);
  assert.deepEqual(plan.waves, [['ref-stale-old', 'ref-reviewed-old']]);
  assert.equal(plan.complete, false);
});

test('pending order is deterministic: stale review state, oldest verification, shortest ttl, then id', async () => {
  const { planP4RevalidationQueue } = await loadPlanner();
  const records = [
    row({ id: 'ref-reviewed-b', lastVerifiedAt: '2026-05-01', ttlDays: 90 }),
    row({ id: 'ref-stale-z', reviewStatus: 'stale', lastVerifiedAt: '2026-07-01', ttlDays: 30 }),
    row({ id: 'ref-stale-a', reviewStatus: 'stale', lastVerifiedAt: '2026-07-01', ttlDays: 30 }),
    row({ id: 'ref-reviewed-a', lastVerifiedAt: '2026-05-01', ttlDays: 60 }),
  ];

  const first = planP4RevalidationQueue({ records, currentNow: NOW, waveSize: 2 });
  const second = planP4RevalidationQueue({ records: [...records].reverse(), currentNow: NOW, waveSize: 2 });

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.target_ids, [
    'ref-stale-a',
    'ref-stale-z',
    'ref-reviewed-a',
    'ref-reviewed-b',
  ]);
  assert.deepEqual(first.waves, [
    ['ref-stale-a', 'ref-stale-z'],
    ['ref-reviewed-a', 'ref-reviewed-b'],
  ]);
});

test('completed ids remain in the frozen target but disappear from pending and wave size changes only boundaries', async () => {
  const { planP4RevalidationQueue } = await loadPlanner();
  const records = [
    row({ id: 'ref-reviewed-a' }),
    row({ id: 'ref-reviewed-b', lastVerifiedAt: '2026-05-01' }),
    row({ id: 'ref-reviewed-c', lastVerifiedAt: '2026-04-01' }),
  ];

  const small = planP4RevalidationQueue({
    records,
    currentNow: NOW,
    completedIds: ['ref-reviewed-b'],
    waveSize: 1,
  });
  const large = planP4RevalidationQueue({
    records,
    currentNow: NOW,
    completedIds: ['ref-reviewed-b'],
    waveSize: 100,
  });

  assert.deepEqual(small.target_ids, large.target_ids);
  assert.deepEqual(small.completed_ids, ['ref-reviewed-b']);
  assert.equal(small.pending_ids.includes('ref-reviewed-b'), false);
  assert.deepEqual(small.pending_ids, large.pending_ids);
  assert.equal(small.waves.length, 2);
  assert.equal(large.waves.length, 1);

  const done = planP4RevalidationQueue({
    records,
    currentNow: NOW,
    completedIds: small.target_ids,
    waveSize: 50,
  });
  assert.deepEqual(done.pending_ids, []);
  assert.deepEqual(done.waves, []);
  assert.equal(done.complete, true);
});

test('planner is benchmark-independent in behavior and source dependencies', async () => {
  const { planP4RevalidationQueue } = await loadPlanner();
  const records = [row({ id: 'ref-reviewed-old' })];

  const normal = planP4RevalidationQueue({
    records,
    currentNow: NOW,
    waveSize: 50,
    cases: [{ job: 'original benchmark' }],
  });
  const mutated = planP4RevalidationQueue({
    records,
    currentNow: NOW,
    waveSize: 50,
    cases: [{ job: 'completely different benchmark fixture' }],
  });
  assert.deepEqual(normal, mutated);

  const source = readFileSync(
    new URL('../../reference-graph/revalidation-plan.mjs', import.meta.url),
    'utf8',
  );
  for (const forbidden of ['shadow-cases.json', 'shadow-eval.mjs', './retrieval.mjs', './live-shadow.mjs']) {
    assert.equal(source.includes(forbidden), false, `planner must not depend on ${forbidden}`);
  }
});

test('planner rejects invalid wave size and completed ids outside the frozen target', async () => {
  const { planP4RevalidationQueue } = await loadPlanner();
  const records = [row({ id: 'ref-reviewed-old' })];

  assert.throws(
    () => planP4RevalidationQueue({ records, currentNow: NOW, waveSize: 0 }),
    /waveSize/i,
  );
  assert.throws(
    () => planP4RevalidationQueue({ records, currentNow: NOW, completedIds: ['ref-unknown'] }),
    /completed|target|unknown/i,
  );
});
