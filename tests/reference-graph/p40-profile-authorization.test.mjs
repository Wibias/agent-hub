import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import {
  evaluateP40ScopedGrant, planP40FailClosedRollback,
} from '../../reference-graph/p40-profile-authorization.mjs';

const sha = '83a3794cc54d2f2d129b83e8e672e18b35f11cff';
const key = generateKeyPairSync('ed25519');
const publicKeyPem = key.publicKey.export({ type: 'spki', format: 'pem' });
const trustedPublicKeySha256 = createHash('sha256')
  .update(key.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
const now = new Date('2026-11-09T12:00:00.000Z');

function signed(payloadChanges = {}, privateKey = key.privateKey) {
  const payload = {
    schema_version: 'reference-graph.p40-canary-scope.v1',
    repository: 'Wibias/agent-hub',
    repository_sha: sha,
    project_ref: 'vrznfnxzlxaavpqbzbzd',
    profiles: ['standard', 'deep'],
    not_before: '2026-11-09T11:59:00.000Z',
    expires_at: '2026-11-09T12:20:00.000Z',
    evidence_sha256: 'a'.repeat(64),
    rollback_plan_sha256: 'b'.repeat(64),
    operator_id: 'verified_owner',
    nonce: 'P40scopeNonce20261109',
    mode: 'canary',
    canary_percent: 1,
    default_off: true,
    ...payloadChanges,
  };
  const payload_json = JSON.stringify(payload);
  return {
    schema_version: 'reference-graph.p40-signed-grant.v1',
    payload_json,
    signature_base64: sign(null, Buffer.from(payload_json), privateKey).toString('base64'),
  };
}
function preflight(grant, options = {}) {
  return evaluateP40ScopedGrant({
    grant, trustedPublicKeyPem, trustedPublicKeySha256,
    expectedRepositorySha: sha, now, ...options,
  });
}

test('P40 valid synthetic Ed25519 signature remains NONAUTHORIZING', () => {
  const r = preflight(signed());
  assert.equal(r.signature_valid, true);
  assert.equal(r.contract_valid, true);
  assert.equal(r.trust_anchor_independently_attested, false);
  assert.equal(r.grant_nonce_consumed, false);
  assert.equal(r.rollback_rehearsed, false);
  assert.equal(r.activation_authorized, false);
  assert.equal(r.repository_default_graph_enabled, false);
});

test('P40 rejects wrong signer, SHA/project/profile/expiry, and unauthenticated changes', () => {
  const foreign = generateKeyPairSync('ed25519');
  const cases = [
    signed({}, foreign.privateKey),
    signed({ repository_sha: '0'.repeat(40) }),
    signed({ project_ref: 'other-project' }),
    signed({ profiles: ['quick'] }),
    signed({ profiles: ['standard', 'standard'] }),
    signed({ default_off: false }),
    signed({ canary_percent: 100 }),
    signed({ expires_at: '2026-11-09T13:59:00.000Z' }),
    signed({ evidence_sha256: 'invalid' }),
    { ...signed(), signature_base64: Buffer.alloc(64).toString('base64') },
    { ...signed(), rogue: true },
  ];
  for (const grant of cases) {
    const r = preflight(grant);
    assert.equal(r.activation_authorized, false);
    assert.equal(r.contract_valid, false);
    assert.notEqual(r.reason, 'trust-and-release-authority-not-proven');
  }
  assert.equal(preflight(signed(), { expectedRepositorySha: '0'.repeat(40) }).signature_valid, true);
  assert.equal(preflight(signed(), { expectedRepositorySha: '0'.repeat(40) }).contract_valid, false);
});

test('P40 rollback always plans Legacy and no network for all scoped failure triggers', () => {
  for (const profile of ['standard', 'deep']) {
    for (const trigger of [
      'manual-revoke', 'signature-invalid', 'evidence-expired',
      'source-stale', 'http-error', 'timeout', 'parity-mismatch',
      'quality-regression', 'latency-budget', 'critical-monitor',
      'rollback-drill',
    ]) {
      const r = planP40FailClosedRollback({ profile, trigger });
      assert.equal(r.authoritative_source, 'legacy-control');
      assert.equal(r.transport_enabled, false);
      assert.equal(r.suppress_new_graph_requests, true);
      assert.equal(r.quick_profile_unchanged, true);
      assert.equal(r.changes_applied, false);
      assert.equal(r.activation_authorized, false);
    }
  }
  assert.throws(() => planP40FailClosedRollback({ profile: 'quick', trigger: 'timeout' }));
  assert.throws(() => planP40FailClosedRollback({ profile: 'standard', trigger: 'unknown' }));
});
