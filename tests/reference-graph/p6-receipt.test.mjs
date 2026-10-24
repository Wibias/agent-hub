import assert from 'node:assert/strict';
import test from 'node:test';

const binding = {
  purpose: 'agent-hub-reference-graph',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
};
const baseSha = 'fd904355c7d62ad716766eab3bfc41539f5ed18a';
const gitSha = '6'.repeat(40);
const verificationAt = '2026-10-23T16:30:00.000Z';
const referenceTime = '2026-10-23T12:00:00.000Z';

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

function evaluation(cutoverReady = true) {
  return {
    status: 'available',
    summary: {
      case_count: 24,
      comparable_case_count: 24,
      average_overlap_at_k: cutoverReady ? 0.7 : 0.6,
      legacy_top1_retention_rate: 0.75,
      graph_empty_rate: 0,
      average_exact_surface_rate: 0.8,
      average_exact_platform_rate: 0.9,
      cutover_ready: cutoverReady,
      blockers: cutoverReady ? [] : ['average overlap below threshold'],
    },
  };
}

async function successfulReceipt() {
  const { createP6Receipt, recordP6Phase } = await import('../../reference-graph/p6-receipt.mjs');
  let receipt = createP6Receipt({ binding, gitSha, verificationAt, referenceTime, baseSha });
  for (const phase of ['preflight', 'migration', 'embeddings', 'shadow']) {
    receipt = recordP6Phase(receipt, { phase, status: 'success' });
  }
  return receipt;
}

const migration = {
  file: 'reference-graph/schema/006_reference_graph_retrieval_quality.sql',
  status: 'applied',
  sha256: 'a'.repeat(64),
};

const p5Baseline = {
  status: 'available',
  summary: {
    average_overlap_at_k: 0.59375,
    legacy_top1_retention_rate: 0.75,
  },
};

test('P6 receipt binds P5 base, implementation SHA, target, phases, and unchanged gates', async () => {
  const { createP6Receipt, recordP6Phase, P6_PHASES } = await import('../../reference-graph/p6-receipt.mjs');
  assert.deepEqual(P6_PHASES, ['preflight', 'migration', 'embeddings', 'shadow']);

  const receipt = createP6Receipt({ binding, gitSha, verificationAt, referenceTime, baseSha });
  assert.equal(receipt.schema_version, 'reference-graph.p6-receipt.v1');
  assert.equal(receipt.base_sha, baseSha);
  assert.equal(receipt.git_sha, gitSha);
  assert.equal(receipt.target.project_ref, 'vrznfnxzlxaavpqbzbzd');
  assert.equal(receipt.production_source, 'legacy-control');
  assert.deepEqual(receipt.quality_thresholds, {
    min_cases: 20,
    min_comparable_cases: 20,
    min_average_overlap: 0.65,
    min_top1_retention: 0.75,
    max_empty_rate: 0.05,
    min_exact_surface_rate: 0.7,
    min_exact_platform_rate: 0.8,
  });

  assert.throws(
    () => recordP6Phase(receipt, { phase: 'embeddings', status: 'success' }),
    /order|migration/i,
  );
  const failed = recordP6Phase(receipt, { phase: 'preflight', status: 'failed' });
  assert.throws(
    () => recordP6Phase(failed, { phase: 'preflight', status: 'success' }),
    /terminal|failure/i,
  );
});

test('P6 receipt secret scan rejects credential fields and explicit secret material', async () => {
  const { createP6Receipt, assertSecretFreeP6Receipt } = await import('../../reference-graph/p6-receipt.mjs');
  const receipt = createP6Receipt({ binding, gitSha, verificationAt, referenceTime, baseSha });
  assert.equal(assertSecretFreeP6Receipt(receipt, ['top-secret']), true);
  assert.throws(
    () => assertSecretFreeP6Receipt({ ...receipt, service_role_key: 'anything' }),
    /credential|secret/i,
  );
  assert.throws(
    () => assertSecretFreeP6Receipt({ ...receipt, note: 'top-secret' }, ['top-secret']),
    /secret/i,
  );
});

test('P6 current control and exact embedding completeness are hard review gates', async () => {
  const { finalizeP6Receipt } = await import('../../reference-graph/p6-receipt.mjs');
  const base = await successfulReceipt();

  const unhealthy = finalizeP6Receipt(base, {
    currentControlHealth: healthyControl({ healthy: false, blockers: ['coverage gap'] }),
    embeddingCoverage: completeCoverage(),
    p5Baseline,
    evaluations: { lexical: evaluation(), semantic: evaluation(), hybrid: evaluation() },
    migration,
  });
  assert.equal(unhealthy.eligible_for_cutover_review, false);
  assert.match(unhealthy.blockers.join(' '), /control/i);

  const incomplete = finalizeP6Receipt(base, {
    currentControlHealth: healthyControl(),
    embeddingCoverage: completeCoverage({ compatible_count: 274, missing_count: 1, coverage_rate: 274 / 275 }),
    p5Baseline,
    evaluations: { lexical: evaluation(), semantic: evaluation(), hybrid: evaluation() },
    migration,
  });
  assert.equal(incomplete.eligible_for_cutover_review, false);
  assert.match(incomplete.blockers.join(' '), /embedding|coverage|hash/i);
});

test('P6 review eligibility requires applied migration, baseline, available modes, and green guarded hybrid', async () => {
  const { finalizeP6Receipt } = await import('../../reference-graph/p6-receipt.mjs');
  const base = await successfulReceipt();

  for (const patch of [
    { migration: { ...migration, status: 'planned' } },
    { p5Baseline: null },
    { evaluations: { lexical: { status: 'unavailable' }, semantic: evaluation(), hybrid: evaluation() } },
    { evaluations: { lexical: evaluation(), semantic: { status: 'unavailable' }, hybrid: evaluation() } },
    { evaluations: { lexical: evaluation(), semantic: evaluation(), hybrid: evaluation(false) } },
  ]) {
    const final = finalizeP6Receipt(base, {
      currentControlHealth: healthyControl(),
      embeddingCoverage: completeCoverage(),
      p5Baseline,
      evaluations: { lexical: evaluation(), semantic: evaluation(), hybrid: evaluation() },
      migration,
      ...patch,
    });
    assert.equal(final.eligible_for_cutover_review, false);
    assert.ok(final.blockers.length > 0);
  }
});

test('green guarded hybrid may become review eligible without performing cutover', async () => {
  const { finalizeP6Receipt } = await import('../../reference-graph/p6-receipt.mjs');
  const final = finalizeP6Receipt(await successfulReceipt(), {
    currentControlHealth: healthyControl(),
    embeddingCoverage: completeCoverage(),
    p5Baseline,
    evaluations: {
      lexical: evaluation(false),
      semantic: evaluation(false),
      hybrid: evaluation(true),
    },
    migration,
  });

  assert.equal(final.cutover_ready, true);
  assert.equal(final.eligible_for_cutover_review, true);
  assert.equal(final.production_source, 'legacy-control');
  assert.deepEqual(final.blockers, []);
  assert.equal('cutover_action' in final, false);
  assert.deepEqual(final.migration, migration);
  assert.deepEqual(final.p5_baseline, p5Baseline);
});
