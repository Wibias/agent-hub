import test from 'node:test';
import assert from 'node:assert/strict';

import { runCoreTrack } from './core-track.mjs';
import { SYNTHETIC_SECRET } from './runner.mjs';

function adapterFactory() {
  return {
    metadata: {
      candidate: { name: 'fake', version: '1', source_revision: 'abc' },
      adapter_revision: 'fake-v1',
      network_required: false,
    },
  };
}

test('core track continues after a case error and preserves all requested case ids', async () => {
  const seen = [];
  const report = await runCoreTrack({
    adapterFactory,
    caseIds: ['M01', 'M02', 'M03'],
    rootFactory: async (caseId) => `/tmp/${caseId}`,
    runCase: async (_adapter, caseId) => {
      seen.push(caseId);
      if (caseId === 'M02') throw new Error('candidate crashed');
      return { case_id: caseId, raw_recall: { items: [] } };
    },
  });

  assert.deepEqual(seen, ['M01', 'M02', 'M03']);
  assert.deepEqual(report.cases.map(({ case_id }) => case_id), ['M01', 'M02', 'M03']);
  assert.equal(report.cases[0].status, 'completed');
  assert.equal(report.cases[1].status, 'error');
  assert.match(report.cases[1].error.message, /candidate crashed/);
  assert.equal(report.cases[2].status, 'completed');
});

test('core track records secret leakage before redacting the durable report', async () => {
  const report = await runCoreTrack({
    adapterFactory,
    caseIds: ['M11'],
    rootFactory: async () => '/tmp/M11',
    runCase: async () => ({
      case_id: 'M11',
      raw_recall: {
        text: `candidate leaked ${SYNTHETIC_SECRET}`,
        items: [{ body: SYNTHETIC_SECRET }],
      },
    }),
  });

  const result = report.cases[0];
  assert.equal(result.secret_leaked, true);
  assert.doesNotMatch(JSON.stringify(report), /sk-test-MEMORYRATCHET-/);
  assert.match(JSON.stringify(report), /REDACTED_SYNTHETIC_SECRET/);
});

test('core track marks a clean M11 result as not leaked', async () => {
  const report = await runCoreTrack({
    adapterFactory,
    caseIds: ['M11'],
    rootFactory: async () => '/tmp/M11',
    runCase: async () => ({
      case_id: 'M11',
      raw_recall: { text: 'no credential here', items: [] },
    }),
  });

  assert.equal(report.cases[0].secret_leaked, false);
});
