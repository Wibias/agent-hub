import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createP15Receipt,
  finalizeP15Receipt,
} from '../../reference-graph/p15-receipt.mjs';

function initialReceipt() {
  return createP15Receipt({
    gitSha: '309f22813eedec583f2969bc45f2c91027fc60c5',
    verificationAt: '2026-10-24T02:32:06.000Z',
  });
}

function inertExecution(calls) {
  return {
    p13Evidence: {},
    enrollmentManifest: {},
    grant: {},
    readActivationState: async () => { calls.push('read'); return {}; },
    consumeGrantNonce: async () => { calls.push('consume'); return {}; },
    applyActivation: async () => { calls.push('apply'); return {}; },
    probeRuntime: async () => { calls.push('probe'); return {}; },
    rollbackActivation: async () => { calls.push('rollback'); return {}; },
    now: () => { calls.push('now'); return new Date('2026-10-24T02:32:06.000Z'); },
  };
}

test('P15 finalization rejects caller-forged terminal claims in the base receipt', async () => {
  const forged = {
    ...initialReceipt(),
    state: 'activated',
    grant_state: 'issued',
    grant_verified: true,
    grant_consumed: true,
    activation_authorized: true,
    activation_performed: true,
    production_source: 'reference-graph',
    external_blocker: null,
  };

  await assert.rejects(
    () => finalizeP15Receipt(forged, {}),
    /initial|receipt|blocked|exact|finalization/i,
  );
});

test('P15 finalization rejects frozen-anchor drift before touching execution callbacks', async () => {
  const calls = [];
  const drifted = {
    ...initialReceipt(),
    p14_evidence_head: '0'.repeat(40),
  };

  await assert.rejects(
    () => finalizeP15Receipt(drifted, { execution: inertExecution(calls) }),
    /initial|receipt|P14|anchor|exact/i,
  );
  assert.deepEqual(calls, []);
});

test('P15 finalization requires real execution artifacts and never treats an empty finalization as authoritative', async () => {
  await assert.rejects(
    () => finalizeP15Receipt(initialReceipt(), {}),
    /execution|finalization|exact|artifact/i,
  );
});
