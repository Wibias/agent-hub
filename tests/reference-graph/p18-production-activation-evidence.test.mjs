import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const EVIDENCE_PATH = 'reference-graph/evidence/p18-production-activation-receipt-evidence.json';
const PREFLIGHT_EVIDENCE_PATH = 'reference-graph/evidence/p18-production-activation-preflight-evidence.json';
const ACTIVATION_MAIN_SHA = '6c60d1a56c3a08b689b6b58b5f79cc6f45c7ea67';
const PREFLIGHT_EVIDENCE_SHA256 = '1b52fbed9883bbe89e53956a1b258eda57d3216d1a829bdcd90ea3f16dba4e99';
const AUTHORITY_SHA256 = 'e3554b76b8add430a6e0276e97c9cb16702f6af57764db53445d00b49f6e965c';
const REQUEST_HASH = 'ed31630f9bda1362f42e747a6366d8504d17638b8ba458228db6fec5a2074ce7';
const GRANT_PAYLOAD_HASH = 'e2ae9a9608590b1256573b6770a226daf4b38ae0440027570f90752ec6caa465';

function evidence() {
  return JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
}

test('P18 production activation receipt evidence pins the immutable preflight evidence and activated main', () => {
  const actualPreflightSha256 = createHash('sha256')
    .update(readFileSync(PREFLIGHT_EVIDENCE_PATH))
    .digest('hex');
  assert.equal(actualPreflightSha256, PREFLIGHT_EVIDENCE_SHA256);

  const value = evidence();
  assert.equal(value.schema_version, 'reference-graph.p18-production-activation-receipt.v1');
  assert.equal(value.activation_main_sha, ACTIVATION_MAIN_SHA);
  assert.equal(value.preflight_evidence_path, PREFLIGHT_EVIDENCE_PATH);
  assert.equal(value.preflight_evidence_sha256, PREFLIGHT_EVIDENCE_SHA256);
  assert.equal(value.ceremony_attempt_id, 'attempt-20261024T234734Z');
  assert.equal(value.evidence_frozen_at, '2026-10-24T23:51:46.000Z');
  assert.equal(new Date(value.evidence_frozen_at).toISOString(), value.evidence_frozen_at);
});

test('P18 production activation receipt evidence pins the successful post-merge governance runs', () => {
  assert.deepEqual(evidence().post_merge_governance, {
    reference_graph_governance_run_id: 40143207911,
    p16_governance_run_id: 40143207933,
    p17_governance_run_id: 40143207898,
    p18_governance_run_id: 40143207913,
    release_governance_run_id: 40143207937,
    all_success: true,
  });
});

test('P18 production activation receipt evidence binds the exact authority, request, payload and target', () => {
  const value = evidence();
  assert.equal(value.authority_sha256, AUTHORITY_SHA256);
  assert.equal(value.request_hash, REQUEST_HASH);
  assert.equal(value.grant_payload_hash, GRANT_PAYLOAD_HASH);
  assert.deepEqual(value.production_target, {
    project_ref: 'vrznfnxzlxaavpqbzbzd',
    project_name: 'agent-hub-reference-graph',
    region: 'eu-central-1',
    url: 'https://vrznfnxzlxaavpqbzbzd.supabase.co',
  });
});

test('P18 production activation receipt evidence records the read-only preflight immediately before cutover', () => {
  assert.deepEqual(evidence().preflight_receipt, {
    preflight_ready: true,
    target_project_ref: 'vrznfnxzlxaavpqbzbzd',
    elevated_key_type: 'secret',
    grant_verified: true,
    activation_authorized: true,
    production_source: 'legacy-control',
    quick_graph_enabled: false,
    repository_default_graph_enabled: false,
  });
});

test('P18 production activation receipt evidence records clean one-shot activation and post-activation status', () => {
  const value = evidence();
  assert.deepEqual(value.activation_receipt, {
    status: 'activated',
    grant_verified: true,
    activation_authorized: true,
    grant_consumed: true,
    activation_performed: true,
    rollback_performed: false,
    rollback_verified: false,
    production_source: 'reference-graph',
    retry_requires_new_grant: true,
    blocker: null,
  });
  assert.deepEqual(value.post_activation_status, {
    production_source: 'reference-graph',
    quick_graph_enabled: true,
    repository_default_graph_enabled: false,
  });
  assert.deepEqual(value.receipt_contract, {
    operator_run_receipt_sanitized: true,
    credentials_cleared_after_ceremony: true,
    nonce_reuse_forbidden: true,
    p17_live_probe_required_for_activated_status: true,
    rollback_required_on_post_mutation_probe_failure: true,
    secret_material_present: false,
  });
});

test('P18 production activation receipt evidence contains no key bytes, credentials, signature, nonce or private receipt ids', () => {
  const serialized = JSON.stringify(evidence());
  for (const forbidden of [
    /sb_secret_[A-Za-z0-9_-]+/i,
    /sb_publishable_[A-Za-z0-9_-]+/i,
    /"(?:service_role_key|service_role_token|service_role_secret|service_role_password)":/i,
    /"private_key(?:_[^"]*)?":/i,
    /public_key_spki_base64/i,
    /signature_base64/i,
    /"(?:nonce|grant_nonce)":/i,
    /"consumption_id":/i,
    /"activation_change_id":/i,
    /authority-private\.pem/i,
    /grant\.sig/i,
    /C:\\Users\\/i,
  ]) {
    assert.doesNotMatch(serialized, forbidden);
  }
});
