import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const EVIDENCE_PATH = 'reference-graph/evidence/p16-durable-grant-consumption-evidence.json';
const IMPLEMENTATION_SHA = 'bb2473ddf2763984c21cef59c6d92a27acbd8237';
const REFERENCE_GRAPH_RUN_ID = 40057733870;
const P16_GOVERNANCE_RUN_ID = 40057733866;
const RELEASE_RUN_ID = 40057733880;
const VERIFICATION_AT = '2026-10-24T03:28:46.004Z';

function evidence() {
  return JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
}

test('durable P16 evidence pins P15, the tested implementation, and real green governance', () => {
  const value = evidence();
  assert.equal(value.schema_version, 'reference-graph.p16-durable-grant-consumption.v1');
  assert.equal(value.p15_evidence_head, '04b6056721697060d10dac640899a11d68c7bc05');
  assert.equal(value.p15_evidence_sha256, 'f95e2b2112962881d499191d21a762b2f2dca0e3abe28c65e2e8abc2f67bdbe7');
  assert.equal(value.git_sha, IMPLEMENTATION_SHA);
  assert.equal(value.reference_graph_governance_run_id, REFERENCE_GRAPH_RUN_ID);
  assert.equal(value.p16_governance_run_id, P16_GOVERNANCE_RUN_ID);
  assert.equal(value.release_governance_run_id, RELEASE_RUN_ID);
  assert.equal(value.verification_at, VERIFICATION_AT);
  assert.equal(new Date(value.verification_at).toISOString(), value.verification_at);
});

test('durable P16 evidence records the exact live Supabase replay boundary', () => {
  const value = evidence();
  assert.deepEqual(value.live_target, {
    project_ref: 'vrznfnxzlxaavpqbzbzd',
    project_name: 'agent-hub-reference-graph',
    region: 'eu-central-1',
  });
  assert.equal(value.live_migration.version, '20261024032812');
  assert.equal(value.live_migration.name, 'reference_graph_activation_grant_consumption_p16');
  assert.equal(value.live_ledger.table_present, true);
  assert.equal(value.live_ledger.rpc_present, true);
  assert.equal(value.live_ledger.row_count, 0);
  assert.equal(value.live_ledger.anon_execute, false);
  assert.equal(value.live_ledger.authenticated_execute, false);
  assert.equal(value.live_ledger.service_role_execute, true);
  assert.equal(value.live_ledger.anon_select, false);
  assert.equal(value.live_ledger.authenticated_select, false);
  assert.equal(value.live_ledger.service_role_select, false);
  assert.equal(value.live_ledger.service_role_insert, false);
  assert.equal(value.synthetic_live_nonce_consumed, false);
});

test('P16 readiness does not invent authority, grant, host actuator, or production activation', () => {
  const value = evidence();
  assert.equal(value.replay_ledger_ready, true);
  assert.equal(value.authority_state, 'awaiting-external-enrollment');
  assert.equal(value.grant_state, 'not-issued');
  assert.equal(value.grant_consumed, false);
  assert.equal(value.activation_authorized, false);
  assert.equal(value.activation_performed, false);
  assert.equal(value.repository_default_graph_enabled, false);
  assert.equal(value.production_source, 'legacy-control');
  assert.equal(value.host_actuator_state, 'unbound');
  assert.equal(value.external_blocker, 'production-ed25519-authority-grant-and-host-actuator-not-provided');
});

test('P16 evidence records only non-attributable advisor INFO findings and no secret material', () => {
  const value = evidence();
  assert.equal(value.advisors.p16_security_warn_error_count, 0);
  assert.equal(value.advisors.p16_performance_warn_error_count, 0);
  assert.equal(value.advisors.existing_security_info_count, 12);
  assert.equal(value.advisors.existing_performance_info_count, 4);

  const serialized = JSON.stringify(value);
  for (const forbidden of [
    /service[_-]?role[_-]?(?:key|token|secret|password)/i,
    /private[_-]?key/i,
    /signature_base64/i,
    /public_key_spki_base64/i,
    /grant\s*:\s*\{/i,
  ]) {
    assert.doesNotMatch(serialized, forbidden);
  }
});
