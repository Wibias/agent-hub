import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertAdapterContract,
  runRecallCase,
} from './adapter-contract.mjs';
import { SYNTHETIC_SECRET } from './runner.mjs';

function recordingAdapter({ recallResult = { text: 'ok', items: [] } } = {}) {
  const calls = [];
  return {
    calls,
    metadata: {
      candidate: { name: 'fixture-adapter', version: '0.0.0', source_revision: 'fixture' },
      adapter_revision: 'fixture-adapter-v1',
      network_required: false,
    },
    async reset() { calls.push(['reset']); },
    async setup(context) { calls.push(['setup', context.case_id]); },
    async ingest(event) { calls.push(['ingest', event.id]); },
    async recall(request) { calls.push(['recall', request]); return recallResult; },
    async teardown() { calls.push(['teardown']); },
  };
}

test('adapter contract requires only neutral core operations for hard-gate execution', () => {
  const adapter = recordingAdapter();
  assert.doesNotThrow(() => assertAdapterContract(adapter));

  const broken = { ...adapter };
  delete broken.recall;
  assert.throws(() => assertAdapterContract(broken), /recall/);
});

test('runRecallCase resets, sets up, ingests in fixture order, recalls with scope, and tears down', async () => {
  const adapter = recordingAdapter({ recallResult: { text: 'Postgres', items: [{ content: 'Postgres' }] } });
  const root = await mkdtemp(join(tmpdir(), 'memory-ratchet-adapter-'));
  const result = await runRecallCase(adapter, 'M01', root);

  assert.equal(result.case_id, 'M01');
  assert.equal(result.raw_recall.text, 'Postgres');
  assert.equal(result.metrics.memory_items_returned, 1);
  assert.ok(result.metrics.ingest_latency_ms >= 0);
  assert.ok(result.metrics.recall_latency_ms >= 0);

  assert.deepEqual(adapter.calls[0], ['reset']);
  assert.deepEqual(adapter.calls[1], ['setup', 'M01']);
  assert.equal(adapter.calls[2][0], 'ingest');
  assert.equal(adapter.calls[2][1], 'EV-A-POSTGRES-DECISION');
  assert.equal(adapter.calls[3][0], 'recall');
  assert.equal(adapter.calls[3][1].project_id, 'mr-project-a');
  assert.equal(adapter.calls[3][1].branch, 'main');
  assert.match(adapter.calls[3][1].revision_sha, /^[0-9a-f]{40}$/);
  assert.equal(adapter.calls.at(-1)[0], 'teardown');
});

test('runner preserves unsafe raw recall for scoring and does not hide M11 leakage', async () => {
  const adapter = recordingAdapter({ recallResult: { text: `leaked ${SYNTHETIC_SECRET}`, items: [] } });
  const root = await mkdtemp(join(tmpdir(), 'memory-ratchet-secret-'));
  const result = await runRecallCase(adapter, 'M11', root);

  assert.match(result.raw_recall.text, /sk-test-MEMORYRATCHET-/);
});

test('teardown still runs when a candidate recall fails', async () => {
  const adapter = recordingAdapter();
  adapter.recall = async () => {
    adapter.calls.push(['recall-error']);
    throw new Error('candidate recall failed');
  };
  const root = await mkdtemp(join(tmpdir(), 'memory-ratchet-error-'));

  await assert.rejects(() => runRecallCase(adapter, 'M01', root), /candidate recall failed/);
  assert.equal(adapter.calls.at(-1)[0], 'teardown');
});
