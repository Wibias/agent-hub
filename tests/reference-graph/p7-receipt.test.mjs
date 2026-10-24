import assert from 'node:assert/strict';
import test from 'node:test';

const binding = {
  purpose: 'agent-hub-reference-graph',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
};
const baseSha = '0dc105ef4a1ea3f9b6512598a4f5996e2be95c5f';
const gitSha = '7'.repeat(40);
const verificationAt = '2026-10-23T18:45:00.000Z';
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

function identityEvidence(overrides = {}) {
  const snapshot = {
    source_count: 576,
    asset_count: 600,
    current_asset_count: 600,
    chunk_count: 600,
    embedding_count: 600,
    fresh_eligible_count: 275,
    source_ids_sha256: '1'.repeat(64),
    asset_ids_sha256: '2'.repeat(64),
    chunk_ids_sha256: '3'.repeat(64),
    asset_content_hashes_sha256: '4'.repeat(64),
    chunk_text_hashes_sha256: '5'.repeat(64),
  };
  return {
    status: 'verified',
    import_runs: 2,
    unchanged: true,
    metadata_complete_count: 600,
    before: snapshot,
    after: { ...snapshot },
    ...overrides,
  };
}

function candidatePool(overrides = {}) {
  return {
    status: 'available',
    eligible_count: 275,
    complete_metadata_count: 275,
    unique_legacy_id_count: 275,
    ...overrides,
  };
}

function evaluation(overrides = {}) {
  return {
    status: 'available',
    summary: {
      case_count: 24,
      comparable_case_count: 24,
      average_overlap_at_k: 1,
      legacy_top1_retention_rate: 1,
      graph_empty_rate: 0,
      average_exact_surface_rate: 1,
      average_exact_platform_rate: 1,
      cutover_ready: true,
      blockers: [],
      ...overrides,
    },
  };
}

const migration = {
  file: 'reference-graph/schema/007_reference_graph_lexical_parity.sql',
  status: 'applied',
  sha256: 'a'.repeat(64),
};

async function successfulReceipt() {
  const { createP7Receipt, recordP7Phase } = await import('../../reference-graph/p7-receipt.mjs');
  let receipt = createP7Receipt({ binding, gitSha, verificationAt, referenceTime, baseSha });
  for (const phase of ['preflight', 'migration', 'reimport', 'shadow']) {
    receipt = recordP7Phase(receipt, { phase, status: 'success' });
  }
  return receipt;
}

test('P7 receipt binds P6 base, implementation SHA, target, ordered phases, and unchanged gates', async () => {
  const { createP7Receipt, recordP7Phase, P7_PHASES } = await import('../../reference-graph/p7-receipt.mjs');
  assert.deepEqual(P7_PHASES, ['preflight', 'migration', 'reimport', 'shadow']);

  const receipt = createP7Receipt({ binding, gitSha, verificationAt, referenceTime, baseSha });
  assert.equal(receipt.schema_version, 'reference-graph.p7-receipt.v1');
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
    () => recordP7Phase(receipt, { phase: 'reimport', status: 'success' }),
    /order|migration/i,
  );
  const failed = recordP7Phase(receipt, { phase: 'preflight', status: 'failed' });
  assert.throws(
    () => recordP7Phase(failed, { phase: 'preflight', status: 'success' }),
    /terminal|failure/i,
  );
});

test('P7 receipt secret scan rejects credential-shaped fields and explicit secret material', async () => {
  const { createP7Receipt, assertSecretFreeP7Receipt } = await import('../../reference-graph/p7-receipt.mjs');
  const receipt = createP7Receipt({ binding, gitSha, verificationAt, referenceTime, baseSha });
  assert.equal(assertSecretFreeP7Receipt(receipt, ['top-secret']), true);
  assert.throws(
    () => assertSecretFreeP7Receipt({ ...receipt, service_role_key: 'anything' }),
    /credential|secret/i,
  );
  assert.throws(
    () => assertSecretFreeP7Receipt({ ...receipt, note: 'top-secret' }, ['top-secret']),
    /secret/i,
  );
});

