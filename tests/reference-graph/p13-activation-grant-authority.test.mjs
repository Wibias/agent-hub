import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import {
  P12_EVIDENCE_SHA256 as FROZEN_P12_EVIDENCE_SHA256,
  createP13GrantRequest,
  hashP13AuthorityDescriptor,
  hashP13GrantRequest,
  verifyP13ActivationGrant,
} from '../../reference-graph/p13-activation-grant-authority.mjs';

const P12_HEAD = '5f676c806ae864b507723ea867f5e3afd6fd4adb';
const P12_BINDING_HASH = '68930447847df8d31de01b7fb60049136ae6fd0d74c837283fb837ff7e79961b';
const P12_EVIDENCE_SHA256 = '15a0db3e27ede261554fe9993d775db07ffabcaa74b9ec49b3df55d788659bcb';
const TARGET = {
  purpose: 'agent-hub-reference-graph',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
};

function p12Receipt(overrides = {}) {
  return {
    schema_version: 'reference-graph.p12-activation-authority.v1',
    target: TARGET,
    activation_binding: {
      schema_version: 'reference-graph.p12-activation-binding.v1',
      target: TARGET,
      profile: 'quick',
      activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
      activation_value: 'graph',
      runtime_auth_mode: 'publishable',
      service_role_runtime_allowed: false,
      timeout_ms: 1500,
      legacy_first: true,
      record_parity_required: 'exact-ordered',
      pattern_parity_required: 'exact-ordered',
      fallback_source: 'legacy-control',
      standard_mode: 'legacy-only',
      deep_mode: 'legacy-only',
      repository_default_graph_enabled: false,
      rollback_action: 'unset-or-change-REFERENCE_GRAPH_QUICK_RUNTIME',
    },
    binding_hash: P12_BINDING_HASH,
    preflight_ready: true,
    grant_state: 'not-issued',
    activation_authorized: false,
    activation_performed: false,
    repository_default_graph_enabled: false,
    production_source: 'legacy-control',
    profile_support: {
      quick: 'preflight-ready',
      standard: 'legacy-only',
      deep: 'legacy-only',
    },
    blockers: [],
    ...overrides,
  };
}

function request() {
  return createP13GrantRequest({
    p12Receipt: p12Receipt(),
    p12EvidenceSha256: P12_EVIDENCE_SHA256,
  });
}

function authorityFixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const authority = {
    schema_version: 'reference-graph.p13-ed25519-authority.v1',
    authority_id: 'test-operator-authority',
    key_id: 'test-key-1',
    algorithm: 'Ed25519',
    public_key_spki_base64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  return { authority, privateKey };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function signedGrant({ req = request(), authority, privateKey, patch = {} }) {
  const payload = {
    schema_version: 'reference-graph.p13-activation-grant.v1',
    request_hash: hashP13GrantRequest(req),
    p12_evidence_head: P12_HEAD,
    p12_binding_hash: P12_BINDING_HASH,
    target: TARGET,
    profile: 'quick',
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_value: 'graph',
    issuer: authority.authority_id,
    key_id: authority.key_id,
    issued_at: '2026-10-24T01:00:00.000Z',
    not_before: '2026-10-24T01:00:00.000Z',
    expires_at: '2026-10-24T01:15:00.000Z',
    nonce: 'ab'.repeat(32),
    signature_algorithm: 'Ed25519',
    ...patch,
  };
  return {
    ...payload,
    signature_base64: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
  };
}

test('P13 grant request freezes exact P12 evidence and quick-only runtime scope', () => {
  assert.equal(FROZEN_P12_EVIDENCE_SHA256, P12_EVIDENCE_SHA256);
  const value = request();
  assert.equal(value.schema_version, 'reference-graph.p13-activation-grant-request.v1');
  assert.equal(value.p12_evidence_head, P12_HEAD);
  assert.equal(value.p12_binding_hash, P12_BINDING_HASH);
  assert.equal(value.p12_evidence_sha256, P12_EVIDENCE_SHA256);
  assert.deepEqual(value.target, TARGET);
  assert.equal(value.profile, 'quick');
  assert.equal(value.activation_flag, 'REFERENCE_GRAPH_QUICK_RUNTIME');
  assert.equal(value.activation_value, 'graph');
  assert.equal(value.runtime_auth_mode, 'publishable');
  assert.equal(value.timeout_ms, 1500);
  assert.equal(value.legacy_first, true);
  assert.equal(value.record_parity_required, 'exact-ordered');
  assert.equal(value.pattern_parity_required, 'exact-ordered');
  assert.equal(value.fallback_source, 'legacy-control');
  assert.equal(value.standard_mode, 'legacy-only');
  assert.equal(value.deep_mode, 'legacy-only');
  assert.equal(value.repository_default_graph_enabled_before, false);
  assert.equal(value.production_source_before, 'legacy-control');
  assert.equal(value.rollback_action, 'unset-or-change-REFERENCE_GRAPH_QUICK_RUNTIME');
});

test('request builder fails closed when P12 readiness or frozen semantics drift', () => {
  assert.throws(
    () => createP13GrantRequest({
      p12Receipt: p12Receipt(),
      p12EvidenceSha256: 'b'.repeat(64),
    }),
    /P12 evidence SHA-256|evidence bytes|frozen/i,
  );

  for (const patch of [
    { binding_hash: 'b'.repeat(64) },
    { preflight_ready: false },
    { grant_state: 'issued' },
    { activation_authorized: true },
    { activation_performed: true },
    { repository_default_graph_enabled: true },
    { production_source: 'reference-graph' },
    { blockers: ['drift'] },
    { target: { ...TARGET, project_ref: 'wrong' } },
    { activation_binding: { ...p12Receipt().activation_binding, timeout_ms: 1499 } },
    { activation_binding: { ...p12Receipt().activation_binding, service_role_runtime_allowed: true } },
  ]) {
    assert.throws(
      () => createP13GrantRequest({ p12Receipt: p12Receipt(patch), p12EvidenceSha256: P12_EVIDENCE_SHA256 }),
      /P12|binding|receipt|contract|target|preflight|grant|activation|production/i,
      JSON.stringify(patch),
    );
  }
});

test('request and authority hashes are canonical and semantic-drift-sensitive', () => {
  const req = request();
  const reordered = Object.fromEntries(Object.entries(req).reverse());
  assert.equal(hashP13GrantRequest(reordered), hashP13GrantRequest(req));
  assert.notEqual(hashP13GrantRequest({ ...req, timeout_ms: 1499 }), hashP13GrantRequest(req));

  const { authority } = authorityFixture();
  const authorityReordered = Object.fromEntries(Object.entries(authority).reverse());
  assert.equal(hashP13AuthorityDescriptor(authorityReordered), hashP13AuthorityDescriptor(authority));
  assert.notEqual(
    hashP13AuthorityDescriptor({ ...authority, key_id: 'other-key' }),
    hashP13AuthorityDescriptor(authority),
  );
});

test('unknown request, authority, and grant fields fail closed', () => {
  const req = request();
  const { authority, privateKey } = authorityFixture();

  assert.throws(
    () => hashP13AuthorityDescriptor({ ...authority, private_key: 'forbidden-extra-field' }),
    /exact fields|unexpected authority field/i,
  );

  const trusted = hashP13AuthorityDescriptor(authority);
  const requestWithExtra = { ...req, activation_authorized: true };
  const requestResult = verifyP13ActivationGrant({
    request: requestWithExtra,
    grant: signedGrant({ req: requestWithExtra, authority, privateKey }),
    authority,
    trustedAuthoritySha256: trusted,
    now: new Date('2026-10-24T01:05:00.000Z'),
  });
  assert.equal(requestResult.grantVerified, false);
  assert.equal(requestResult.checks.request_contract, false);

  const grantWithExtra = signedGrant({
    req,
    authority,
    privateKey,
    patch: { activation_authorized: true },
  });
  const grantResult = verifyP13ActivationGrant({
    request: req,
    grant: grantWithExtra,
    authority,
    trustedAuthoritySha256: trusted,
    now: new Date('2026-10-24T01:05:00.000Z'),
  });
  assert.equal(grantResult.grantVerified, false);
  assert.equal(grantResult.checks.grant_contract, false);
});

test('authority descriptor rejects a non-Ed25519 SPKI even when the algorithm label says Ed25519', () => {
  const req = request();
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const authority = {
    schema_version: 'reference-graph.p13-ed25519-authority.v1',
    authority_id: 'rsa-masquerading-as-ed25519',
    key_id: 'wrong-key-type',
    algorithm: 'Ed25519',
    public_key_spki_base64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  const trusted = createHash('sha256').update(canonicalJson(authority), 'utf8').digest('hex');
  const grant = signedGrant({ req, authority, privateKey });

  assert.throws(
    () => hashP13AuthorityDescriptor(authority),
    /actual Ed25519 public key|key type/i,
  );
  const result = verifyP13ActivationGrant({
    request: req,
    grant,
    authority,
    trustedAuthoritySha256: trusted,
    now: new Date('2026-10-24T01:05:00.000Z'),
  });
  assert.equal(result.grantVerified, false);
  assert.equal(result.checks.authority_contract, false);
});

test('valid Ed25519 grant verifies only with the exact external authority hash', () => {
  const req = request();
  const { authority, privateKey } = authorityFixture();
  const grant = signedGrant({ req, authority, privateKey });
  const trusted = hashP13AuthorityDescriptor(authority);

  const ok = verifyP13ActivationGrant({
    request: req,
    grant,
    authority,
    trustedAuthoritySha256: trusted,
    now: new Date('2026-10-24T01:05:00.000Z'),
  });
  assert.equal(ok.grantVerified, true, JSON.stringify(ok));
  assert.deepEqual(ok.blockers, []);
  assert.equal(Object.values(ok.checks).every(Boolean), true);

  for (const badTrusted of [undefined, null, '', 'c'.repeat(64)]) {
    const result = verifyP13ActivationGrant({
      request: req,
      grant,
      authority,
      trustedAuthoritySha256: badTrusted,
      now: new Date('2026-10-24T01:05:00.000Z'),
    });
    assert.equal(result.grantVerified, false);
    assert.match(result.blockers.join('\n'), /trusted authority/i);
  }
});

test('signed semantic drift fails closed even when the attacker re-signs it', () => {
  const req = request();
  const { authority, privateKey } = authorityFixture();
  const trusted = hashP13AuthorityDescriptor(authority);
  const variants = [
    { p12_evidence_head: '0'.repeat(40) },
    { p12_binding_hash: '0'.repeat(64) },
    { request_hash: '0'.repeat(64) },
    { target: { ...TARGET, project_ref: 'wrong' } },
    { profile: 'standard' },
    { activation_flag: 'OTHER_FLAG' },
    { activation_value: 'legacy' },
    { issuer: 'other-authority' },
    { key_id: 'other-key' },
    { signature_algorithm: 'RSA' },
  ];
  for (const patch of variants) {
    const grant = signedGrant({ req, authority, privateKey, patch });
    const result = verifyP13ActivationGrant({
      request: req,
      grant,
      authority,
      trustedAuthoritySha256: trusted,
      now: new Date('2026-10-24T01:05:00.000Z'),
    });
    assert.equal(result.grantVerified, false, JSON.stringify(patch));
  }
});

test('time, nonce, malformed signature, and overlong lifetime fail closed', () => {
  const req = request();
  const { authority, privateKey } = authorityFixture();
  const trusted = hashP13AuthorityDescriptor(authority);
  const cases = [
    { patch: { nonce: 'short' }, now: '2026-10-24T01:05:00.000Z' },
    { patch: { not_before: '2026-10-24T01:10:00.000Z' }, now: '2026-10-24T01:05:00.000Z' },
    { patch: { expires_at: '2026-10-24T01:04:00.000Z' }, now: '2026-10-24T01:05:00.000Z' },
    { patch: { expires_at: '2026-10-24T01:15:00.001Z' }, now: '2026-10-24T01:05:00.000Z' },
    { patch: { not_before: '2026-10-24T00:59:59.999Z' }, now: '2026-10-24T01:05:00.000Z' },
    { patch: { issued_at: 'October 24, 2026 01:00 UTC' }, now: '2026-10-24T01:05:00.000Z' },
    { patch: { expires_at: '2026-10-24T03:15:00+02:00' }, now: '2026-10-24T01:05:00.000Z' },
  ];
  for (const { patch, now } of cases) {
    const result = verifyP13ActivationGrant({
      request: req,
      grant: signedGrant({ req, authority, privateKey, patch }),
      authority,
      trustedAuthoritySha256: trusted,
      now: new Date(now),
    });
    assert.equal(result.grantVerified, false, JSON.stringify(patch));
  }

  const grant = signedGrant({ req, authority, privateKey });
  const invalidSignature = { ...grant, signature_base64: Buffer.alloc(64, 1).toString('base64') };
  const bad = verifyP13ActivationGrant({
    request: req,
    grant: invalidSignature,
    authority,
    trustedAuthoritySha256: trusted,
    now: new Date('2026-10-24T01:05:00.000Z'),
  });
  assert.equal(bad.grantVerified, false);
  assert.match(bad.blockers.join('\n'), /signature/i);
});
