import {
  P13_EVIDENCE_HEAD,
  P13_EVIDENCE_SHA256,
  P13_REQUEST_HASH,
  verifyP14SignedGrant,
} from './p14-authority-enrollment-grant.mjs';

export const P14_PHASES = Object.freeze([
  'p13_binding',
  'authority_enrollment',
  'grant_payload',
  'grant_verification',
  'activation_boundary',
]);

const PHASE_STATUSES = new Set(['pending', 'success', 'failed', 'skipped', 'unavailable']);
const CREDENTIAL_KEY_RE = /^(?:authorization|password|access[_-]?token|bearer[_-]?token|secret(?:[_-]?key)?|private[_-]?key|signing[_-]?key|jwt|(?:.*[_-])?service[_-]?role(?:[_-](?:api[_-]?)?)?(?:key|secret|password|token))$/i;
const CEREMONY_KEYS = Object.freeze(['enrollmentManifest', 'grant', 'now', 'p13Evidence']);

function clone(value) {
  return structuredClone(value);
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function requireGitSha(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) {
    throw new TypeError('gitSha must be a 40-character commit SHA');
  }
  return value.toLowerCase();
}

function requireIso(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a canonical UTC ISO timestamp`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new TypeError(`${name} must be a canonical UTC ISO timestamp`);
  }
  return value;
}

function phaseIndex(phase) {
  const index = P14_PHASES.indexOf(phase);
  if (index === -1) throw new Error(`unknown P14 phase: ${phase}`);
  return index;
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function scanCredentialKeys(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanCredentialKeys(entry, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (CREDENTIAL_KEY_RE.test(key)) {
      throw new Error(`private, signing, credential, or secret field is forbidden in P14 receipt: ${[...path, key].join('.')}`);
    }
    scanCredentialKeys(entry, [...path, key]);
  }
}

export function createP14Receipt({ gitSha, verificationAt, referenceTime } = {}) {
  return {
    schema_version: 'reference-graph.p14-authority-enrollment-grant.v1',
    p13_evidence_head: P13_EVIDENCE_HEAD,
    p13_evidence_sha256: P13_EVIDENCE_SHA256,
    p13_request_hash: P13_REQUEST_HASH,
    git_sha: requireGitSha(gitSha),
    verification_at: requireIso(verificationAt, 'verificationAt'),
    reference_time: requireIso(referenceTime, 'referenceTime'),
    ceremony_ready: false,
    authority_state: 'awaiting-external-enrollment',
    grant_state: 'not-issued',
    grant_verified: false,
    activation_authorized: false,
    activation_performed: false,
    repository_default_graph_enabled: false,
    production_source: 'legacy-control',
    external_blocker: 'production-ed25519-authority-not-provided',
    enrollment_manifest: null,
    grant: null,
    checks: null,
    blockers: [],
    phases: Object.fromEntries(P14_PHASES.map((phase) => [phase, { status: 'pending', detail: null, error: null }])),
  };
}

export function recordP14Phase(receipt, { phase, status, detail = null, error = null } = {}) {
  requireObject(receipt, 'receipt');
  if (!PHASE_STATUSES.has(status)) throw new Error(`invalid P14 phase status: ${status}`);
  const index = phaseIndex(phase);
  if (receipt.phases?.[phase]?.status === 'failed') throw new Error(`phase ${phase} is terminal after failure`);
  for (let i = 0; i < index; i += 1) {
    const prior = P14_PHASES[i];
    const priorStatus = receipt.phases?.[prior]?.status;
    if (priorStatus === 'failed') throw new Error(`phase ${phase} is blocked by failed phase ${prior}`);
    if (!['success', 'skipped', 'unavailable'].includes(priorStatus)) throw new Error(`phase order requires ${prior} before ${phase}`);
  }
  const next = clone(receipt);
  next.phases[phase] = { status, detail: clone(detail), error: clone(error) };
  return next;
}

export function finalizeP14Receipt(receipt, { checks = null, ceremony = null, blockers = [] } = {}) {
  requireObject(receipt, 'receipt');
  const next = clone(receipt);
  next.checks = checks && typeof checks === 'object' && !Array.isArray(checks) ? clone(checks) : null;

  const phaseBlockers = P14_PHASES
    .filter((phase) => next.phases?.[phase]?.status !== 'success')
    .map((phase) => `phase ${phase} is not successful`);
  const checkBlockers = next.checks
    ? Object.entries(next.checks).filter(([, passed]) => passed !== true).map(([name]) => `check ${name} is not true`)
    : ['P14 infrastructure checks are missing'];
  next.blockers = unique([
    ...phaseBlockers,
    ...checkBlockers,
    ...(Array.isArray(blockers) ? blockers : [blockers]),
  ]);
  next.ceremony_ready = next.blockers.length === 0;

  next.authority_state = 'awaiting-external-enrollment';
  next.grant_state = 'not-issued';
  next.grant_verified = false;
  next.activation_authorized = false;
  next.activation_performed = false;
  next.repository_default_graph_enabled = false;
  next.production_source = 'legacy-control';
  next.external_blocker = 'production-ed25519-authority-not-provided';
  next.enrollment_manifest = null;
  next.grant = null;

  if (ceremony !== null && ceremony !== undefined) {
    if (!next.ceremony_ready) throw new Error('P14 ceremony cannot finalize while infrastructure blockers remain');
    const value = requireObject(ceremony, 'ceremony');
    if (!hasExactKeys(value, CEREMONY_KEYS)) {
      throw new Error('P14 ceremony artifacts must contain P13 evidence, enrollment manifest, grant, and verification time for cryptographic re-verification');
    }
    if (!(value.now instanceof Date) || Number.isNaN(value.now.valueOf())) {
      throw new TypeError('P14 ceremony verification time must be a valid Date');
    }
    const verification = verifyP14SignedGrant({
      p13Evidence: value.p13Evidence,
      enrollmentManifest: value.enrollmentManifest,
      grant: value.grant,
      now: value.now,
    });
    if (verification.grantVerified !== true
        || verification.activationAuthorized !== true
        || verification.activationPerformed !== false
        || verification.repositoryDefaultGraphEnabled !== false
        || verification.productionSource !== 'legacy-control') {
      throw new Error(`P14 ceremony cryptographic re-verification failed: ${verification.blockers.join('; ')}`);
    }
    next.authority_state = 'enrolled';
    next.grant_state = 'issued';
    next.grant_verified = true;
    next.activation_authorized = true;
    next.activation_performed = false;
    next.repository_default_graph_enabled = false;
    next.production_source = 'legacy-control';
    next.external_blocker = null;
    next.enrollment_manifest = clone(value.enrollmentManifest);
    next.grant = clone(value.grant);
  }

  return next;
}

export function assertSecretFreeP14Receipt(receipt, secrets = []) {
  scanCredentialKeys(receipt);
  const serialized = JSON.stringify(receipt);
  for (const secret of Array.isArray(secrets) ? secrets : [secrets]) {
    if (typeof secret === 'string' && secret.length > 0 && serialized.includes(secret)) {
      throw new Error('secret material is forbidden in P14 receipt');
    }
  }
  return true;
}
