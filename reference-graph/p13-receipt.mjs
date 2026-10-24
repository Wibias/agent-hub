import {
  P12_BINDING_HASH,
  P12_EVIDENCE_HEAD,
  hashP13GrantRequest,
} from './p13-activation-grant-authority.mjs';

export const P13_PHASES = Object.freeze([
  'p12_binding',
  'authority_policy',
  'grant_verifier',
  'activation_boundary',
]);

const PHASE_STATUSES = new Set(['pending', 'success', 'failed', 'skipped', 'unavailable']);
const CREDENTIAL_KEY_RE = /^(?:authorization|password|access[_-]?token|bearer[_-]?token|secret(?:[_-]?key)?|private[_-]?key|jwt|(?:.*[_-])?service[_-]?role(?:[_-](?:api[_-]?)?)?(?:key|secret|password|token))$/i;

function clone(value) {
  return structuredClone(value);
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function requireGitSha(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) {
    throw new TypeError(`${name} must be a 40-character commit SHA`);
  }
  return value.toLowerCase();
}

function requireSha256(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new TypeError(`${name} must be a 64-character SHA-256 hex digest`);
  }
  return value.toLowerCase();
}

function requireIsoTimestamp(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be an ISO timestamp`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new TypeError(`${name} must be an ISO timestamp`);
  }
  return parsed.toISOString();
}

function requestReady(request) {
  try {
    const value = requireObject(request, 'grant request');
    return value.schema_version === 'reference-graph.p13-activation-grant-request.v1'
      && value.p12_evidence_head === P12_EVIDENCE_HEAD
      && value.p12_binding_hash === P12_BINDING_HASH
      && requireSha256(value.p12_evidence_sha256, 'P12 evidence SHA-256') === value.p12_evidence_sha256.toLowerCase()
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

function phaseIndex(phase) {
  const index = P13_PHASES.indexOf(phase);
  if (index === -1) throw new Error(`unknown P13 phase: ${phase}`);
  return index;
}

function unique(values) {
  return [...new Set(
    values
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function scanCredentialKeys(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanCredentialKeys(entry, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (CREDENTIAL_KEY_RE.test(key)) {
      throw new Error(`credential or private-key shaped field is forbidden in P13 receipt: ${[...path, key].join('.')}`);
    }
    scanCredentialKeys(entry, [...path, key]);
  }
}

export function createP13Receipt({
  grantRequest,
  gitSha,
  verificationAt,
  referenceTime,
} = {}) {
  if (!requestReady(grantRequest)) {
    throw new Error('grant request does not match the exact P12-bound P13 contract');
  }
  const request = clone(grantRequest);
  return {
    schema_version: 'reference-graph.p13-activation-grant-authority.v1',
    p12_evidence_head: P12_EVIDENCE_HEAD,
    p12_binding_hash: P12_BINDING_HASH,
    p12_evidence_sha256: requireSha256(request.p12_evidence_sha256, 'P12 evidence SHA-256'),
    git_sha: requireGitSha(gitSha, 'gitSha'),
    verification_at: requireIsoTimestamp(verificationAt, 'verificationAt'),
    reference_time: requireIsoTimestamp(referenceTime, 'referenceTime'),
    target: clone(request.target),
    grant_request: request,
    request_hash: hashP13GrantRequest(request),
    infrastructure_ready: false,
    authority_state: 'unconfigured',
    trusted_authority_sha256: null,
    grant_state: 'not-issued',
    grant_verified: false,
    activation_authorized: false,
    activation_performed: false,
    repository_default_graph_enabled: false,
    production_source: 'legacy-control',
    checks: null,
    blockers: [],
    phases: Object.fromEntries(
      P13_PHASES.map((phase) => [phase, { status: 'pending', detail: null, error: null }]),
    ),
  };
}

export function recordP13Phase(
  receipt,
  { phase, status, detail = null, error = null } = {},
) {
  requireObject(receipt, 'receipt');
  if (!PHASE_STATUSES.has(status)) throw new Error(`invalid P13 phase status: ${status}`);
  const index = phaseIndex(phase);
  const phases = receipt.phases ?? {};
  if (phases[phase]?.status === 'failed') {
    throw new Error(`phase ${phase} is terminal after failure`);
  }
  for (let i = 0; i < index; i += 1) {
    const prior = P13_PHASES[i];
    const priorStatus = phases[prior]?.status;
    if (priorStatus === 'failed') {
      throw new Error(`phase ${phase} is blocked by failed phase ${prior}`);
    }
    if (!['success', 'skipped', 'unavailable'].includes(priorStatus)) {
      throw new Error(`phase order requires ${prior} before ${phase}`);
    }
  }
  const next = clone(receipt);
  next.phases[phase] = {
    status,
    detail: detail === undefined ? null : clone(detail),
    error: error === undefined ? null : clone(error),
  };
  return next;
}

export function finalizeP13Receipt(receipt, { checks = null, blockers = [] } = {}) {
  requireObject(receipt, 'receipt');
  const next = clone(receipt);
  next.checks = checks && typeof checks === 'object' && !Array.isArray(checks)
    ? clone(checks)
    : null;

  const phaseBlockers = P13_PHASES
    .filter((phase) => next.phases?.[phase]?.status !== 'success')
    .map((phase) => `phase ${phase} is not successful`);
  const checkBlockers = next.checks
    ? Object.entries(next.checks)
      .filter(([, passed]) => passed !== true)
      .map(([name]) => `check ${name} is not true`)
    : ['P13 infrastructure checks are missing'];

  next.blockers = unique([
    ...phaseBlockers,
    ...checkBlockers,
    ...(Array.isArray(blockers) ? blockers : [blockers]),
  ]);
  next.infrastructure_ready = next.blockers.length === 0;

  next.authority_state = 'unconfigured';
  next.trusted_authority_sha256 = null;
  next.grant_state = 'not-issued';
  next.grant_verified = false;
  next.activation_authorized = false;
  next.activation_performed = false;
  next.repository_default_graph_enabled = false;
  next.production_source = 'legacy-control';
  return next;
}

export function assertSecretFreeP13Receipt(receipt, secrets = []) {
  scanCredentialKeys(receipt);
  const serialized = JSON.stringify(receipt);
  const candidates = Array.isArray(secrets) ? secrets : [secrets];
  for (const secret of candidates) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    if (serialized.includes(secret)) {
      throw new Error('secret material is forbidden in P13 receipt');
    }
  }
  return true;
}
