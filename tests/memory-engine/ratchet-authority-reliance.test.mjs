import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRecallCase } from '../memory-ratchet/adapter-contract.mjs';
import { createReferenceMemoryAdapter } from '../memory-ratchet/reference-adapter.mjs';

async function runCase(caseId) {
  const root = await mkdtemp(join(tmpdir(), `memory-engine-${caseId.toLowerCase()}-`));
  return runRecallCase(createReferenceMemoryAdapter(), caseId, root);
}

test('M07 keeps contradiction visible but answer reliance selects repository policy', async () => {
  const result = await runCase('M07');
  const recall = result.raw_recall;

  assert.equal(recall.conflicts.length, 1);
  assert.ok(recall.items.some((item) => /retried 3 times/i.test(item.evidence.content_redacted)));
  assert.ok(recall.items.some((item) => /retried 5 times/i.test(item.evidence.content_redacted)));

  assert.deepEqual(
    recall.reliance.answer.selected.map((item) => item.evidence.content_redacted),
    ['The repository runtime policy says failed background jobs are retried 3 times.'],
  );
  assert.equal(
    recall.reliance.answer.blocked.some(
      (entry) => /retried 5 times/i.test(entry.item.evidence.content_redacted),
    ),
    true,
  );
});

test('M10 keeps vendor text searchable but refuses it as trusted project policy', async () => {
  const result = await runCase('M10');
  const recall = result.raw_recall;

  assert.equal(recall.items.length, 1);
  assert.match(recall.items[0].evidence.content_redacted, /vendor guide/i);
  assert.equal(recall.items[0].evidence.authority_class, 'external_untrusted');

  assert.deepEqual(recall.reliance.project_policy.selected, []);
  assert.equal(recall.reliance.project_policy.blocked.length, 1);
  assert.equal(
    recall.reliance.project_policy.blocked[0].reason,
    'authority_not_allowed_for_project_policy',
  );
});
