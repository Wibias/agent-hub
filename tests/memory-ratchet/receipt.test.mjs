import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateVerdict,
  buildReceipt,
  summarizeCandidate,
} from './receipt.mjs';
import { SYNTHETIC_SECRET } from './runner.mjs';

const run = {
  case_id: 'M11',
  fixture_revision: 'fixture-rev',
  candidate: { name: 'example', version: '1.0.0', source_revision: 'abc123' },
  adapter_revision: 'adapter123',
  network_required: false,
  raw_recall: { text: `leak ${SYNTHETIC_SECRET}`, items: [] },
  metrics: {
    ingest_latency_ms: 2,
    recall_latency_ms: 3,
    recall_payload_bytes: 99,
    memory_items_returned: 0,
  },
};

test('aggregateVerdict fails before blocked and passes only when every assertion passes', () => {
  assert.equal(aggregateVerdict([{ status: 'pass' }, { status: 'pass' }]), 'pass');
  assert.equal(aggregateVerdict([{ status: 'pass' }, { status: 'blocked' }]), 'blocked');
  assert.equal(aggregateVerdict([{ status: 'blocked' }, { status: 'fail' }]), 'fail');
  assert.throws(() => aggregateVerdict([]), /at least one assertion/i);
});

test('buildReceipt derives verdict and redacts the synthetic secret from durable evidence', () => {
  const receipt = buildReceipt(run, {
    mode: 'core',
    assertions: [
      { id: 'M11.recall', status: 'fail', evidence: [`candidate returned ${SYNTHETIC_SECRET}`] },
    ],
    configuration: { llm_model: null, embedding_model: null, reranker_model: null, seed: null },
    metrics: {
      persisted_bytes: 120,
      llm_calls: 0,
      embedding_calls: 0,
      reranker_calls: 0,
      process_rss_peak_bytes: null,
      background_services: [],
    },
    raw_artifacts: ['artifacts/m11.json'],
  });

  assert.equal(receipt.verdict, 'fail');
  assert.equal(receipt.case_id, 'M11');
  assert.equal(receipt.configuration.network_required, false);
  assert.equal(receipt.metrics.recall_payload_bytes, 99);
  assert.equal(receipt.redactions, 1);
  assert.doesNotMatch(JSON.stringify(receipt), /sk-test-MEMORYRATCHET-/);
  assert.match(receipt.assertions[0].evidence[0], /REDACTED_SYNTHETIC_SECRET/);
});

test('candidate summary rejects any non-pass hard gate even when the numeric score is high', async () => {
  const receipts = Array.from({ length: 15 }, (_, index) => ({
    case_id: `M${String(index + 1).padStart(2, '0')}`,
    verdict: 'pass',
  }));
  receipts[10].verdict = 'blocked';

  const summary = await summarizeCandidate(receipts);
  assert.equal(summary.eligible, false);
  assert.equal(summary.score, 92);
  assert.deepEqual(summary.hard_gate_non_pass, [{ case_id: 'M11', verdict: 'blocked' }]);
});
