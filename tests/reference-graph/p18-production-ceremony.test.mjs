import assert from 'node:assert/strict';
import {
  createHash,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assembleAndVerifyP18Grant,
  createP18AuthorityDescriptor,
  createP18GrantArtifacts,
  hashP18AuthorityDescriptor,
} from '../../reference-graph/p18-production-ceremony.mjs';
import { hashP14GrantPayload } from '../../reference-graph/p14-authority-enrollment-grant.mjs';

const P13_EVIDENCE_PATH = 'reference-graph/evidence/p13-activation-grant-authority-evidence.json';
const FIXED_NOW = new Date('2026-10-24T06:00:00.000Z');
const FIXED_NONCE = '18'.repeat(32);

function p13Evidence() {
  return JSON.parse(readFileSync(P13_EVIDENCE_PATH, 'utf8'));
}

function ed25519Fixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeySpkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const authority = createP18AuthorityDescriptor({
    publicKeySpkiDer,
    authorityId: 'agent-hub-production-authority',
    keyId: 'agent-hub-production-2026-10',
  });
  return {
    authority,
    privateKey,
    approvedAuthoritySha256: hashP18AuthorityDescriptor(authority),
  };
}

test('P18 authority descriptor accepts only a real Ed25519 SPKI public key', () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const authority = createP18AuthorityDescriptor({
    publicKeySpkiDer: der,
    authorityId: 'agent-hub-production-authority',
    keyId: 'agent-hub-production-2026-10',
  });

  assert.deepEqual(authority, {
    schema_version: 'reference-graph.p13-ed25519-authority.v1',
    authority_id: 'agent-hub-production-authority',
    key_id: 'agent-hub-production-2026-10',
    algorithm: 'Ed25519',
    public_key_spki_base64: Buffer.from(der).toString('base64'),
  });
  assert.match(hashP18AuthorityDescriptor(authority), /^[0-9a-f]{64}$/);

  const { publicKey: wrongKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  assert.throws(
    () => createP18AuthorityDescriptor({
      publicKeySpkiDer: wrongKey.export({ type: 'spki', format: 'der' }),
      authorityId: 'wrong-authority',
      keyId: 'wrong-key',
    }),
    /Ed25519/i,
  );
});

test('P18 grant preparation requires the independently approved exact authority hash', () => {
  const { authority } = ed25519Fixture();
  assert.throws(
    () => createP18GrantArtifacts({
      p13Evidence: p13Evidence(),
      authority,
      approvedAuthoritySha256: '0'.repeat(64),
      now: FIXED_NOW,
      nonce: FIXED_NONCE,
    }),
    /approved authority|approval hash/i,
  );
});

test('P18 grant artifacts freeze a ten-minute current grant and exact canonical signing bytes', () => {
  const { authority, approvedAuthoritySha256 } = ed25519Fixture();
  const artifacts = createP18GrantArtifacts({
    p13Evidence: p13Evidence(),
    authority,
    approvedAuthoritySha256,
    now: FIXED_NOW,
    nonce: FIXED_NONCE,
  });

  assert.equal(artifacts.enrollment_manifest.private_key_custody, 'external');
  assert.equal(artifacts.enrollment_manifest.private_key_present, false);
  assert.equal(artifacts.grant_payload.issued_at, '2026-10-24T06:00:00.000Z');
  assert.equal(artifacts.grant_payload.not_before, '2026-10-24T06:00:00.000Z');
  assert.equal(artifacts.grant_payload.expires_at, '2026-10-24T06:10:00.000Z');
  assert.equal(artifacts.grant_payload.nonce, FIXED_NONCE);
  assert.equal(artifacts.grant_payload.signature_algorithm, 'Ed25519');
  assert.equal(artifacts.payload_sha256, hashP14GrantPayload(artifacts.grant_payload));
  assert.equal(
    createHash('sha256').update(artifacts.canonical_payload_utf8, 'utf8').digest('hex'),
    artifacts.payload_sha256,
  );
  assert.equal(
    JSON.parse(artifacts.canonical_payload_utf8).nonce,
    FIXED_NONCE,
  );
});

test('P18 generates a cryptographically shaped nonce when the operator does not supply one', () => {
  const { authority, approvedAuthoritySha256 } = ed25519Fixture();
  const artifacts = createP18GrantArtifacts({
    p13Evidence: p13Evidence(),
    authority,
    approvedAuthoritySha256,
    now: FIXED_NOW,
  });
  assert.match(artifacts.grant_payload.nonce, /^[0-9a-f]{64}$/);
  assert.notEqual(artifacts.grant_payload.nonce, '0'.repeat(64));
});

test('P18 assembles only a 64-byte Ed25519 signature that verifies against the approved authority', () => {
  const { authority, privateKey, approvedAuthoritySha256 } = ed25519Fixture();
  const artifacts = createP18GrantArtifacts({
    p13Evidence: p13Evidence(),
    authority,
    approvedAuthoritySha256,
    now: FIXED_NOW,
    nonce: FIXED_NONCE,
  });
  const signature = sign(null, Buffer.from(artifacts.canonical_payload_utf8, 'utf8'), privateKey);
  assert.equal(signature.length, 64);

  const assembled = assembleAndVerifyP18Grant({
    p13Evidence: p13Evidence(),
    authority,
    approvedAuthoritySha256,
    grantPayload: artifacts.grant_payload,
    signature,
    now: new Date('2026-10-24T06:01:00.000Z'),
  });

  assert.equal(assembled.verification.grantVerified, true);
  assert.equal(assembled.verification.activationAuthorized, true);
  assert.equal(assembled.verification.activationPerformed, false);
  assert.equal(assembled.grant.signature_base64, signature.toString('base64'));

  assert.throws(
    () => assembleAndVerifyP18Grant({
      p13Evidence: p13Evidence(),
      authority,
      approvedAuthoritySha256,
      grantPayload: artifacts.grant_payload,
      signature: Buffer.alloc(63),
      now: new Date('2026-10-24T06:01:00.000Z'),
    }),
    /64-byte Ed25519 signature/i,
  );
});

test('P18 production ceremony module has no signer or private-key implementation', () => {
  const source = readFileSync('reference-graph/p18-production-ceremony.mjs', 'utf8');
  assert.doesNotMatch(source, /generateKeyPair|createPrivateKey|private[_-]?key|\bsign\s*\(/i);
  assert.match(source, /createPublicKey/);
  assert.match(source, /randomBytes/);
});
