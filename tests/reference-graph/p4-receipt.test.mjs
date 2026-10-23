import assert from 'node:assert/strict';
import test from 'node:test';

const binding = {
  purpose: 'agent-hub-reference-graph',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
};
const gitSha = '1'.repeat(40);
const verificationAt = '2026-10-23T12:00:00.000Z';

function completeRevalidation(overrides = {}) {
  return {
    target_count: 598,
    terminal_decision_count: 598,
    confirm_count: 590,
    stale_count: 6,
    archive_count: 2,
    complete: true,
    ...overrides,
  };
}

function healthyControl(overrides = {}) {
  return { healthy: true, fresh_pool_count: 590, blockers: [], ...overrides };
}

function completeCoverage(overrides = {}) {
  return {
    eligible_chunk_count: 590,
    compatible_count: 590,
    missing_count: 0,
    text_hash_mismatch_count: 0,
    coverage_rate: 1,
    ...overrides,
  };
}

function greenHybrid(overrides = {}) {
  return {
    status: 'available',
    summary: { cutover_ready: true, blockers: [] },
    ...overrides,
  };
}

async function makeSuccessfulReceipt() {
  const { createP4Receipt, recordP4Phase } = await import('../../reference-graph/p4-receipt.mjs');
  let receipt = createP4Receipt({ binding, gitSha, verificationAt });
  for (const phase of ['preflight', 'revalidation', 'import', 'embeddings', 'shadow']) {
    receipt = recordP4Phase(receipt, { phase, status: 'success' });
  }
  return receipt;
}

test('P4 receipt enforces phase order and terminal failure semantics', async () => {
  const { createP4Receipt, recordP4Phase, P4_PHASES } = await import('../../reference-graph/p4-receipt.mjs');
  assert.deepEqual(P4_PHASES, ['preflight', 'revalidation', 'import', 'embeddings', 'shadow']);
  const receipt = createP4Receipt({ binding, gitSha, verificationAt });
  assert.equal(receipt.production_source, 'legacy-control');
  assert.equal(receipt.cutover_ready, false);
  assert.throws(() => recordP4Phase(receipt, { phase: 'import', status: 'success' }), /order|revalidation/i);

  const failed = recordP4Phase(receipt, { phase: 'preflight', status: 'failed', detail: { reason: 'target mismatch' } });
  assert.throws(() => recordP4Phase(failed, { phase: 'preflight', status: 'success' }), /terminal|failure/i);
  assert.throws(() => recordP4Phase(failed, { phase: 'revalidation', status: 'success' }), /blocked|failed/i);
});

test('P4 receipt secret scan rejects credential fields and explicit secret values', async () => {
  const { createP4Receipt, assertSecretFreeP4Receipt } = await import('../../reference-graph/p4-receipt.mjs');
  const receipt = createP4Receipt({ binding, gitSha, verificationAt });
  assert.equal(assertSecretFreeP4Receipt(receipt, ['top-secret']), true);
  assert.throws(
    () => assertSecretFreeP4Receipt({ ...receipt, service_role_key: 'anything' }),
    /credential|secret/i,
  );
  assert.throws(
    () => assertSecretFreeP4Receipt({ ...receipt, note: 'contains top-secret value' }, ['top-secret']),
    /secret/i,
  );
});

test('partial revalidation forces no-cutover', async () => {
  const { finalizeP4Receipt } = await import('../../reference-graph/p4-receipt.mjs');
  const receipt = await makeSuccessfulReceipt();
  const final = finalizeP4Receipt(receipt, {
    revalidation: completeRevalidation({ terminal_decision_count: 597, complete: false }),
    currentControlHealth: healthyControl(),
    embeddingCoverage: completeCoverage(),
    evaluations: { hybrid: greenHybrid() },
  });
  assert.equal(final.cutover_ready, false);
  assert.equal(final.eligible_for_cutover_review, false);
  assert.match(final.blockers.join(' '), /revalidation/i);
});

test('unhealthy current control forces no-cutover', async () => {
  const { finalizeP4Receipt } = await import('../../reference-graph/p4-receipt.mjs');
  const final = finalizeP4Receipt(await makeSuccessfulReceipt(), {
    revalidation: completeRevalidation(),
    currentControlHealth: healthyControl({ healthy: false, blockers: ['coverage gaps'] }),
    embeddingCoverage: completeCoverage(),
    evaluations: { hybrid: greenHybrid() },
  });
  assert.equal(final.cutover_ready, false);
  assert.match(final.blockers.join(' '), /control/i);
});

test('incomplete or hash-mismatched embeddings force no-cutover', async () => {
  const { finalizeP4Receipt } = await import('../../reference-graph/p4-receipt.mjs');
  for (const coverage of [
    completeCoverage({ compatible_count: 589, missing_count: 1, coverage_rate: 589 / 590 }),
    completeCoverage({ compatible_count: 589, text_hash_mismatch_count: 1, coverage_rate: 589 / 590 }),
  ]) {
    const final = finalizeP4Receipt(await makeSuccessfulReceipt(), {
      revalidation: completeRevalidation(),
      currentControlHealth: healthyControl(),
      embeddingCoverage: coverage,
      evaluations: { hybrid: greenHybrid() },
    });
    assert.equal(final.cutover_ready, false);
    assert.match(final.blockers.join(' '), /embedding|hash|coverage/i);
  }
});

test('missing live hybrid evidence forces no-cutover', async () => {
  const { finalizeP4Receipt } = await import('../../reference-graph/p4-receipt.mjs');
  const final = finalizeP4Receipt(await makeSuccessfulReceipt(), {
    revalidation: completeRevalidation(),
    currentControlHealth: healthyControl(),
    embeddingCoverage: completeCoverage(),
    evaluations: { hybrid: { status: 'unavailable', summary: null } },
  });
  assert.equal(final.cutover_ready, false);
  assert.match(final.blockers.join(' '), /hybrid/i);
});

test('green P4 evidence can become cutover-review eligible without changing production routing', async () => {
  const { finalizeP4Receipt } = await import('../../reference-graph/p4-receipt.mjs');
  const final = finalizeP4Receipt(await makeSuccessfulReceipt(), {
    revalidation: completeRevalidation(),
    currentControlHealth: healthyControl(),
    embeddingCoverage: completeCoverage(),
    evaluations: {
      lexical: { status: 'available', summary: { cutover_ready: false } },
      semantic: { status: 'available', summary: { cutover_ready: false } },
      hybrid: greenHybrid(),
    },
  });
  assert.equal(final.cutover_ready, true);
  assert.equal(final.eligible_for_cutover_review, true);
  assert.equal(final.production_source, 'legacy-control');
  assert.deepEqual(final.blockers, []);
});
