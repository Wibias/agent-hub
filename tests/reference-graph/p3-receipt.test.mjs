import assert from 'node:assert/strict';
import test from 'node:test';

const binding = {
  purpose: 'agent-hub-reference-graph',
  project_ref: 'abcdefghijklmnopqrst',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
};
const verificationAt = '2026-10-23T02:00:00.000Z';

test('P3 receipt enforces ordered deployment phases and blocks progress after failure', async () => {
  const {
    P3_PHASES,
    createP3Receipt,
    recordP3Phase,
  } = await import('../../reference-graph/p3-receipt.mjs');

  assert.deepEqual(P3_PHASES, ['preflight', 'schema', 'import', 'embeddings', 'shadow']);
  const receipt = createP3Receipt({ binding, gitSha: 'a'.repeat(40), verificationAt });
  assert.equal(receipt.production_source, 'legacy-control');
  assert.equal(receipt.eligible_for_cutover_review, false);
  assert.throws(
    () => recordP3Phase(receipt, {
      phase: 'schema',
      status: 'success',
      detail: { migrations: ['001', '002', '003'] },
    }),
    /preflight|phase order/i,
  );

  const afterPreflight = recordP3Phase(receipt, {
    phase: 'preflight',
    status: 'success',
    detail: { bound: true },
  });
  const afterSchema = recordP3Phase(afterPreflight, {
    phase: 'schema',
    status: 'failed',
    detail: { reason: 'migration failed' },
  });
  assert.throws(
    () => recordP3Phase(afterSchema, {
      phase: 'import',
      status: 'success',
      detail: {},
    }),
    /failed|blocked/i,
  );
  assert.throws(
    () => recordP3Phase(afterSchema, {
      phase: 'schema',
      status: 'success',
      detail: { retry: true },
    }),
    /failed|terminal|already/i,
  );
  assert.throws(
    () => recordP3Phase(afterPreflight, {
      phase: 'schema',
      status: 'done',
      detail: {},
    }),
    /status/i,
  );
});

test('P3 receipt finalization can mark review eligibility without changing production source', async () => {
  const { createP3Receipt, finalizeP3Receipt } = await import('../../reference-graph/p3-receipt.mjs');

  const receipt = createP3Receipt({ binding, gitSha: 'b'.repeat(40), verificationAt });
  const finalized = finalizeP3Receipt(receipt, {
    evaluations: { lexical: { cutover_ready: true } },
    currentControlHealth: { healthy: false, fresh_pool_count: 2 },
    cutoverReady: true,
  });

  assert.equal(finalized.production_source, 'legacy-control');
  assert.equal(finalized.eligible_for_cutover_review, true);
  assert.equal(finalized.cutover_ready, true);
  assert.deepEqual(finalized.evaluations, { lexical: { cutover_ready: true } });
  assert.deepEqual(finalized.current_control_health, { healthy: false, fresh_pool_count: 2 });
});

test('P3 receipt secret scan rejects credential values and credential-shaped fields', async () => {
  const { assertSecretFreeReceipt } = await import('../../reference-graph/p3-receipt.mjs');

  assert.equal(assertSecretFreeReceipt({ target: binding, role: 'service_role' }), true);
  assert.throws(
    () => assertSecretFreeReceipt({ note: 'contains secret-value' }, ['secret-value']),
    /secret/i,
  );
  assert.throws(
    () => assertSecretFreeReceipt({ service_role_key: 'x' }),
    /secret|credential/i,
  );
  assert.throws(
    () => assertSecretFreeReceipt({ authorization: 'Bearer abc' }),
    /secret|credential|authorization/i,
  );
  assert.throws(
    () => assertSecretFreeReceipt({ database_password: 'x' }),
    /secret|credential|password/i,
  );
});
