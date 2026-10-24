import {
  createHash,
  createPublicKey,
  randomBytes,
} from 'node:crypto';

import { hashP13AuthorityDescriptor } from './p13-activation-grant-authority.mjs';
import {
  P13_EVIDENCE_SHA256,
  createP14EnrollmentManifest,
  createP14UnsignedGrantPayload,
  hashP14GrantPayload,
  verifyP14SignedGrant,
} from './p14-authority-enrollment-grant.mjs';
import { readP17ActivationState } from './p17-local-runtime-actuator.mjs';

const TEN_MINUTES_MS = 10 * 60 * 1000;
const PRODUCTION_PROJECT_REF = 'vrznfnxzlxaavpqbzbzd';
const PRODUCTION_SUPABASE_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function optionalNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function requireDate(value, name = 'now') {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError(`${name} must be a valid Date`);
  }
  return value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeSpkiDer(value) {
  const der = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  if (der.length === 0) throw new TypeError('publicKeySpkiDer must contain SPKI DER bytes');
  let key;
  try {
    key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    throw new TypeError('publicKeySpkiDer must be a valid Ed25519 SPKI DER public key');
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('publicKeySpkiDer must be an Ed25519 SPKI public key');
  }
  return der;
}

function unsignedGrant(grant) {
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) {
    throw new TypeError('grant must be an object');
  }
  const { signature_base64: _signature, ...payload } = grant;
  return payload;
}

export function createP18AuthorityDescriptor({
  publicKeySpkiDer,
  authorityId,
  keyId,
} = {}) {
  const der = normalizeSpkiDer(publicKeySpkiDer);
  return {
    schema_version: 'reference-graph.p13-ed25519-authority.v1',
    authority_id: requireNonEmptyString(authorityId, 'authorityId'),
    key_id: requireNonEmptyString(keyId, 'keyId'),
    algorithm: 'Ed25519',
    public_key_spki_base64: der.toString('base64'),
  };
}

export function hashP18AuthorityDescriptor(authority) {
  return hashP13AuthorityDescriptor(authority);
}

export function createP18GrantArtifacts({
  p13Evidence,
  authority,
  approvedAuthoritySha256,
  now = new Date(),
  nonce,
} = {}) {
  const current = requireDate(now);
  const enrollmentManifest = createP14EnrollmentManifest({
    p13Evidence,
    p13EvidenceSha256: P13_EVIDENCE_SHA256,
    authority,
    approvedAuthoritySha256,
  });
  const grantNonce = nonce ?? randomBytes(32).toString('hex');
  const issuedAt = current.toISOString();
  const grantPayload = createP14UnsignedGrantPayload({
    p13Evidence,
    enrollmentManifest,
    issuedAt,
    notBefore: issuedAt,
    expiresAt: new Date(current.valueOf() + TEN_MINUTES_MS).toISOString(),
    nonce: grantNonce,
  });
  const canonicalPayloadUtf8 = canonicalJson(grantPayload);
  const payloadSha256 = hashP14GrantPayload(grantPayload);
  const directHash = createHash('sha256')
    .update(canonicalPayloadUtf8, 'utf8')
    .digest('hex');
  if (directHash !== payloadSha256) {
    throw new Error('P18 canonical payload bytes do not match the P14 payload hash');
  }
  return {
    enrollment_manifest: enrollmentManifest,
    grant_payload: grantPayload,
    canonical_payload_utf8: canonicalPayloadUtf8,
    payload_sha256: payloadSha256,
  };
}

export function assembleAndVerifyP18Grant({
  p13Evidence,
  authority,
  approvedAuthoritySha256,
  grantPayload,
  signature,
  now = new Date(),
} = {}) {
  const current = requireDate(now);
  const signatureBytes = Buffer.isBuffer(signature)
    ? signature
    : Buffer.from(signature ?? []);
  if (signatureBytes.length !== 64) {
    throw new TypeError('signature must be a 64-byte Ed25519 signature');
  }
  const enrollmentManifest = createP14EnrollmentManifest({
    p13Evidence,
    p13EvidenceSha256: P13_EVIDENCE_SHA256,
    authority,
    approvedAuthoritySha256,
  });
  const grant = {
    ...structuredClone(grantPayload),
    signature_base64: signatureBytes.toString('base64'),
  };
  const verification = verifyP14SignedGrant({
    p13Evidence,
    enrollmentManifest,
    grant,
    now: current,
  });
  if (!verification.grantVerified || !verification.activationAuthorized) {
    throw new Error('P18 signed grant did not verify against the approved authority');
  }
  return { grant, verification };
}

export async function preflightP18ProductionActivation({
  p13Evidence,
  authority,
  approvedAuthoritySha256,
  grant,
  env = process.env,
  statePath,
  now = new Date(),
} = {}) {
  const current = requireDate(now);
  const suppliedUrl = requireNonEmptyString(env.SUPABASE_URL, 'SUPABASE_URL')
    .replace(/\/+$/, '');
  if (suppliedUrl !== PRODUCTION_SUPABASE_URL) {
    throw new Error(`P18 production target must be project ${PRODUCTION_PROJECT_REF}`);
  }

  requireNonEmptyString(env.SUPABASE_PUBLISHABLE_KEY, 'SUPABASE_PUBLISHABLE_KEY');
  const modernSecret = optionalNonEmptyString(env.SUPABASE_SECRET_KEY);
  const legacyElevated = optionalNonEmptyString(env.SUPABASE_SERVICE_ROLE_KEY);
  const elevatedKeyType = modernSecret
    ? 'secret'
    : legacyElevated
      ? 'legacy-service-role'
      : null;
  if (!elevatedKeyType) {
    throw new Error('P18 production preflight requires an elevated secret or legacy service-role key');
  }

  const enrollmentManifest = createP14EnrollmentManifest({
    p13Evidence,
    p13EvidenceSha256: P13_EVIDENCE_SHA256,
    authority,
    approvedAuthoritySha256,
  });
  const verification = verifyP14SignedGrant({
    p13Evidence,
    enrollmentManifest,
    grant,
    now: current,
  });
  if (!verification.grantVerified || !verification.activationAuthorized) {
    throw new Error('P18 production grant verification failed or grant is expired');
  }

  const localState = await readP17ActivationState({ statePath });
  const validLegacyState = localState.production_source === 'legacy-control'
    && localState.quick_graph_enabled === false
    && localState.repository_default_graph_enabled === false;
  if (!validLegacyState) {
    throw new Error('P18 production activation requires a legacy local pre-state');
  }

  return {
    preflight_ready: true,
    target_project_ref: PRODUCTION_PROJECT_REF,
    elevated_key_type: elevatedKeyType,
    grant_verified: true,
    activation_authorized: true,
    authority_hash: enrollmentManifest.authority_sha256,
    request_hash: verification.requestHash,
    grant_payload_hash: hashP14GrantPayload(unsignedGrant(grant)),
    production_source: localState.production_source,
    quick_graph_enabled: localState.quick_graph_enabled,
    repository_default_graph_enabled: localState.repository_default_graph_enabled,
  };
}
