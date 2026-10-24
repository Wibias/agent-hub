import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const EVIDENCE_PATH = 'reference-graph/evidence/p17-local-runtime-actuator-evidence.json';
const P16_EVIDENCE_PATH = 'reference-graph/evidence/p16-durable-grant-consumption-evidence.json';
const P16_EVIDENCE_HEAD = '0e82d287d15066027d81613c3bc08f65cda8081d';
const P16_EVIDENCE_SHA256 = '699a813d78076352ed63935770b954f9d0796016a21182c7e718ce7c8011bc17';
const IMPLEMENTATION_SHA = 'cc3bc59250ec2b51d9a43d3e14815593cc44c2c7';
const REFERENCE_GRAPH_RUN_ID = 40063958350;
const P16_GOVERNANCE_RUN_ID = 40063958354;
const P17_GOVERNANCE_RUN_ID = 40063958450;
const RELEASE_RUN_ID = 40063958365;
const VERIFICATION_AT = '2026-10-24T04:52:49.000Z';

function evidence() {
  return JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
}

test('P17 evidence pins exact P16 evidence bytes and the tested implementation governance', () => {
  const actualP16Sha256 = createHash('sha256')
    .update(readFileSync(P16_EVIDENCE_PATH))
    .digest('hex');
  assert.equal(actualP16Sha256, P16_EVIDENCE_SHA256);

  const value = evidence();
  assert.equal(value.schema_version, 'reference-graph.p17-local-runtime-actuator.v1');
  assert.equal(value.p16_evidence_head, P16_EVIDENCE_HEAD);
  assert.equal(value.p16_evidence_sha256, P16_EVIDENCE_SHA256);
  assert.equal(value.git_sha, IMPLEMENTATION_SHA);
  assert.equal(value.reference_graph_governance_run_id, REFERENCE_GRAPH_RUN_ID);
  assert.equal(value.p16_governance_run_id, P16_GOVERNANCE_RUN_ID);
  assert.equal(value.p17_governance_run_id, P17_GOVERNANCE_RUN_ID);
  assert.equal(value.release_governance_run_id, RELEASE_RUN_ID);
  assert.equal(value.verification_at, VERIFICATION_AT);
  assert.equal(new Date(value.verification_at).toISOString(), value.verification_at);
});

test('P17 evidence records the exact local projection control plane without inventing a live host observation', () => {
  const value = evidence();
  assert.deepEqual(value.local_control_plane, {
    runtime_root: '~/.agents',
    query_entry: 'knowledge/design-references/scripts/query-runtime.mjs',
    query_child: 'knowledge/design-references/scripts/query.mjs',
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME=graph',
    mutable_state_location: 'agent-hub/reference-graph/activation-state-v1.json',
  });
  assert.equal(value.host_actuator_ready, true);
  assert.equal(value.host_actuator_state, 'ready-unexecuted');
  assert.equal(value.live_local_state_observed, false);
  assert.equal(value.live_local_activation_attempted, false);
});

test('P17 readiness does not invent authority, grant consumption, or production activation', () => {
  const value = evidence();
  assert.equal(value.replay_ledger_ready, true);
  assert.equal(value.authority_state, 'awaiting-external-enrollment');
  assert.equal(value.grant_state, 'not-issued');
  assert.equal(value.grant_consumed, false);
  assert.equal(value.activation_authorized, false);
  assert.equal(value.activation_performed, false);
  assert.equal(value.repository_default_graph_enabled, false);
  assert.equal(value.production_source, 'legacy-control');
  assert.equal(value.external_blocker, 'production-ed25519-authority-grant-not-provided');
});

test('P17 evidence records the verified safety and rollback boundaries', () => {
  const checks = evidence().checks;
  assert.equal(checks.p15_grant_verification, true);
  assert.equal(checks.p16_consumption_before_local_mutation, true);
  assert.equal(checks.exact_state_to_env_projection, true);
  assert.equal(checks.quick_only_graph_route, true);
  assert.equal(checks.standard_deep_legacy, true);
  assert.equal(checks.atomic_local_state_replace, true);
  assert.equal(checks.rollback_verification_ci, true);
  assert.equal(checks.caller_graph_env_cannot_bypass_state, true);
  assert.equal(checks.no_live_nonce_consumption, true);
  assert.equal(checks.no_live_local_activation, true);
  assert.equal(checks.no_migration_011, true);
  assert.equal(checks.public_release_safe, true);
});

test('P17 evidence contains no signer, secret, raw grant, or fabricated activation material', () => {
  const serialized = JSON.stringify(evidence());
  for (const forbidden of [
    /service[_-]?role[_-]?(?:key|token|secret|password)/i,
    /private[_-]?key/i,
    /signature_base64/i,
    /public_key_spki_base64/i,
    /grant\s*:\s*\{/i,
    /consumption_id/i,
    /activation_change_id/i,
  ]) {
    assert.doesNotMatch(serialized, forbidden);
  }
});
