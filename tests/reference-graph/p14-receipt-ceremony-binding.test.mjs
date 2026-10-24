import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createP14EnrollmentManifest,
  createP14UnsignedGrantPayload,
} from '../../reference-graph/p14-authority-enrollment-grant.mjs';
import {
  P14_PHASES,
  createP14Receipt,
  finalizeP14Receipt,
  recordP14Phase,
} from '../../reference-graph/p14-receipt.mjs';
import { hashP13AuthorityDescriptor } from '../../reference-graph/p13-activation-grant-authority.mjs';

const P13_PATH = 'reference-graph/evidence/p13-activation-grant-authority-evidence.json';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function greenReceipt() {
  let receipt = createP14Receipt({
    gitSha: 'a'.repeat(40),
    verificationAt: '2026-10-24T02:30:00.000Z',
    referenceTime: '2026-10-24T02:30:00.000Z',
  });
  for (const phase of P14_PHASES) receipt = recordP14Phase(receipt, { phase, status: 'success' });
  return receipt;
}

const checks = {
  p13_binding: true,
  external_custody_only: true,
  enrollment_fail_closed: true,
  grant_verifier_fail_closed: true,
  repository_default_off: true,
  no_activation_path: true,
};

test('P14 receipt refuses a caller-fabricated verification object', () => {
  assert.throws(
    () => finalizeP14Receipt(greenReceipt(), {
      checks,
      ceremony: {
        enrollmentManifest: { schema_version: 'reference-graph.p14-authority-enrollment.v1' },
        grant: { schema_version: 'reference-graph.p13-activation-grant.v1' },
        verification: {
          grantVerified: true,
          activationAuthorized: true,
          activationPerformed: false,
          repositoryDefaultGraphEnabled: false,
          productionSource: 'legacy-control',
        },
      },
    }),
    /cryptographic|ceremony artifacts|re-verify|P13 evidence/i,
  );
});

test('P14 receipt authorizes only after re-verifying the actual signed ceremony artifacts', () => {
  const bytes = readFileSync(P13_PATH);
  const p13Evidence = JSON.parse(bytes.toString('utf8'));
  const p13EvidenceSha256 = createHash('sha256').update(bytes).digest('hex');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const authority = {
    schema_version: 'reference-graph.p13-ed25519-authority.v1',
    authority_id: 'p14-receipt-reverify-test',
    key_id: 'p14-receipt-reverify-key',
    algorithm: 'Ed25519',
    public_key_spki_base64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  const approvedAuthoritySha256 = hashP13AuthorityDescriptor(authority);
  const enrollmentManifest = createP14EnrollmentManifest({
    p13Evidence,
    p13EvidenceSha256,
    authority,
    approvedAuthoritySha256,
  });
  const payload = createP14UnsignedGrantPayload({
    p13Evidence,
    enrollmentManifest,
    issuedAt: '2026-10-24T02:00:00.000Z',
    notBefore: '2026-10-24T02:00:00.000Z',
    expiresAt: '2026-10-24T02:15:00.000Z',
    nonce: 'fe'.repeat(32),
  });
  const grant = {
    ...payload,
    signature_base64: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
  };

  const value = finalizeP14Receipt(greenReceipt(), {
    checks,
    ceremony: {
      p13Evidence,
      enrollmentManifest,
      grant,
      now: new Date('2026-10-24T02:05:00.000Z'),
    },
  });

  assert.equal(value.authority_state, 'enrolled');
  assert.equal(value.grant_state, 'issued');
  assert.equal(value.grant_verified, true);
  assert.equal(value.activation_authorized, true);
  assert.equal(value.activation_performed, false);
  assert.equal(value.production_source, 'legacy-control');
});
