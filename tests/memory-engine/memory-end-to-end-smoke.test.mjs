import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runMemoryEndToEndSmoke,
} from '../../scripts/eval-memory-end-to-end-smoke.mjs';

test('deterministic memory E2E smoke covers the full candidate lifecycle', async () => {
  const result = await runMemoryEndToEndSmoke({
    providerBacked: false,
    reasoningEffort: 'medium',
  });

  assert.equal(result.pass, true);
  assert.equal(result.mode, 'deterministic');
  assert.equal(result.model, 'deterministic');
  assert.deepEqual(result.policies, {
    capture: 'capture-v1',
    importance: 'importance-v2',
    relation: 'relation-v1',
    promotion: 'promotion-v1',
    confirmation: 'confirmation-v2',
  });

  assert.ok(result.checks.length >= 25);
  assert.deepEqual(
    result.checks.filter((item) => !item.pass),
    [],
  );

  const ids = new Set(result.checks.map((item) => item.id));
  for (const required of [
    'durable.promoted',
    'durable.memory_list',
    'durable.recall',
    'ignore.ignored',
    'ignore.no_claim',
    'keep.review_backlog',
    'keep.visible',
    'keep.confirmed',
    'ambiguous.needs_confirmation',
    'ambiguous.visible',
    'same.superseded_candidate',
    'same.no_duplicate_claim',
    'update.promoted',
    'update.old_superseded',
    'update.new_active',
    'update.memory_list_current_only',
    'update.recall_current_only',
    'contradict.baseline_promoted',
    'contradict.promoted',
    'contradict.both_active',
    'contradict.open_conflict',
    'contradict.recall_conflict_visible',
    'final.automatic_queues_empty',
    'final.list_excludes_non_durable',
  ]) {
    assert.ok(ids.has(required), required);
  }

  assert.deepEqual(result.judge_calls, {
    importance: 8,
    relation: 4,
  });

  assert.equal(result.final.active_claims, 4);
  assert.equal(result.final.scoped_claims, 5);
  assert.equal(result.final.open_conflicts, 1);

  const statusByValue = new Map(
    result.final.candidates.map((item) => [item.value, item]),
  );

  assert.equal(
    statusByValue.get(
      "We will use port 9229 for today's debugger session.",
    )?.status,
    'ignored',
  );
  assert.equal(
    statusByValue.get(
      'We decided to keep that private for future releases.',
    )?.status,
    'needs_confirmation',
  );
  assert.equal(
    statusByValue.get(
      'We decided to keep Postgres as the production database.',
    )?.status,
    'superseded',
  );
  assert.equal(
    statusByValue.get(
      'Correction: the production database now uses MySQL instead of Postgres.',
    )?.relation,
    'update',
  );
  assert.equal(
    statusByValue.get(
      'We must require one approval for production deployments.',
    )?.relation,
    'contradict',
  );
});
