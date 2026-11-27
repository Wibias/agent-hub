import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('human quality review packet is complete, synthetic and unvalidated', async () => {
  const packet = JSON.parse(await readFile(
    new URL('../../docs/memory-quality-review-2026-11-27.json', import.meta.url),
    'utf8',
  ));
  assert.equal(packet.datasetVersion, 'memory-quality-review-2026-11-27');
  assert.match(packet.privacy, /synthetic/i);
  assert.equal(packet.humanValidated, false);
  assert.equal(packet.cases.length, 20);
  assert.equal(new Set(packet.cases.map((item) => item.id)).size, 20);
  for (const item of packet.cases) {
    assert.ok(item.id && item.category && item.source && item.expected);
  }
  assert.equal(new Set(packet.cases.map((item) => item.category)).size >= 6, true);
});
