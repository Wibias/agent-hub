import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const EVIDENCE_PATH = 'reference-graph/evidence/p18-production-activation-preflight-evidence.json';
const P17_EVIDENCE_PATH = 'reference-graph/evidence/p17-local-runtime-actuator-evidence.json';
const P17_EVIDENCE_HEAD = '1042b502e895e050b398f66b45b313c477eaab2f';
const P17_EVIDENCE_SHA256 = '00adb83015a4f956517cb7d3dfde260a2bf5efda32d3ddb72977db7b49580f69';
const IMPLEMENTATION_SHA = '312c3eff4f7fe4644ba482111ae33859ec4fe971';
const REFERENCE_GRAPH_RUN_ID = 40065909677;
const P16_GOVERNANCE_RUN_ID = 40065909706;
const P17_GOVERNANCE_RUN_ID = 40065909720;
const P18_GOVERNANCE_RUN_ID = 40065909743;
const RELEASE_RUN_ID = 40065909671;
const VERIFICATION_AT = '2026-10-24T05:22:30.000Z';

function evidence() {
  return JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
}

test('P18 pre-activation evidence pins exact P17 evidence bytes and the tested implementation governance', () => {
  const actualP17Sha256 = createHash('sha256')
    .update(readFileSync(P17_EVIDENCE_PATH))
    .digest('hex');
  assert.equal(actualP17Sha256, P17_EVIDENCE_SHA256);

  const value = evidence();
  assert.equal(value.schema_version, 'reference-graph.p18-production-activation-preflight.v1');
  assert.equal(value.p17_evidence_head, P17_EVIDENCE_HEAD);
  assert.equal(value.p17_evidence_sha256, P17_EVIDENCE_SHA256);
  assert.equal(value.git_sha, IMPLEMENTATION_SHA);
  assert.equal(value.reference_graph_governance_run_id, REFERENCE_GRAPH_RUN_ID);
  assert.equal(value.p16_governance_run_id, P16_GOVERNANCE_RUN_ID);
  assert.equal(value.p17_governance_run_id, P17_GOVERNANCE_RUN_ID);
  assert.equal(value.p18_governance_run_id, P18_GOVERNANCE_RUN_ID);
  assert.equal(value.release_governance_run_id, RELEASE_RUN_ID);
  assert.equal(value.verification_at, VERIFICATION_AT);
  assert.equal(new Date(value.verification_at).toISOString(), value.verification_at);
});

test('P18 evidence records the production ceremony boundary without fabricating an authority or grant', () => {
  const value = evidence();
  assert.equal(value.ceremony_ready, true);
  assert.equal(value.host_actuator_state, 'ready-unexecuted');
  assert.equal(value.replay_ledger_ready, true);
  assert.equal(value.authority_state, 'awaiting-real-operator-key');
  assert.equal(value.grant_state, 'not-issued');
  assert.equal(value.grant_consumed, false);
  assert.equal(value.activation_authorized, false);
  assert.equal(value.activation_performed, false);
  assert.equal(value.repository_default_graph_enabled, false);
  assert.equal(value.production_source, 'legacy-control');
  assert.equal(value.live_local_activation_attempted, false);
  assert.equal(value.synthetic_live_nonce_consumed, false);
  assert.equal(value.external_blocker, 'production-ed25519-authority-key-and-signed-grant-not-provided');
});

test('P18 evidence pins the real dedicated target while keeping credentials entirely absent', () => {
  const value = evidence();
  assert.deepEqual(value.production_target, {
    project_ref: 'vrznfnxzlxaavpqbzbzd',
    project_name: 'agent-hub-reference-graph',
    region: 'eu-central-1',
    url: 'https://vrznfnxzlxaavpqbzbzd.supabase.co',
  });
  assert.equal(value.elevated_transport.preferred_key_type, 'SUPABASE_SECRET_KEY');
  assert.equal(value.elevated_transport.legacy_fallback, 'SUPABASE_SERVICE_ROLE_KEY');
  assert.equal(value.elevated_transport.modern_secret_bearer_header, false);
  assert.equal(value.elevated_transport.secret_material_present, false);
});

test('P18 evidence records all verified ceremony and cutover safety boundaries', () => {
  const checks = evidence().checks;
  assert.equal(checks.modern_supabase_secret_key_support, true);
  assert.equal(checks.legacy_service_role_fallback, true);
  assert.equal(checks.external_openssl_ed25519_compatibility, true);
  assert.equal(checks.external_manual_authority_approval, true);
  assert.equal(checks.ten_minute_grant, true);
  assert.equal(checks.canonical_payload_hash_binding, true);
  assert.equal(checks.read_only_preflight, true);
  assert.equal(checks.exact_confirmation_token_gate, true);
  assert.equal(checks.p15_grant_reverification, true);
  assert.equal(checks.p16_consumption_before_mutation, true);
  assert.equal(checks.p17_quick_only_actuator, true);
  assert.equal(checks.rollback_verification, true);
  assert.equal(checks.no_migration_011, true);
  assert.equal(checks.no_live_nonce_consumption, true);
  assert.equal(checks.no_live_activation, true);
  assert.equal(checks.public_release_safe, true);
});

test('P18 pre-activation evidence contains no private/public key bytes, signature, grant, nonce, credentials, or live receipt ids', () => {
  const serialized = JSON.stringify(evidence());
  for (const forbidden of [
    /sb_secret_/i,
    /service[_-]?role[_-]?(?:key|token|secret|password)/i,
    /publishable[_-]?key/i,
    /private[_-]?key/i,
    /public_key_spki_base64/i,
    /signature_base64/i,
    /grant\s*:\s*\{/i,
    /nonce/i,
    /consumption_id/i,
    /activation_change_id/i,
  ]) {
    assert.doesNotMatch(serialized, forbidden);
  }
});
