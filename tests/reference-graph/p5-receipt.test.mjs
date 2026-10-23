import assert from 'node:assert/strict';
import test from 'node:test';

const binding = {
  purpose: 'agent-hub-reference-graph',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
};
const gitSha = '5'.repeat(40);
const verificationAt = '2026-10-23T12:30:00.000Z';
const referenceTime = '2026-10-23T12:00:00.000Z';

function selectorContract(overrides = {}) {
  return {
    verified: true,
    fresh_pool_count: 275,
    case_count: 24,
    full_limit_case_count: 24,
    cases_with_coverage_gaps: 0,
    ...overrides,
  };
}

function healthyControl(overrides = {}) {
  return {
    healthy: true,
    fresh_pool_count: 275,
    case_count: 24,
    full_limit_case_count: 24,
    cases_with_coverage_gaps: 0,
    blockers: [],
    ...overrides,
  };
}

function completeCoverage(overrides = {}) {
  return {
    eligible_chunk_count: 275,
    compatible_count: 275,
    missing_count: 0,
    text_hash_mismatch_count: 0,
    coverage_rate: 1,
    ...overrides,
  };
}

function availableEvaluation(cutoverReady = true) {
  return {
    status: 'available',
    summary: {
      cutover_ready: cutoverReady,
      blockers: cutoverReady ? [] : ['average overlap below threshold'],
    },
  };
}

async function successfulReceipt() {
  const { createP5Receipt, recordP5Phase } = await import('../../reference-graph/p5-receipt.mjs');
  let receipt = createP5Receipt({ binding, gitSha, verificationAt, referenceTime });
  for (const phase of ['preflight', 'selector', 'embeddings', 'shadow']) {
    receipt = recordP5Phase(receipt, { phase, status: 'success' });
  }
  return receipt;
}

test('P5 receipt enforces ordered phases, terminal failure, and legacy production routing', async () => {
  const { createP5Receipt, recordP5Phase, P5_PHASES } = await import('../../reference-graph/p5-receipt.mjs');
  assert.deepEqual(P5_PHASES, ['preflight', 'selector', 'embeddings', 'shadow']);

  const receipt = createP5Receipt({ binding, gitSha, verificationAt, referenceTime });
  assert.equal(receipt.production_source, 'legacy-control');
  assert.equal(receipt.eligible_for_cutover_review, false);
  assert.throws(
    () => recordP5Phase(receipt, { phase: 'embeddings', status: 'success' }),
    /order|selector/i,
  );

  const failed = recordP5Phase(receipt, {
    phase: 'preflight',
    status: 'failed',
    detail: { reason: 'target mismatch' },
  });
  assert.throws(
    () => recordP5Phase(failed, { phase: 'preflight', status: 'success' }),
    /terminal|failure/i,
  );
  assert.throws(
    () => recordP5Phase(failed, { phase: 'selector', status: 'success' }),
    /blocked|failed/i,
  );
});

test('P5 receipt secret scan rejects credential-shaped fields and explicit secret values', async () => {
  const { createP5Receipt, assertSecretFreeP5Receipt } = await import('../../reference-graph/p5-receipt.mjs');
  const receipt = createP5Receipt({ binding, gitSha, verificationAt, referenceTime });
  assert.equal(assertSecretFreeP5Receipt(receipt, ['top-secret']), true);
  assert.throws(
    () => assertSecretFreeP5Receipt({ ...receipt, service_role_key: 'anything' }),
    /credential|secret/i,
  );
  assert.throws(
    () => assertSecretFreeP5Receipt({ ...receipt, note: 'contains top-secret value' }, ['top-secret']),
    /secret/i,
  );
});

test('unverified selector contract blocks P5 cutover review', async () => {
  const { finalizeP5Receipt } = await import('../../reference-graph/p5-receipt.mjs');
  const final = finalizeP5Receipt(await successfulReceipt(), {
    selectorContract: selectorContract({ verified: false }),
    currentControlHealth: healthyControl(),
    embeddingCoverage: completeCoverage(),
    evaluations: {
      semantic: availableEvaluation(),
      hybrid: availableEvaluation(),
    },
  });
  assert.equal(final.eligible_for_cutover_review, false);
  assert.match(final.blockers.join(' '), /selector/i);
});

test('unhealthy control and incomplete embeddings independently block P5 cutover review', async () => {
  const { finalizeP5Receipt } = await import('../../reference-graph/p5-receipt.mjs');

  const unhealthy = finalizeP5Receipt(await successfulReceipt(), {
    selectorContract: selectorContract(),
    currentControlHealth: healthyControl({ healthy: false, blockers: ['coverage gaps'] }),
    embeddingCoverage: completeCoverage(),
    evaluations: { semantic: availableEvaluation(), hybrid: availableEvaluation() },
  });
  assert.equal(unhealthy.eligible_for_cutover_review, false);
  assert.match(unhealthy.blockers.join(' '), /control/i);

  const incomplete = finalizeP5Receipt(await successfulReceipt(), {
    selectorContract: selectorContract(),
    currentControlHealth: healthyControl(),
    embeddingCoverage: completeCoverage({
      compatible_count: 274,
      missing_count: 1,
      coverage_rate: 274 / 275,
    }),
    evaluations: { semantic: availableEvaluation(), hybrid: availableEvaluation() },
  });
  assert.equal(incomplete.eligible_for_cutover_review, false);
  assert.match(incomplete.blockers.join(' '), /embedding|coverage|hash/i);
});

test('unavailable semantic or hybrid evidence and sub-threshold hybrid quality block review', async () => {
  const { finalizeP5Receipt } = await import('../../reference-graph/p5-receipt.mjs');

  for (const evaluations of [
    { semantic: { status: 'unavailable' }, hybrid: availableEvaluation() },
    { semantic: availableEvaluation(), hybrid: { status: 'unavailable' } },
    { semantic: availableEvaluation(), hybrid: availableEvaluation(false) },
  ]) {
    const final = finalizeP5Receipt(await successfulReceipt(), {
      selectorContract: selectorContract(),
      currentControlHealth: healthyControl(),
      embeddingCoverage: completeCoverage(),
      evaluations,
    });
    assert.equal(final.eligible_for_cutover_review, false);
    assert.match(final.blockers.join(' '), /semantic|hybrid|quality/i);
  }
});

test('fully green P5 evidence can become review-eligible without changing production source', async () => {
  const { finalizeP5Receipt } = await import('../../reference-graph/p5-receipt.mjs');
  const final = finalizeP5Receipt(await successfulReceipt(), {
    selectorContract: selectorContract(),
    currentControlHealth: healthyControl(),
    embeddingCoverage: completeCoverage(),
    evaluations: {
      lexical: availableEvaluation(false),
      semantic: availableEvaluation(false),
      hybrid: availableEvaluation(true),
    },
  });

  assert.equal(final.cutover_ready, true);
  assert.equal(final.eligible_for_cutover_review, true);
  assert.equal(final.production_source, 'legacy-control');
  assert.deepEqual(final.blockers, []);
  assert.equal('cutover_action' in final, false);
});
