import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

export const P12_EVIDENCE_HEAD = '5f676c806ae864b507723ea867f5e3afd6fd4adb';
export const P12_BINDING_HASH = '68930447847df8d31de01b7fb60049136ae6fd0d74c837283fb837ff7e79961b';
export const P13_MAX_GRANT_LIFETIME_MS = 15 * 60 * 1000;

const TARGET = Object.freeze({
  purpose: 'agent-hub-reference-graph',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
});

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function requireNonEmpty(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function requireSha256(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new TypeError(`${name} must be a 64-character SHA-256 hex digest`);
  }
  return value.toLowerCase();
}

function sortedClone(value) {
  if (Array.isArray(value)) return value.map(sortedClone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedClone(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(sortedClone(value));
}

function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function sameValue(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

function p12ReceiptReady(receipt) {
  const value = requireObject(receipt, 'P12 receipt');
  const binding = requireObject(value.activation_binding, 'P12 activation binding');
  const blockers = value.blockers;
  return value.schema_version === 'reference-graph.p12-activation-authority.v1'
    && value.binding_hash === P12_BINDING_HASH
    && value.preflight_ready === true
    && value.grant_state === 'not-issued'
    && value.activation_authorized === false
    && value.activation_performed === false
    && value.repository_default_graph_enabled === false
    && value.production_source === 'legacy-control'
    && Array.isArray(blockers)
    && blockers.length === 0
    && value.profile_support?.quick === 'preflight-ready'
    && value.profile_support?.standard === 'legacy-only'
    && value.profile_support?.deep === 'legacy-only'
    && sameValue(value.target, TARGET)
    && binding.schema_version === 'reference-graph.p12-activation-binding.v1'
    && sameValue(binding.target, TARGET)
    && binding.profile === 'quick'
    && binding.activation_flag === 'REFERENCE_GRAPH_QUICK_RUNTIME'
    && binding.activation_value === 'graph'
    && binding.runtime_auth_mode === 'publishable'
    && binding.service_role_runtime_allowed === false
    && binding.timeout_ms === 1500
    && binding.legacy_first === true
    && binding.record_parity_required === 'exact-ordered'
    && binding.pattern_parity_required === 'exact-ordered'
    && binding.fallback_source === 'legacy-control'
    && binding.standard_mode === 'legacy-only'
    && binding.deep_mode === 'legacy-only'
    && binding.repository_default_graph_enabled === false
    && binding.rollback_action === 'unset-or-change-REFERENCE_GRAPH_QUICK_RUNTIME';
}

function requestReady(request) {
  try {
    const value = requireObject(request, 'request');
    requireSha256(value.p12_evidence_sha256, 'p12 evidence SHA-256');
    return value.schema_version === 'reference-graph.p13-activation-grant-request.v1'
      && value.p12_evidence_head === P12_EVIDENCE_HEAD
      && value.p12_binding_hash === P12_BINDING_HASH
      && sameValue(value.target, TARGET)
      && value.profile === 'quick'
      && value.activation_flag === 'REFERENCE_GRAPH_QUICK_RUNTIME'
      && value.activation_value === 'graph'
      && value.runtime_auth_mode === 'publishable'
      && value.timeout_ms === 1500
      && value.legacy_first === true
      && value.record_parity_required === 'exact-ordered'
      && value.pattern_parity_required === 'exact-ordered'
      && value.fallback_source === 'legacy-control'
      && value.standard_mode === 'legacy-only'
      && value.deep_mode === 'legacy-only'
      && value.repository_default_graph_enabled_before === false
      && value.production_source_before === 'legacy-control'
      && value.rollback_action === 'unset-or-change-REFERENCE_GRAPH_QUICK_RUNTIME';
  } catch {
    return false;
  }
}

function validateAuthority(authority) {
  const value = requireObject(authority, 'authority');
  if (value.schema_version !== 'reference-graph.p13-ed25519-authority.v1') {
    throw new Error('authority schema must be reference-graph.p13-ed25519-authority.v1');
  }
  requireNonEmpty(value.authority_id, 'authority id');
  requireNonEmpty(value.key_id, 'authority key id');
  if (value.algorithm !== 'Ed25519') {
    throw new Error('authority algorithm must be Ed25519');
  }
  requireNonEmpty(value.public_key_spki_base64, 'authority public key');
  createPublicKey({
    key: Buffer.from(value.public_key_spki_base64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  return value;
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function unique(values) {
  return [...new Set(values)];
}

export function createP13GrantRequest({ p12Receipt, p12EvidenceSha256 } = {}) {
  if (!p12ReceiptReady(p12Receipt)) {
    throw new Error('P12 receipt does not match the frozen preflight-ready non-authorizing contract');
  }
  const binding = p12Receipt.activation_binding;
  return {
    schema_version: 'reference-graph.p13-activation-grant-request.v1',
    p12_evidence_head: P12_EVIDENCE_HEAD,
    p12_binding_hash: P12_BINDING_HASH,
    p12_evidence_sha256: requireSha256(p12EvidenceSha256, 'P12 evidence SHA-256'),
    target: structuredClone(TARGET),
    profile: binding.profile,
    activation_flag: binding.activation_flag,
    activation_value: binding.activation_value,
    runtime_auth_mode: binding.runtime_auth_mode,
    timeout_ms: binding.timeout_ms,
    legacy_first: binding.legacy_first,
    record_parity_required: binding.record_parity_required,
    pattern_parity_required: binding.pattern_parity_required,
    fallback_source: binding.fallback_source,
    standard_mode: binding.standard_mode,
    deep_mode: binding.deep_mode,
    repository_default_graph_enabled_before: false,
    production_source_before: 'legacy-control',
    rollback_action: binding.rollback_action,
  };
}

export function hashP13GrantRequest(request) {
  requireObject(request, 'request');
  return sha256Canonical(request);
}

export function hashP13AuthorityDescriptor(authority) {
  validateAuthority(authority);
  return sha256Canonical(authority);
}

export function verifyP13ActivationGrant({
  request,
  grant,
  authority,
  trustedAuthoritySha256,
  now,
} = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new TypeError('now must be a valid Date');
  }

  const req = request && typeof request === 'object' && !Array.isArray(request) ? request : {};
  const value = grant && typeof grant === 'object' && !Array.isArray(grant) ? grant : {};
  let authorityHash = null;
  let authorityValid = false;
  let publicKey = null;
  try {
    const normalizedAuthority = validateAuthority(authority);
    authorityHash = sha256Canonical(normalizedAuthority);
    publicKey = createPublicKey({
      key: Buffer.from(normalizedAuthority.public_key_spki_base64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    authorityValid = true;
  } catch {
    authorityValid = false;
  }

  const trustedAuthorityPresent = typeof trustedAuthoritySha256 === 'string'
    && /^[0-9a-f]{64}$/i.test(trustedAuthoritySha256);
  const trustedAuthority = trustedAuthorityPresent
    && authorityHash !== null
    && trustedAuthoritySha256.toLowerCase() === authorityHash;

  const issuedAt = parseTimestamp(value.issued_at);
  const notBefore = parseTimestamp(value.not_before);
  const expiresAt = parseTimestamp(value.expires_at);
  const timestampsValid = issuedAt !== null && notBefore !== null && expiresAt !== null;
  const timestampOrder = timestampsValid && issuedAt <= notBefore && notBefore <= expiresAt;
  const current = timestampOrder && notBefore <= now.getTime() && now.getTime() <= expiresAt;
  const lifetime = timestampOrder
    && expiresAt - issuedAt > 0
    && expiresAt - issuedAt <= P13_MAX_GRANT_LIFETIME_MS;

  const expectedRequestHash = requestReady(req) ? hashP13GrantRequest(req) : null;
  const grantPayload = { ...value };
  delete grantPayload.signature_base64;

  let signatureValid = false;
  if (
    authorityValid
    && value.signature_algorithm === 'Ed25519'
    && typeof value.signature_base64 === 'string'
    && value.signature_base64.length > 0
  ) {
    try {
      signatureValid = verifySignature(
        null,
        Buffer.from(canonicalJson(grantPayload), 'utf8'),
        publicKey,
        Buffer.from(value.signature_base64, 'base64'),
      );
    } catch {
      signatureValid = false;
    }
  }

  const checks = {
    request_contract: requestReady(req),
    authority_contract: authorityValid,
    trusted_authority_present: trustedAuthorityPresent,
    trusted_authority_match: trustedAuthority,
    grant_contract: value.schema_version === 'reference-graph.p13-activation-grant.v1',
    request_hash: expectedRequestHash !== null && value.request_hash === expectedRequestHash,
    p12_evidence_head: value.p12_evidence_head === P12_EVIDENCE_HEAD,
    p12_binding_hash: value.p12_binding_hash === P12_BINDING_HASH,
    target: sameValue(value.target, TARGET),
    scope:
      value.profile === 'quick'
      && value.activation_flag === 'REFERENCE_GRAPH_QUICK_RUNTIME'
      && value.activation_value === 'graph',
    issuer_key:
      authorityValid
      && value.issuer === authority.authority_id
      && value.key_id === authority.key_id,
    timestamp_order: timestampOrder,
    grant_current: current,
    grant_lifetime: lifetime,
    nonce: typeof value.nonce === 'string' && /^[0-9a-f]{64}$/.test(value.nonce),
    signature_algorithm: value.signature_algorithm === 'Ed25519',
    signature_valid: signatureValid,
  };

  const blockerByCheck = {
    request_contract: 'P13 grant request does not match the frozen P12 contract',
    authority_contract: 'authority descriptor is not a valid Ed25519 authority',
    trusted_authority_present: 'trusted authority SHA-256 is required',
    trusted_authority_match: 'trusted authority SHA-256 does not match authority descriptor',
    grant_contract: 'grant schema is invalid',
    request_hash: 'grant request hash does not match the canonical P13 request',
    p12_evidence_head: 'grant P12 evidence head does not match the final P12 evidence head',
    p12_binding_hash: 'grant P12 binding hash does not match the frozen P12 binding',
    target: 'grant target does not match the P12 target',
    scope: 'grant scope is not the frozen quick-only activation scope',
    issuer_key: 'grant issuer or key id does not match the trusted authority descriptor',
    timestamp_order: 'grant timestamps are invalid or out of order',
    grant_current: 'grant is not currently valid',
    grant_lifetime: 'grant lifetime must be greater than zero and at most 15 minutes',
    nonce: 'grant nonce must be 32 bytes encoded as lowercase hex',
    signature_algorithm: 'grant signature algorithm must be Ed25519',
    signature_valid: 'grant signature is invalid',
  };

  const blockers = unique(
    Object.entries(checks)
      .filter(([, passed]) => passed !== true)
      .map(([name]) => blockerByCheck[name]),
  );

  return {
    grantVerified: blockers.length === 0,
    requestHash: expectedRequestHash,
    authorityHash,
    checks,
    blockers,
  };
}
