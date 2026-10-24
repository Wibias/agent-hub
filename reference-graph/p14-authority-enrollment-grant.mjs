import { createHash } from 'node:crypto';

import {
  hashP13AuthorityDescriptor,
  hashP13GrantRequest,
  verifyP13ActivationGrant,
} from './p13-activation-grant-authority.mjs';

export const P13_EVIDENCE_HEAD = 'bbd29fbe596801fdb7594f45045cb41e9c9b1a5b';
export const P13_REQUEST_HASH = 'ed31630f9bda1362f42e747a6366d8504d17638b8ba458228db6fec5a2074ce7';
export const P13_EVIDENCE_SHA256 = '0000000000000000000000000000000000000000000000000000000000000000';
export const P14_MAX_GRANT_LIFETIME_MS = 15 * 60 * 1000;

const ENROLLMENT_KEYS = Object.freeze([
  'activation_flag',
  'activation_value',
  'approved_authority_sha256',
  'authority',
  'authority_sha256',
  'environment',
  'p13_evidence_head',
  'p13_evidence_sha256',
  'p13_request_hash',
  'private_key_custody',
  'private_key_present',
  'profile',
  'schema_version',
  'target',
]);

const UNSIGNED_GRANT_KEYS = Object.freeze([
  'activation_flag',
  'activation_value',
  'expires_at',
  'issued_at',
  'issuer',
  'key_id',
  'nonce',
  'not_before',
  'p12_binding_hash',
  'p12_evidence_head',
  'profile',
  'request_hash',
  'schema_version',
  'signature_algorithm',
  'target',
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function requireLowerSha256(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a lowercase 64-character SHA-256 hex digest`);
  }
  return value;
}

function requireCanonicalTimestamp(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a canonical UTC ISO timestamp`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new TypeError(`${name} must be a canonical UTC ISO timestamp`);
  }
  return parsed.valueOf();
}

function assertP13Evidence(p13Evidence, p13EvidenceSha256) {
  const evidence = requireObject(p13Evidence, 'P13 evidence');
  const digest = requireLowerSha256(p13EvidenceSha256, 'P13 evidence SHA-256');
  const checks = evidence.checks;
  const request = evidence.grant_request;
  const valid = digest === P13_EVIDENCE_SHA256
    && evidence.schema_version === 'reference-graph.p13-activation-grant-authority.v1'
    && evidence.request_hash === P13_REQUEST_HASH
    && evidence.infrastructure_ready === true
    && evidence.authority_state === 'unconfigured'
    && evidence.trusted_authority_sha256 === null
    && evidence.grant_state === 'not-issued'
    && evidence.grant_verified === false
    && evidence.activation_authorized === false
    && evidence.activation_performed === false
    && evidence.repository_default_graph_enabled === false
    && evidence.production_source === 'legacy-control'
    && Array.isArray(evidence.blockers)
    && evidence.blockers.length === 0
    && checks && typeof checks === 'object'
    && !Array.isArray(checks)
    && Object.values(checks).every((value) => value === true)
    && request && typeof request === 'object'
    && hashP13GrantRequest(request) === P13_REQUEST_HASH
    && request.profile === 'quick'
    && request.activation_flag === 'REFERENCE_GRAPH_QUICK_RUNTIME'
    && request.activation_value === 'graph'
    && request.production_source_before === 'legacy-control'
    && request.repository_default_graph_enabled_before === false;
  if (!valid) {
    throw new Error('P13 evidence does not match the frozen pre-ceremony contract');
  }
  return evidence;
}

function validateEnrollmentManifest(p13Evidence, enrollmentManifest) {
  const manifest = requireObject(enrollmentManifest, 'P14 enrollment manifest');
  if (!hasExactKeys(manifest, ENROLLMENT_KEYS)) {
    throw new Error('P14 enrollment manifest must contain the exact authority enrollment fields');
  }
  if (manifest.schema_version !== 'reference-graph.p14-authority-enrollment.v1') {
    throw new Error('P14 enrollment manifest schema is invalid');
  }
  if (manifest.p13_evidence_head !== P13_EVIDENCE_HEAD
      || manifest.p13_evidence_sha256 !== P13_EVIDENCE_SHA256
      || manifest.p13_request_hash !== P13_REQUEST_HASH) {
    throw new Error('P14 enrollment manifest P13 binding is invalid');
  }
  if (canonicalJson(manifest.target) !== canonicalJson(p13Evidence.target)
      || manifest.profile !== 'quick'
      || manifest.activation_flag !== 'REFERENCE_GRAPH_QUICK_RUNTIME'
      || manifest.activation_value !== 'graph') {
    throw new Error('P14 enrollment manifest activation scope is invalid');
  }
  const authorityHash = hashP13AuthorityDescriptor(manifest.authority);
  if (manifest.authority_sha256 !== authorityHash
      || manifest.approved_authority_sha256 !== authorityHash) {
    throw new Error('P14 enrollment manifest approved authority hash is invalid');
  }
  if (manifest.environment !== 'production'
      || manifest.private_key_custody !== 'external'
      || manifest.private_key_present !== false) {
    throw new Error('P14 enrollment manifest private-key custody contract is invalid');
  }
  return manifest;
}

function validateUnsignedPayload(payload) {
  const value = requireObject(payload, 'P14 unsigned grant payload');
  if (!hasExactKeys(value, UNSIGNED_GRANT_KEYS)) {
    throw new Error('P14 unsigned grant payload must contain the exact fields');
  }
  return value;
}

export function createP14EnrollmentManifest({
  p13Evidence,
  p13EvidenceSha256,
  authority,
  approvedAuthoritySha256,
} = {}) {
  const evidence = assertP13Evidence(p13Evidence, p13EvidenceSha256);
  const authorityHash = hashP13AuthorityDescriptor(authority);
  const approved = requireLowerSha256(approvedAuthoritySha256, 'approved authority SHA-256');
  if (approved !== authorityHash) {
    throw new Error('independent approved authority SHA-256 does not match the authority descriptor');
  }
  return {
    schema_version: 'reference-graph.p14-authority-enrollment.v1',
    p13_evidence_head: P13_EVIDENCE_HEAD,
    p13_evidence_sha256: P13_EVIDENCE_SHA256,
    p13_request_hash: P13_REQUEST_HASH,
    target: structuredClone(evidence.target),
    profile: 'quick',
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_value: 'graph',
    authority: structuredClone(authority),
    authority_sha256: authorityHash,
    approved_authority_sha256: approved,
    environment: 'production',
    private_key_custody: 'external',
    private_key_present: false,
  };
}

export function createP14UnsignedGrantPayload({
  p13Evidence,
  enrollmentManifest,
  issuedAt,
  notBefore,
  expiresAt,
  nonce,
} = {}) {
  const evidence = requireObject(p13Evidence, 'P13 evidence');
  const enrollment = validateEnrollmentManifest(evidence, enrollmentManifest);
  const issued = requireCanonicalTimestamp(issuedAt, 'issued_at');
  const notBeforeMs = requireCanonicalTimestamp(notBefore, 'not_before');
  const expires = requireCanonicalTimestamp(expiresAt, 'expires_at');
  if (!(issued <= notBeforeMs && notBeforeMs <= expires)) {
    throw new Error('grant timestamps must satisfy issued_at <= not_before <= expires_at');
  }
  if (expires - issued <= 0 || expires - issued > P14_MAX_GRANT_LIFETIME_MS) {
    throw new Error('grant lifetime must be greater than zero and at most 15 minutes');
  }
  if (typeof nonce !== 'string' || !/^[0-9a-f]{64}$/.test(nonce)) {
    throw new Error('grant nonce must be 32 bytes encoded as lowercase hex');
  }
  const request = requireObject(evidence.grant_request, 'P13 grant request');
  if (hashP13GrantRequest(request) !== P13_REQUEST_HASH) {
    throw new Error('P13 request hash does not match the frozen request');
  }
  return {
    schema_version: 'reference-graph.p13-activation-grant.v1',
    request_hash: P13_REQUEST_HASH,
    p12_evidence_head: request.p12_evidence_head,
    p12_binding_hash: request.p12_binding_hash,
    target: structuredClone(evidence.target),
    profile: 'quick',
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_value: 'graph',
    issuer: enrollment.authority.authority_id,
    key_id: enrollment.authority.key_id,
    issued_at: issuedAt,
    not_before: notBefore,
    expires_at: expiresAt,
    nonce,
    signature_algorithm: 'Ed25519',
  };
}

export function hashP14GrantPayload(payload) {
  validateUnsignedPayload(payload);
  return sha256Canonical(payload);
}

export function verifyP14SignedGrant({
  p13Evidence,
  enrollmentManifest,
  grant,
  now,
} = {}) {
  const evidence = requireObject(p13Evidence, 'P13 evidence');
  const enrollment = validateEnrollmentManifest(evidence, enrollmentManifest);
  const result = verifyP13ActivationGrant({
    request: evidence.grant_request,
    grant,
    authority: enrollment.authority,
    trustedAuthoritySha256: enrollment.approved_authority_sha256,
    now,
  });
  return {
    grantVerified: result.grantVerified,
    activationAuthorized: result.grantVerified,
    activationPerformed: false,
    repositoryDefaultGraphEnabled: false,
    productionSource: 'legacy-control',
    requestHash: result.requestHash,
    authorityHash: result.authorityHash,
    checks: result.checks,
    blockers: result.blockers,
  };
}
