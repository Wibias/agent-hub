import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { assertSecretFreeP15Receipt } from '../../reference-graph/p15-receipt.mjs';

const EVIDENCE_PATH = 'reference-graph/evidence/p15-activation-executor-evidence.json';
const IMPLEMENTATION_SHA = 'eba504f9b5472e34a9ae806ec22a5fcc6380697b';
const GOVERNANCE_RUN_ID = 40054923135;
const VERIFICATION_AT = '2026-10-24T02:37:50.000Z';

function evidence() {
  return JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
}

test('durable P15 evidence pins the tested implementation and real green governance run', () => {
  const value = evidence();
  assert.equal(value.schema_version, 'reference-graph.p15-activation-executor.v1');
  assert.equal(value.p14_evidence_head, '43fd2adf9e73749b03283f7ae7c6e700bd383b35');
  assert.equal(value.p14_evidence_sha256, '610f9f832d994e565fe6912e3aa1e25d5fe5b549fa08f1a48f477ee9b3956393');
  assert.equal(value.git_sha, IMPLEMENTATION_SHA);
  assert.equal(value.reference_graph_governance_run_id, GOVERNANCE_RUN_ID);
  assert.equal(value.verification_at, VERIFICATION_AT);
  assert.equal(new Date(value.verification_at).toISOString(), value.verification_at);
});

test('durable P15 evidence records infrastructure ready but no fabricated production authority grant or activation', () => {
  const value = evidence();
  assert.equal(value.infrastructure_ready, true);
  assert.equal(value.state, 'blocked');
  assert.equal(value.grant_state, 'not-issued');
  assert.equal(value.grant_verified, false);
  assert.equal(value.grant_consumed, false);
  assert.equal(value.activation_authorized, false);
  assert.equal(value.activation_performed, false);
  assert.equal(value.rollback_performed, false);
  assert.equal(value.rollback_verified, false);
  assert.equal(value.retry_requires_new_grant, false);
  assert.equal(value.repository_default_graph_enabled, false);
  assert.equal(value.production_source, 'legacy-control');
  assert.equal(value.external_blocker, 'production-ed25519-authority-and-grant-not-provided');
  assert.equal(value.enrollment_manifest, null);
  assert.equal(value.grant, null);
  assert.deepEqual(value.blockers, []);
});

test('durable P15 evidence records every structural safety check as green', () => {
  const value = evidence();
  assert.deepEqual(value.checks, {
    p14_binding: true,
    one_shot_nonce_before_mutation: true,
    fresh_reverification_before_mutation: true,
    rollback_verification_required: true,
    quick_only_activation: true,
    operator_read_only: true,
    repository_default_off: true,
    no_provider_specific_mutation: true,
    no_migration_010_or_later: true,
    reference_graph_governance: true,
  });
  assert.equal(assertSecretFreeP15Receipt(value), true);
});
