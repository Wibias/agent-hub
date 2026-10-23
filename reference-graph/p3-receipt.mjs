import { validateTargetBinding } from './target-binding.mjs';

export const P3_PHASES = Object.freeze([
  'preflight',
  'schema',
  'import',
  'embeddings',
  'shadow',
]);

const PHASE_STATUSES = new Set([
  'pending',
  'success',
  'failed',
  'skipped',
  'unavailable',
]);

const CREDENTIAL_KEY_RE = /(?:service[_-]?role[_-]?(?:key|secret)|database[_-]?password|authorization|access[_-]?token|bearer[_-]?token|secret[_-]?key)/i;

function clone(value) {
  return structuredClone(value);
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

function requireGitSha(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) {
    throw new TypeError('gitSha must be a 40-character commit SHA');
  }
  return value.toLowerCase();
}

function phaseIndex(phase) {
  const index = P3_PHASES.indexOf(phase);
  if (index === -1) throw new Error(`unknown P3 phase: ${phase}`);
  return index;
}

function assertPhaseStatus(status) {
  if (!PHASE_STATUSES.has(status)) {
    throw new Error(`invalid P3 phase status: ${status}`);
  }
}

export function createP3Receipt({ binding, gitSha, verificationAt } = {}) {
  const target = validateTargetBinding(binding);
  return {
    schema_version: 'reference-graph.p3-receipt.v1',
    target,
    git_sha: requireGitSha(gitSha),
    verification_at: requireIsoTimestamp(verificationAt, 'verificationAt'),
    production_source: 'legacy-control',
    eligible_for_cutover_review: false,
    cutover_ready: false,
    phases: Object.fromEntries(
      P3_PHASES.map((phase) => [phase, { status: 'pending', detail: null }]),
    ),
    evaluations: {},
    current_control_health: null,
  };
}

export function recordP3Phase(receipt, { phase, status, detail = null } = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new TypeError('receipt must be an object');
  }
  assertPhaseStatus(status);
  const index = phaseIndex(phase);
  const phases = receipt.phases ?? {};
  const current = phases[phase]?.status;

  if (current === 'failed') {
    throw new Error(`phase ${phase} is terminal after failure`);
  }

  for (let i = 0; i < index; i += 1) {
    const prior = phases[P3_PHASES[i]]?.status;
    if (prior === 'failed') {
      throw new Error(`phase ${phase} is blocked by failed phase ${P3_PHASES[i]}`);
    }
    if (!['success', 'skipped', 'unavailable'].includes(prior)) {
      throw new Error(`phase order requires ${P3_PHASES[i]} before ${phase}`);
    }
  }

  const next = clone(receipt);
  next.phases[phase] = {
    status,
    detail: detail === undefined ? null : clone(detail),
  };
  return next;
}

export function finalizeP3Receipt(
  receipt,
  { evaluations = {}, currentControlHealth = null, cutoverReady = false } = {},
) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new TypeError('receipt must be an object');
  }
  const next = clone(receipt);
  next.evaluations = clone(evaluations);
  next.current_control_health = currentControlHealth === null
    ? null
    : clone(currentControlHealth);
  next.cutover_ready = cutoverReady === true;
  next.eligible_for_cutover_review = cutoverReady === true;
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
      throw new Error(`credential-shaped field is forbidden in P3 receipt: ${[...path, key].join('.')}`);
    }
    scanCredentialKeys(entry, [...path, key]);
  }
}

export function assertSecretFreeReceipt(receipt, secrets = []) {
  scanCredentialKeys(receipt);
  const serialized = JSON.stringify(receipt);
  const candidates = Array.isArray(secrets) ? secrets : [secrets];
  for (const secret of candidates) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    if (serialized.includes(secret)) {
      throw new Error('secret material is forbidden in P3 receipt');
    }
  }
  return true;
}
