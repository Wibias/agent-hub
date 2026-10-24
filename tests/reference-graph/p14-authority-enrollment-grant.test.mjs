import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  P13_EVIDENCE_HEAD,
  P13_EVIDENCE_SHA256,
  P13_REQUEST_HASH,
  createP14EnrollmentManifest,
  createP14UnsignedGrantPayload,
  hashP14GrantPayload,
  verifyP14SignedGrant,
} from '../../reference-graph/p14-authority-enrollment-grant.mjs';
import {
  hashP13AuthorityDescriptor,
} from '../../reference-graph/p13-activation-grant-authority.mjs';

const P13_EVIDENCE_PATH = 'reference-graph/evidence/p13-activation-grant-authority-evidence.json';
const EXPECTED_P13_HEAD = 'bbd29fbe596801fdb7594f45045cb41e9c9b1a5b';
const EXPECTED_REQUEST_HASH = 'ed31630f9bda1362f42e747a6366d8504d17638b8ba458228db6fec5a2074ce7';

function p13Evidence() {
  return JSON.parse(readFileSync(P13_EVIDENCE_PATH, 'utf8'));
}

function actualP13EvidenceSha256() {
  return createHash('sha256').update(readFileSync(P13_EVIDENCE_PATH)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function authorityFixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const authority = {
    schema_version: 'reference-graph.p13-ed25519-authority.v1',
    authority_id: 'p14-ephemeral-test-authority',
    key_id: 'p14-ephemeral-key-1',
    algorithm: 'Ed25519',
    public_key_spki_base64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  return {
    authority,
    privateKey,
    approvedAuthoritySha256: hashP13AuthorityDescriptor(authority),
  };
}

function enrollmentFixture() {
  const fixture = authorityFixture();
  return {
    ...fixture,
    enrollment: createP14EnrollmentManifest({
      p13Evidence: p13Evidence(),
      p13EvidenceSha256: actualP13EvidenceSha256(),
      authority: fixture.authority,
      approvedAuthoritySha256: fixture.approvedAuthoritySha256,
    }),
  };
}

function unsignedPayload(enrollment) {
  return createP14UnsignedGrantPayload({
    p13Evidence: p13Evidence(),
    enrollmentManifest: enrollment,
    issuedAt: '2026-10-24T02:00:00.000Z',
    notBefore: '2026-10-24T02:00:00.000Z',
    expiresAt: '2026-10-24T02:15:00.000Z',
    nonce: 'ef'.repeat(32),
  });
}

test('P14 pins the exact final P13 evidence head, request, and evidence bytes', () => {
  assert.equal(P13_EVIDENCE_HEAD, EXPECTED_P13_HEAD);
  assert.equal(P13_REQUEST_HASH, EXPECTED_REQUEST_HASH);
  assert.match(P13_EVIDENCE_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(P13_EVIDENCE_SHA256, actualP13EvidenceSha256());

  const evidence = p13Evidence();
  assert.equal(evidence.schema_version, 'reference-graph.p13-activation-grant-authority.v1');
  assert.equal(evidence.request_hash, EXPECTED_REQUEST_HASH);
  assert.equal(evidence.infrastructure_ready, true);
  assert.equal(evidence.authority_state, 'unconfigured');
  assert.equal(evidence.trusted_authority_sha256, null);
  assert.equal(evidence.grant_state, 'not-issued');
  assert.equal(evidence.grant_verified, false);
  assert.equal(evidence.activation_authorized, false);
  assert.equal(evidence.activation_performed, false);
  assert.equal(evidence.repository_default_graph_enabled, false);
  assert.equal(evidence.production_source, 'legacy-control');
});

test('authority enrollment requires an independent exact approval hash', () => {
  const { authority, approvedAuthoritySha256 } = authorityFixture();
  const manifest = createP14EnrollmentManifest({
    p13Evidence: p13Evidence(),
    p13EvidenceSha256: actualP13EvidenceSha256(),
    authority,
    approvedAuthoritySha256,
  });

  assert.deepEqual(manifest, {
    schema_version: 'reference-graph.p14-authority-enrollment.v1',
    p13_evidence_head: EXPECTED_P13_HEAD,
    p13_evidence_sha256: P13_EVIDENCE_SHA256,
    p13_request_hash: EXPECTED_REQUEST_HASH,
    target: p13Evidence().target,
    profile: 'quick',
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_value: 'graph',
    authority,
    authority_sha256: approvedAuthoritySha256,
    approved_authority_sha256: approvedAuthoritySha256,
    environment: 'production',
    private_key_custody: 'external',
    private_key_present: false,
  });

  for (const approved of [undefined, null, '', '0'.repeat(64)]) {
    assert.throws(
      () => createP14EnrollmentManifest({
        p13Evidence: p13Evidence(),
        p13EvidenceSha256: actualP13EvidenceSha256(),
        authority,
        approvedAuthoritySha256: approved,
      }),
      /approved authority|approval hash|independent/i,
    );
  }
});

test('enrollment fails closed on P13 drift, unknown authority fields, and non-Ed25519 keys', () => {
  const { authority, approvedAuthoritySha256 } = authorityFixture();
  assert.throws(
    () => createP14EnrollmentManifest({
      p13Evidence: { ...p13Evidence(), activation_authorized: true },
      p13EvidenceSha256: actualP13EvidenceSha256(),
      authority,
      approvedAuthoritySha256,
    }),
    /P13 evidence|pre-ceremony|contract/i,
  );
  assert.throws(
    () => createP14EnrollmentManifest({
      p13Evidence: p13Evidence(),
      p13EvidenceSha256: actualP13EvidenceSha256(),
      authority: { ...authority, private_key: 'forbidden' },
      approvedAuthoritySha256,
    }),
    /authority|exact fields|private/i,
  );

  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsaAuthority = {
    schema_version: 'reference-graph.p13-ed25519-authority.v1',
    authority_id: 'rsa-masquerading-as-ed25519',
    key_id: 'rsa-key',
    algorithm: 'Ed25519',
    public_key_spki_base64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  const selfHash = createHash('sha256').update(canonicalJson(rsaAuthority), 'utf8').digest('hex');
  assert.throws(
    () => createP14EnrollmentManifest({
      p13Evidence: p13Evidence(),
      p13EvidenceSha256: actualP13EvidenceSha256(),
      authority: rsaAuthority,
      approvedAuthoritySha256: selfHash,
    }),
    /Ed25519|authority/i,
  );
});

test('unsigned grant payload is exact, canonical, and bounded to 15 minutes', () => {
  const { enrollment } = enrollmentFixture();
  const payload = unsignedPayload(enrollment);
  assert.deepEqual(payload, {
    schema_version: 'reference-graph.p13-activation-grant.v1',
    request_hash: EXPECTED_REQUEST_HASH,
    p12_evidence_head: p13Evidence().grant_request.p12_evidence_head,
    p12_binding_hash: p13Evidence().grant_request.p12_binding_hash,
    target: p13Evidence().target,
    profile: 'quick',
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_value: 'graph',
    issuer: enrollment.authority.authority_id,
    key_id: enrollment.authority.key_id,
    issued_at: '2026-10-24T02:00:00.000Z',
    not_before: '2026-10-24T02:00:00.000Z',
    expires_at: '2026-10-24T02:15:00.000Z',
    nonce: 'ef'.repeat(32),
    signature_algorithm: 'Ed25519',
  });
  assert.match(hashP14GrantPayload(payload), /^[0-9a-f]{64}$/);
  assert.equal(
    hashP14GrantPayload(Object.fromEntries(Object.entries(payload).reverse())),
    hashP14GrantPayload(payload),
  );

  for (const patch of [
    { issuedAt: 'October 24, 2026 02:00 UTC' },
    { notBefore: '2026-10-24T04:00:00+02:00' },
    { expiresAt: '2026-10-24T02:15:00.001Z' },
    { nonce: 'short' },
  ]) {
    assert.throws(
      () => createP14UnsignedGrantPayload({
        p13Evidence: p13Evidence(),
        enrollmentManifest: enrollment,
        issuedAt: patch.issuedAt ?? '2026-10-24T02:00:00.000Z',
        notBefore: patch.notBefore ?? '2026-10-24T02:00:00.000Z',
        expiresAt: patch.expiresAt ?? '2026-10-24T02:15:00.000Z',
        nonce: patch.nonce ?? 'ef'.repeat(32),
      }),
      /timestamp|15 minutes|nonce|canonical/i,
    );
  }
});

test('externally signed exact grant authorizes but never performs activation', () => {
  const { enrollment, privateKey } = enrollmentFixture();
  const payload = unsignedPayload(enrollment);
  const grant = {
    ...payload,
    signature_base64: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
  };
  const result = verifyP14SignedGrant({
    p13Evidence: p13Evidence(),
    enrollmentManifest: enrollment,
    grant,
    now: new Date('2026-10-24T02:05:00.000Z'),
  });
  assert.equal(result.grantVerified, true, JSON.stringify(result));
  assert.equal(result.activationAuthorized, true);
  assert.equal(result.activationPerformed, false);
  assert.equal(result.repositoryDefaultGraphEnabled, false);
  assert.equal(result.productionSource, 'legacy-control');
  assert.deepEqual(result.blockers, []);
});

test('wrong signature, unknown grant fields, and wrong request fail closed', () => {
  const { enrollment, privateKey } = enrollmentFixture();
  const payload = unsignedPayload(enrollment);
  const signature = sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64');
  const variants = [
    { ...payload, signature_base64: Buffer.alloc(64, 1).toString('base64') },
    { ...payload, activation_authorized: true, signature_base64: signature },
    { ...payload, request_hash: '0'.repeat(64), signature_base64: signature },
  ];
  for (const grant of variants) {
    const result = verifyP14SignedGrant({
      p13Evidence: p13Evidence(),
      enrollmentManifest: enrollment,
      grant,
      now: new Date('2026-10-24T02:05:00.000Z'),
    });
    assert.equal(result.grantVerified, false);
    assert.equal(result.activationAuthorized, false);
    assert.equal(result.activationPerformed, false);
  }
});