test('P7 identity, embedding, candidate-pool, and control structure are hard review gates', async () => {
  const { finalizeP7Receipt } = await import('../../reference-graph/p7-receipt.mjs');
  const base = await successfulReceipt();
  const common = {
    currentControlHealth: healthyControl(),
    identityEvidence: identityEvidence(),
    embeddingCoverage: completeCoverage(),
    candidatePool: candidatePool(),
    evaluation: evaluation(),
    migration,
  };

  for (const patch of [
    { currentControlHealth: healthyControl({ case_count: 23 }) },
    { identityEvidence: identityEvidence({ unchanged: false }) },
    { identityEvidence: identityEvidence({ import_runs: 1 }) },
    { identityEvidence: identityEvidence({ metadata_complete_count: 599 }) },
    { embeddingCoverage: completeCoverage({ compatible_count: 274, missing_count: 1, coverage_rate: 274 / 275 }) },
    { candidatePool: candidatePool({ eligible_count: 274 }) },
    { candidatePool: candidatePool({ unique_legacy_id_count: 274 }) },
  ]) {
    const final = finalizeP7Receipt(base, { ...common, ...patch });
    assert.equal(final.eligible_for_cutover_review, false);
    assert.ok(final.blockers.length > 0);
  }
});

test('P7 rejects identity snapshots whose counts or hashes changed across metadata re-import', async () => {
  const { finalizeP7Receipt } = await import('../../reference-graph/p7-receipt.mjs');
  const base = await successfulReceipt();
  const changed = identityEvidence();
  changed.after = {
    ...changed.after,
    asset_ids_sha256: '9'.repeat(64),
  };

  const final = finalizeP7Receipt(base, {
    currentControlHealth: healthyControl(),
    identityEvidence: changed,
    embeddingCoverage: completeCoverage(),
    candidatePool: candidatePool(),
    evaluation: evaluation(),
    migration,
  });

  assert.equal(final.eligible_for_cutover_review, false);
  assert.match(final.blockers.join(' '), /identity|re-import/i);
});

test('P7 requires migration 007 and a structurally green 24-case lexical evaluation', async () => {
  const { finalizeP7Receipt } = await import('../../reference-graph/p7-receipt.mjs');
  const base = await successfulReceipt();
  const common = {
    currentControlHealth: healthyControl(),
    identityEvidence: identityEvidence(),
    embeddingCoverage: completeCoverage(),
    candidatePool: candidatePool(),
    evaluation: evaluation(),
    migration,
  };

  for (const patch of [
    { migration: { ...migration, status: 'planned' } },
    { evaluation: evaluation({ comparable_case_count: 19 }) },
    { evaluation: evaluation({ average_overlap_at_k: 0.64, cutover_ready: false, blockers: ['average overlap below threshold'] }) },
    { evaluation: evaluation({ legacy_top1_retention_rate: 0.74, cutover_ready: false, blockers: ['legacy top-1 retention below threshold'] }) },
    { evaluation: evaluation({ graph_empty_rate: 0.06, cutover_ready: false, blockers: ['graph empty rate above threshold'] }) },
    { evaluation: evaluation({ average_exact_surface_rate: 0.69, cutover_ready: false, blockers: ['exact surface rate below threshold'] }) },
    { evaluation: evaluation({ average_exact_platform_rate: 0.79, cutover_ready: false, blockers: ['exact platform rate below threshold'] }) },
  ]) {
    const final = finalizeP7Receipt(base, { ...common, ...patch });
    assert.equal(final.eligible_for_cutover_review, false);
    assert.ok(final.blockers.length > 0);
  }
});

test('fully green P7 parity evidence may become review eligible but never performs cutover', async () => {
  const { finalizeP7Receipt } = await import('../../reference-graph/p7-receipt.mjs');
  const final = finalizeP7Receipt(await successfulReceipt(), {
    currentControlHealth: healthyControl(),
    identityEvidence: identityEvidence(),
    embeddingCoverage: completeCoverage(),
    candidatePool: candidatePool(),
    evaluation: evaluation(),
    migration,
  });

  assert.equal(final.cutover_ready, true);
  assert.equal(final.eligible_for_cutover_review, true);
  assert.equal(final.production_source, 'legacy-control');
  assert.deepEqual(final.blockers, []);
  assert.equal('cutover_action' in final, false);
  assert.equal('cutover_performed' in final, false);
});
