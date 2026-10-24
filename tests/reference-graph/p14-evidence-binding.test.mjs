import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createP14EnrollmentManifest,
  createP14UnsignedGrantPayload,
  verifyP14SignedGrant,
} from '../../reference-graph/p14-authority-enrollment-grant.mjs';
import { hashP13AuthorityDescriptor } from '../../reference-graph/p13-activation-grant-authority.mjs';

const P13_PATH = 'reference-graph/evidence/p13-activation-grant-authority-evidence.json';

function p13Evidence() {
  return JSON.parse(readFileSync(P13_PATH, 'utf8'));
}

function p13EvidenceSha256() {
  return createHash('sha256').update(readFileSync(P13_PATH)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

test('payload and verification reject P13 evidence drift after enrollment', () => {
  const evidence = p13Evidence();
  const evidenceSha256 = p13EvidenceSha256();
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const authority = {
    schema_version: 'reference-graph.p13-ed25519-authority.v1',
    authority_id: 'p14-drift-test-authority',
    key_id: 'p14-drift-test-key',
    algorithm: 'Ed25519',
    public_key_spki_base64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  const approvedAuthoritySha256 = hashP13AuthorityDescriptor(authority);
  const enrollmentManifest = createP14EnrollmentManifest({
    p13Evidence: evidence,
    p13EvidenceSha256: evidenceSha256,
    authority,
    approvedAuthoritySha256,
  });

  const driftedEvidence = { ...evidence, activation_authorized: true };
  assert.throws(
    () => createP14UnsignedGrantPayload({
      p13Evidence: driftedEvidence,
      p13EvidenceSha256: evidenceSha256,
      enrollmentManifest,
      issuedAt: '2026-10-24T02:00:00.000Z',
      notBefore: '2026-10-24T02:00:00.000Z',
      expiresAt: '2026-10-24T02:15:00.000Z',
      nonce: 'aa'.repeat(32),
    }),
    /P13 evidence|pre-ceremony|contract/i,
  );

  const payload = createP14UnsignedGrantPayload({
    p13Evidence: evidence,
    p13EvidenceSha256: evidenceSha256,
    enrollmentManifest,
    issuedAt: '2026-10-24T02:00:00.000Z',
    notBefore: '2026-10-24T02:00:00.000Z',
    expiresAt: '2026-10-24T02:15:00.000Z',
    nonce: 'aa'.repeat(32),
  });
  const grant = {
    ...payload,
    signature_base64: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
  };

  assert.throws(
    () => verifyP14SignedGrant({
      p13Evidence: driftedEvidence,
      p13EvidenceSha256: evidenceSha256,
      enrollmentManifest,
      grant,
      now: new Date('2026-10-24T02:05:00.000Z'),
    }),
    /P13 evidence|pre-ceremony|contract/i,
  );
});
