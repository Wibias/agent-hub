import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createP5Receipt,
  finalizeP5Receipt,
  recordP5Phase,
} from '../../reference-graph/p5-receipt.mjs';

const binding = {
  purpose: 'agent-hub-reference-graph',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
};

function successfulReceipt() {
  let receipt = createP5Receipt({
    binding,
    gitSha: '5'.repeat(40),
    verificationAt: '2026-10-23T12:30:00.000Z',
    referenceTime: '2026-10-23T12:00:00.000Z',
  });
  for (const phase of ['preflight', 'selector', 'embeddings', 'shadow']) {
    receipt = recordP5Phase(receipt, { phase, status: 'success' });
  }
  return receipt;
}

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

function controlHealth(overrides = {}) {
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

const embeddingCoverage = {
  eligible_chunk_count: 275,
  compatible_count: 275,
  missing_count: 0,
  text_hash_mismatch_count: 0,
  coverage_rate: 1,
};
const evaluations = {
  semantic: { status: 'available', summary: { cutover_ready: false } },
  hybrid: { status: 'available', summary: { cutover_ready: true, blockers: [] } },
};

test('verified selector boolean cannot hide incomplete cases or coverage gaps', () => {
  const final = finalizeP5Receipt(successfulReceipt(), {
    selectorContract: selectorContract({
      full_limit_case_count: 23,
      cases_with_coverage_gaps: 1,
    }),
    currentControlHealth: controlHealth(),
    embeddingCoverage,
    evaluations,
  });

  assert.equal(final.eligible_for_cutover_review, false);
  assert.match(final.blockers.join(' '), /selector/i);
});

test('healthy control boolean cannot hide incomplete cases or coverage gaps', () => {
  const final = finalizeP5Receipt(successfulReceipt(), {
    selectorContract: selectorContract(),
    currentControlHealth: controlHealth({
      full_limit_case_count: 23,
      cases_with_coverage_gaps: 1,
    }),
    embeddingCoverage,
    evaluations,
  });

  assert.equal(final.eligible_for_cutover_review, false);
  assert.match(final.blockers.join(' '), /control/i);
});
