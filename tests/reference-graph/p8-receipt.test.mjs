import assert from 'node:assert/strict';
import test from 'node:test';

import {
  P8_PHASES,
  assertSecretFreeP8Receipt,
  createP8Receipt,
  finalizeP8Receipt,
  recordP8Phase,
} from '../../reference-graph/p8-receipt.mjs';

const BINDING = {
  purpose: 'agent-hub-reference-graph',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
};
const BASE_SHA = '2ce02e43a54549b0ddc2d7d78e7fc0e56430fe8d';
const GIT_SHA = '1111111111111111111111111111111111111111';

function baseReceipt() {
  let receipt = createP8Receipt({
    binding: BINDING,
    gitSha: GIT_SHA,
    verificationAt: '2026-10-23T21:00:00.000Z',
    referenceTime: '2026-10-23T12:00:00.000Z',
    baseSha: BASE_SHA,
  });
  for (const phase of P8_PHASES) {
    receipt = recordP8Phase(receipt, {
      phase,
      status: 'success',
      detail: { verified: true },
    });
  }
  return receipt;
}

function p7Receipt(overrides = {}) {
  return {
    schema_version: 'reference-graph.p7-receipt.v1',
    base_sha: '6b1ed86a68ac485228596b9051bf76a7300eaccb',
    git_sha: 'e0f7ee73cf3700e3af3fefced0f446745f0e5ade',
    cutover_ready: true,
    eligible_for_cutover_review: true,
    production_source: 'legacy-control',
    blockers: [],
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

function completePool(overrides = {}) {
  return {
    status: 'available',
    eligible_count: 275,
    complete_metadata_count: 275,
    unique_legacy_id_count: 275,
    ...overrides,
  };
}

function exactReview(overrides = {}) {
  return {
    status: 'available',
    case_count: 24,
    exact_handoff_count: 24,
    mismatch_count: 0,
    pattern_exact_count: 24,
    hydration_failure_count: 0,
    ...overrides,
  };
}

test('P8 receipt binds final P7 base, implementation SHA, target, ordered phases, and review-only production semantics', () => {
  const receipt = baseReceipt();
  assert.equal(receipt.schema_version, 'reference-graph.p8-cutover-review.v1');
  assert.equal(receipt.base_sha, BASE_SHA);
  assert.equal(receipt.git_sha, GIT_SHA);
  assert.deepEqual(receipt.target, BINDING);
  assert.deepEqual(Object.keys(receipt.phases), P8_PHASES);
  assert.equal(receipt.production_source, 'legacy-control');
  assert.equal(receipt.activation_performed, false);
  assert.equal(receipt.quick_path_review_eligible, false);
  assert.equal(receipt.production_activation_ready, false);
});

test('P8 receipt enforces phase order and terminal failure', () => {
  let receipt = createP8Receipt({
    binding: BINDING,
    gitSha: GIT_SHA,
    verificationAt: '2026-10-23T21:00:00.000Z',
    referenceTime: '2026-10-23T12:00:00.000Z',
    baseSha: BASE_SHA,
  });
  assert.throws(
    () => recordP8Phase(receipt, { phase: 'live_review', status: 'success' }),
    /phase order/i,
  );
  receipt = recordP8Phase(receipt, { phase: 'preflight', status: 'failed', detail: { reason: 'blocked' } });
  assert.throws(
    () => recordP8Phase(receipt, { phase: 'offline_contract', status: 'success' }),
    /blocked by failed phase preflight/i,
  );
  assert.throws(
    () => recordP8Phase(receipt, { phase: 'preflight', status: 'success' }),
    /terminal after failure/i,
  );
});

test('P8 quick review eligibility requires structurally green P7, control, pool, offline, and live evidence', () => {
  const receipt = finalizeP8Receipt(baseReceipt(), {
    p7Receipt: p7Receipt(),
    currentControlHealth: healthyControl(),
    candidatePool: completePool(),
    offlineReview: exactReview(),
    liveReview: exactReview(),
  });

  assert.equal(receipt.quick_path_review_eligible, true);
  assert.equal(receipt.production_activation_ready, false);
  assert.equal(receipt.production_source, 'legacy-control');
  assert.equal(receipt.activation_performed, false);
  assert.deepEqual(receipt.profile_support, {
    quick: 'review-eligible',
    standard: 'legacy-only',
    deep: 'legacy-only',
  });
  assert.match(receipt.blockers.join('\n'), /service.?role/i);
});

test('P8 production activation remains false even if the caller supplies no external blockers', () => {
  const receipt = finalizeP8Receipt(baseReceipt(), {
    p7Receipt: p7Receipt(),
    currentControlHealth: healthyControl(),
    candidatePool: completePool(),
    offlineReview: exactReview(),
    liveReview: exactReview(),
    blockers: [],
  });
  assert.equal(receipt.quick_path_review_eligible, true);
  assert.equal(receipt.production_activation_ready, false);
  assert.equal(receipt.activation_performed, false);
  assert.equal(receipt.production_source, 'legacy-control');
});

test('P8 rejects incomplete current control and candidate-pool summaries even when booleans look green', () => {
  const badControl = finalizeP8Receipt(baseReceipt(), {
    p7Receipt: p7Receipt(),
    currentControlHealth: healthyControl({ full_limit_case_count: 23 }),
    candidatePool: completePool(),
    offlineReview: exactReview(),
    liveReview: exactReview(),
  });
  assert.equal(badControl.quick_path_review_eligible, false);
  assert.match(badControl.blockers.join('\n'), /control/i);

  const badPool = finalizeP8Receipt(baseReceipt(), {
    p7Receipt: p7Receipt(),
    currentControlHealth: healthyControl(),
    candidatePool: completePool({ unique_legacy_id_count: 274 }),
    offlineReview: exactReview(),
    liveReview: exactReview(),
  });
  assert.equal(badPool.quick_path_review_eligible, false);
  assert.match(badPool.blockers.join('\n'), /candidate pool/i);
});

test('P8 requires exact record and pattern handoff for all 24 cases', () => {
  for (const [field, value] of [
    ['exact_handoff_count', 23],
    ['mismatch_count', 1],
    ['pattern_exact_count', 23],
    ['hydration_failure_count', 1],
  ]) {
    const receipt = finalizeP8Receipt(baseReceipt(), {
      p7Receipt: p7Receipt(),
      currentControlHealth: healthyControl(),
      candidatePool: completePool(),
      offlineReview: exactReview({ [field]: value }),
      liveReview: exactReview(),
    });
    assert.equal(receipt.quick_path_review_eligible, false, `field ${field}`);
  }
});

test('P8 requires final P7 receipt to remain blocker-free and review-ready', () => {
  const receipt = finalizeP8Receipt(baseReceipt(), {
    p7Receipt: p7Receipt({ blockers: ['drift'] }),
    currentControlHealth: healthyControl(),
    candidatePool: completePool(),
    offlineReview: exactReview(),
    liveReview: exactReview(),
  });
  assert.equal(receipt.quick_path_review_eligible, false);
  assert.match(receipt.blockers.join('\n'), /P7/i);
});

test('P8 terminal phase failure prevents quick review eligibility', () => {
  let receipt = createP8Receipt({
    binding: BINDING,
    gitSha: GIT_SHA,
    verificationAt: '2026-10-23T21:00:00.000Z',
    referenceTime: '2026-10-23T12:00:00.000Z',
    baseSha: BASE_SHA,
  });
  receipt = recordP8Phase(receipt, { phase: 'preflight', status: 'success' });
  receipt = recordP8Phase(receipt, { phase: 'offline_contract', status: 'failed' });
  const finalized = finalizeP8Receipt(receipt, {
    p7Receipt: p7Receipt(),
    currentControlHealth: healthyControl(),
    candidatePool: completePool(),
    offlineReview: exactReview(),
    liveReview: exactReview(),
  });
  assert.equal(finalized.quick_path_review_eligible, false);
  assert.match(finalized.blockers.join('\n'), /phase offline_contract/i);
});

test('P8 receipt secret scan rejects credential-shaped fields and explicit secret material', () => {
  const receipt = baseReceipt();
  assert.equal(assertSecretFreeP8Receipt(receipt), true);
  assert.throws(
    () => assertSecretFreeP8Receipt({ ...receipt, service_role_key: 'secret' }),
    /credential-shaped/i,
  );
  assert.throws(
    () => assertSecretFreeP8Receipt({ ...receipt, note: 'contains-super-secret' }, ['super-secret']),
    /secret material/i,
  );
});
