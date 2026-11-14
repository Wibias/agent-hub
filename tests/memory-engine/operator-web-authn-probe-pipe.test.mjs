import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  OPERATOR_UV_PROTOCOL, verifyOperatorProofEnvelope,
} from '../../memory-engine/adapters/operator-webauthn-probe-pipe.mjs';

const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pinnedPublicKeyPem = keys.publicKey.export({ format: 'pem', type: 'spki' });
const expectedNonce = Buffer.alloc(32, 1).toString('base64url');
const value = 'Operator-protected E~ source fact must be shown exactly.';
const meaning = {
  projectId: 'github.com/example/operator-evidence',
  branch: 'main',
  revisionSha: 'a'.repeat(40),
  proposalRef: 'E~0123456789',
  reviewSnapshotSha256: 'b'.repeat(64),
  canonicalFactSha256: createHash('sha256').update(value).digest('hex'),
  decision: 'confirm',
  canonicalFact: value,
};
const scope = { projectId: meaning.projectId, branch: meaning.branch,
  proposalRef: meaning.proposalRef };
const offer = {
  protocol: OPERATOR_UV_PROTOCOL,
  op: 'begin', nonce: expectedNonce,
  status: 'operator_service_uv_challenge_not_approval',
  service_signed: true,
  human_approval_verified: false,
  claim_written: false,
  request_id: 'stored-request',
  ticket_id: Buffer.alloc(24, 5).toString('base64url'),
  challenge: Buffer.alloc(32, 2).toString('base64url'),
  expires_utc: '2026-11-14T20:33:00.000Z',
  credential_id: Buffer.alloc(32, 3).toString('base64url'),
  expected_origin: 'http://localhost:4328',
  kind: 'knowledge',
  source_origin: 'operator_pinned_unverified_evidence_v1',
  evidence_sha256: 'c'.repeat(64),
  meaning,
};
function envelope(payload) {
  const raw = Buffer.from(JSON.stringify(payload));
  return {
    protocol: OPERATOR_UV_PROTOCOL,
    payload_b64: raw.toString('base64'),
    signature_b64: sign('sha256', raw, keys.privateKey).toString('base64'),
  };
}
function check(payload, extra = {}) {
  return verifyOperatorProofEnvelope({
    envelope: envelope(payload),
    expectedOp: payload.op,
    expectedNonce,
    pinnedPublicKeyPem,
    expectedScope: scope,
    ...extra,
  });
}

test('service-signed real E~ fact / challenge and source digest are verified from raw bytes', () => {
  const verified = check(offer);
  assert.equal(verified.service_signature_verified, true);
  assert.equal(verified.meaning.canonicalFact, value);
  assert.equal(verified.trusted_human_approval, false);
  assert.equal(verified.production_claim_authorized, false);
});

test('tampered fact, context, hash or affirmative authority are refused even if signed', () => {
  assert.throws(() => check({
    ...offer, meaning: { ...meaning, canonicalFact: 'changed' },
  }), /operator_proof_service_unverified/);
  assert.throws(() => check({
    ...offer, meaning: { ...meaning, branch: 'foreign-branch' },
  }), /operator_proof_service_unverified/);
  assert.throws(() => check({
    ...offer, human_approval_verified: true,
  }), /operator_proof_service_unverified/);
  assert.throws(() => check({
    ...offer, claim_written: true,
  }), /operator_proof_service_unverified/);
});

test('unknown key, signature corruption and replayed nonce are refused', () => {
  const different = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  assert.throws(() => check(offer, {
    pinnedPublicKeyPem: different.publicKey.export({ format: 'pem', type: 'spki' }),
  }), /operator_proof_service_unverified/);
  const broken = envelope(offer);
  broken.signature_b64 = Buffer.alloc(70, 0x64).toString('base64');
  assert.throws(() => verifyOperatorProofEnvelope({
    envelope: broken, expectedNonce, expectedOp: 'begin',
    pinnedPublicKeyPem,
  }), /operator_proof_service_unverified/);
  assert.throws(() => check(offer, {
    expectedNonce: Buffer.alloc(32, 0).toString('base64url'),
  }), /operator_proof_service_unverified/);
});

test('completion is still not human consent or protected Claim after valid ES256', () => {
  const completed = check({
    protocol: OPERATOR_UV_PROTOCOL,
    op: 'complete', nonce: expectedNonce,
    status: 'operator_webauthn_uv_verified_not_approved',
    signature_verified: true, service_signed: true,
    human_approval_verified: false, claim_written: false,
    request_id: 'stored-request',
  }, { expectedOp: 'complete' });
  assert.equal(completed.signature_verified, true);
  assert.equal(completed.trusted_human_approval, false);
  assert.equal(completed.production_claim_authorized, false);
  assert.throws(() => check({
    ...completed, human_approval_verified: true,
  }, { expectedOp: 'complete' }), /operator_proof_service_unverified/);
  assert.throws(() => check({
    ...completed, status: 'protected_claim_written',
  }, { expectedOp: 'complete' }), /operator_proof_service_unverified/);
});
