import { hashP12ActivationBinding } from './p12-activation-authority.mjs';
import { validateTargetBinding } from './target-binding.mjs';

export const P12_PHASES = Object.freeze([
  'binding',
  'repository',
  'live_preflight',
  'rollback',
]);

const P11_EVIDENCE_HEAD = '541e9667ea28c75de5492b79d84edf89f9cac8ac';
const PHASE_STATUSES = new Set([
  'pending',
  'success',
  'failed',
  'skipped',
  'unavailable',
]);
const CREDENTIAL_KEY_RE = /^(?:authorization|database[_-]?password|access[_-]?token|bearer[_-]?token|secret[_-]?key|jwt|(?:.*[_-])?(?:service[_-]?role|publishable|anon)(?:[_-](?:api[_-]?)?)?(?:key|secret|password|token))$/i;

function clone(value) {
  return structuredClone(value);
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function requireIsoTimestamp(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be an ISO timestamp`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${name} must be an ISO timestamp`);
  }
  return parsed.toISOString();
}

function requireGitSha(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) {
    throw new TypeError(`${name} must be a 40-character commit SHA`);
  }
  return value.toLowerCase();
}

function phaseIndex(phase) {
  const index = P12_PHASES.indexOf(phase);
  if (index === -1) throw new Error(`unknown P12 phase: ${phase}`);
  return index;
}

function assertPhaseStatus(status) {
  if (!PHASE_STATUSES.has(status)) {
    throw new Error(`invalid P12 phase status: ${status}`);
  }
}

function phaseBlockers(phases) {
  return P12_PHASES
    .filter((phase) => phases?.[phase]?.status !== 'success')
    .map((phase) => `phase ${phase} is not successful`);
}

function uniqueBlockers(values) {
  return [...new Set(
    values
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function preflightReady(receipt, preflight) {
  if (!preflight || typeof preflight !== 'object' || Array.isArray(preflight)) return false;
  if (preflight.preflightReady !== true) return false;
  if (preflight.bindingHash !== receipt.binding_hash) return false;
  if (!preflight.checks || typeof preflight.checks !== 'object' || Array.isArray(preflight.checks)) {
    return false;
  }
  const checks = Object.values(preflight.checks);
  if (checks.length === 0 || !checks.every((value) => value === true)) return false;
  if (!Array.isArray(preflight.blockers) || preflight.blockers.length !== 0) return false;
  return true;
}

export function createP12Receipt({
  binding,
  target,
  baseSha,
  gitSha,
  verificationAt,
  referenceTime,
} = {}) {
  const activationBinding = clone(requireObject(binding, 'binding'));
  const normalizedTarget = validateTargetBinding(target);
  if (JSON.stringify(normalizedTarget) !== JSON.stringify(activationBinding.target)) {
    throw new Error('receipt target must match P12 activation binding target');
  }
  const normalizedBaseSha = requireGitSha(baseSha, 'baseSha');
  if (normalizedBaseSha !== P11_EVIDENCE_HEAD) {
    throw new Error(`baseSha must be final P11 evidence head ${P11_EVIDENCE_HEAD}`);
  }

  return {
    schema_version: 'reference-graph.p12-activation-authority.v1',
    target: normalizedTarget,
    base_sha: normalizedBaseSha,
    git_sha: requireGitSha(gitSha, 'gitSha'),
    verification_at: requireIsoTimestamp(verificationAt, 'verificationAt'),
    reference_time: requireIsoTimestamp(referenceTime, 'referenceTime'),
    activation_binding: activationBinding,
    binding_hash: hashP12ActivationBinding(activationBinding),
    preflight_ready: false,
    grant_state: 'not-issued',
    activation_authorized: false,
    activation_performed: false,
    repository_default_graph_enabled: false,
    production_source: 'legacy-control',
    profile_support: {
      quick: 'blocked',
      standard: 'legacy-only',
      deep: 'legacy-only',
    },
    checks: null,
    blockers: [],
    phases: Object.fromEntries(
      P12_PHASES.map((phase) => [phase, { status: 'pending', detail: null, error: null }]),
    ),
  };
}

export function recordP12Phase(
  receipt,
  { phase, status, detail = null, error = null } = {},
) {
  requireObject(receipt, 'receipt');
  assertPhaseStatus(status);
  const index = phaseIndex(phase);
  const phases = receipt.phases ?? {};

  if (phases[phase]?.status === 'failed') {
    throw new Error(`phase ${phase} is terminal after failure`);
  }
  for (let i = 0; i < index; i += 1) {
    const priorPhase = P12_PHASES[i];
    const priorStatus = phases[priorPhase]?.status;
    if (priorStatus === 'failed') {
      throw new Error(`phase ${phase} is blocked by failed phase ${priorPhase}`);
    }
    if (!['success', 'skipped', 'unavailable'].includes(priorStatus)) {
      throw new Error(`phase order requires ${priorPhase} before ${phase}`);
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

export function finalizeP12Receipt(
  receipt,
  { preflight = null, blockers = [] } = {},
) {
  requireObject(receipt, 'receipt');
  const next = clone(receipt);
  next.checks = preflight?.checks && typeof preflight.checks === 'object'
    ? clone(preflight.checks)
    : null;

  const reasons = [
    ...phaseBlockers(next.phases),
    ...(preflightReady(next, preflight) ? [] : ['P12 activation preflight is not structurally ready']),
    ...(Array.isArray(preflight?.blockers) ? preflight.blockers : []),
    ...(Array.isArray(blockers) ? blockers : [blockers]),
  ];

  next.blockers = uniqueBlockers(reasons);
  next.preflight_ready = next.blockers.length === 0;
  next.profile_support = {
    quick: next.preflight_ready ? 'preflight-ready' : 'blocked',
    standard: 'legacy-only',
    deep: 'legacy-only',
  };

  // Readiness is deliberately not execution authority. P12 never issues or
  // applies a grant and never changes repository/runtime production defaults.
  next.grant_state = 'not-issued';
  next.activation_authorized = false;
  next.activation_performed = false;
  next.repository_default_graph_enabled = false;
  next.production_source = 'legacy-control';
  return next;
}

function scanCredentialKeys(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanCredentialKeys(entry, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (CREDENTIAL_KEY_RE.test(key)) {
      throw new Error(`credential-shaped field is forbidden in P12 receipt: ${[...path, key].join('.')}`);
    }
    scanCredentialKeys(entry, [...path, key]);
  }
}

export function assertSecretFreeP12Receipt(receipt, secrets = []) {
  scanCredentialKeys(receipt);
  const serialized = JSON.stringify(receipt);
  const candidates = Array.isArray(secrets) ? secrets : [secrets];
  for (const secret of candidates) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    if (serialized.includes(secret)) {
      throw new Error('secret material is forbidden in P12 receipt');
    }
  }
  return true;
}
