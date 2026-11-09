import { createHash, createPublicKey, verify } from 'node:crypto';

const SHA256 = /^[a-f0-9]{64}$/;
const HEX40 = /^[a-f0-9]{40}$/;
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TARGET = 'vrznfnxzlxaavpqbzbzd';
const MAX_WINDOW_MS = 60 * 60 * 1000;
const MAX_SKEW_MS = 60 * 1000;
const GRANT_KEYS = ['schema_version', 'payload_json', 'signature_base64'];
const PAYLOAD_KEYS = [
  'schema_version', 'repository', 'repository_sha', 'project_ref',
  'profiles', 'not_before', 'expires_at', 'evidence_sha256',
  'rollback_plan_sha256', 'operator_id', 'nonce',
  'mode', 'canary_percent', 'default_off',
];
const TRIGGERS = new Set([
  'manual-revoke', 'signature-invalid', 'evidence-expired',
  'source-stale', 'http-error', 'timeout', 'parity-mismatch',
  'quality-regression', 'latency-budget', 'critical-monitor',
  'rollback-drill',
]);

function exact(value, keys) {
  return value !== null && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
}
function instant(value) {
  return typeof value === 'string' && UTC.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

/**
 * Non-authorizing validator for a future P40 Standard/Deep canary grant.
 * The trusted key fingerprint must be pinned by a SEPARATE reviewed trust
 * store. This function cannot attest that key's authority, cannot consume
 * nonces and NEVER enables a route, even if the signature is valid.
 */
export function evaluateP40ScopedGrant({
  grant,
  trustedPublicKeyPem,
  trustedPublicKeySha256,
  expectedRepositorySha,
  now = new Date(),
} = {}) {
  const blocked = (reason, signatureValid = false) => ({
    schema_version: 'reference-graph.p40-scoped-grant-preflight.v1',
    signature_valid: signatureValid,
    contract_valid: false,
    reason,
    trust_anchor_independently_attested: false,
    grant_nonce_consumed: false,
    rollback_rehearsed: false,
    activation_authorized: false,
    repository_default_graph_enabled: false,
  });
  if (!exact(grant, GRANT_KEYS)
    || grant.schema_version !== 'reference-graph.p40-signed-grant.v1'
    || typeof grant.payload_json !== 'string'
    || grant.payload_json.length < 1 || grant.payload_json.length > 8192
    || typeof grant.signature_base64 !== 'string'
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(grant.signature_base64)
    || typeof trustedPublicKeyPem !== 'string'
    || !SHA256.test(trustedPublicKeySha256 ?? '')
    || !HEX40.test(expectedRepositorySha ?? '')
    || !(now instanceof Date) || Number.isNaN(now.valueOf())) {
    return blocked('invalid-contract');
  }
  let payload, publicKey, signature;
  try {
    payload = JSON.parse(grant.payload_json);
    publicKey = createPublicKey(trustedPublicKeyPem);
    signature = Buffer.from(grant.signature_base64, 'base64');
    if (publicKey.asymmetricKeyType !== 'ed25519' || signature.length !== 64) {
      return blocked('invalid-key-or-signature');
    }
    const fingerprint = createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
    if (fingerprint !== trustedPublicKeySha256) return blocked('key-fingerprint-mismatch');
    if (!verify(null, Buffer.from(grant.payload_json, 'utf8'), publicKey, signature)) {
      return blocked('signature-invalid');
    }
  } catch {
    return blocked('signature-invalid');
  }

  if (!exact(payload, PAYLOAD_KEYS)
    || payload.schema_version !== 'reference-graph.p40-canary-scope.v1'
    || payload.repository !== 'Wibias/agent-hub'
    || payload.repository_sha !== expectedRepositorySha
    || payload.project_ref !== TARGET
    || !Array.isArray(payload.profiles)
    || payload.profiles.length < 1 || payload.profiles.length > 2
    || payload.profiles.some(p => !['standard', 'deep'].includes(p))
    || new Set(payload.profiles).size !== payload.profiles.length
    || !instant(payload.not_before) || !instant(payload.expires_at)
    || !SHA256.test(payload.evidence_sha256 ?? '')
    || !SHA256.test(payload.rollback_plan_sha256 ?? '')
    || typeof payload.operator_id !== 'string'
    || !/^[A-Za-z0-9_-]{3,64}$/.test(payload.operator_id)
    || !NONCE.test(payload.nonce ?? '')
    || payload.mode !== 'canary'
    || !Number.isInteger(payload.canary_percent)
    || payload.canary_percent < 1 || payload.canary_percent > 5
    || payload.default_off !== true) {
    return blocked('scope-invalid', true);
  }
  const start = Date.parse(payload.not_before);
  const end = Date.parse(payload.expires_at);
  if (end <= start || end - start > MAX_WINDOW_MS
    || now.valueOf() < start - MAX_SKEW_MS
    || now.valueOf() >= end) {
    return blocked('window-invalid', true);
  }

  return {
    schema_version: 'reference-graph.p40-scoped-grant-preflight.v1',
    signature_valid: true,
    contract_valid: true,
    reason: 'trust-and-release-authority-not-proven',
    trust_anchor_independently_attested: false,
    grant_nonce_consumed: false,
    rollback_rehearsed: false,
    activation_authorized: false,
    repository_default_graph_enabled: false,
  };
}

/**
 * Reviewable rollback DECISION only, not an actuator.
 * Every relevant failure maps to protected Legacy output and a disabled
 * Standard/Deep transport. Only the separately governed release controller
 * may actually change runtime state.
 */
export function planP40FailClosedRollback({ profile, trigger } = {}) {
  if (!['standard', 'deep'].includes(profile) || !TRIGGERS.has(trigger)) {
    throw new TypeError('P40 rollback requires an allowlisted profile and trigger');
  }
  return {
    schema_version: 'reference-graph.p40-rollback-plan.v1',
    profile,
    reason: trigger,
    authoritative_source: 'legacy-control',
    transport_enabled: false,
    suppress_new_graph_requests: true,
    restore_runtime_state: 'legacy',
    quick_profile_unchanged: true,
    changes_applied: false,
    activation_authorized: false,
    repository_default_graph_enabled: false,
  };
}
