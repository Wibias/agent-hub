import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRecallCase } from '../memory-ratchet/adapter-contract.mjs';
import { createReferenceMemoryAdapter } from '../memory-ratchet/reference-adapter.mjs';

test('M14 keeps bounded recall relevant under 2000 distractors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-m14-'));
  const result = await runRecallCase(createReferenceMemoryAdapter(), 'M14', root);

  const targetIndex = result.raw_recall.items.findIndex(
    (item) => item.claim.id === 'claim:EV-A-POSTGRES-DECISION',
  );

  assert.ok(targetIndex >= 0, 'target decision must be recalled');
  assert.ok(targetIndex < 5, 'target decision must appear in the top five');
  assert.ok(result.raw_recall.items.length <= 10, 'recall must return at most 10 items');
  assert.ok(result.metrics.memory_items_returned <= 10, 'runner must observe at most 10 memory items');
  assert.ok(
    result.metrics.recall_payload_bytes <= 16_384,
    `raw recall payload exceeded 16 KiB: ${result.metrics.recall_payload_bytes} bytes`,
  );
});
