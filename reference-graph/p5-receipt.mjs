import { validateTargetBinding } from './target-binding.mjs';

export const P5_PHASES = Object.freeze([
  'preflight',
  'selector',
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
  const index = P5_PHASES.indexOf(phase);
  if (index === -1) throw new Error(`unknown P5 phase: ${phase}`);
  return index;
}

function assertPhaseStatus(status) {
  if (!PHASE_STATUSES.has(status)) {
    throw new Error(`invalid P5 phase status: ${status}`);
  }
}

function phaseBlockers(phases) {
  return P5_PHASES
    .filter((phase) => phases?.[phase]?.status !== 'success')
    .map((phase) => `phase ${phase} is not successful`);
}

function selectorVerified(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.verified === true);
}

function controlHealthy(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.healthy === true);
}

function embeddingComplete(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const eligible = Number(value.eligible_chunk_count);
  const compatible = Number(value.compatible_count);
  const missing = Number(value.missing_count);
  const mismatch = Number(value.text_hash_mismatch_count);
  const rate = Number(value.coverage_rate);
  return [eligible, compatible, missing, mismatch, rate].every(Number.isFinite)
    && eligible > 0
    && compatible === eligible
    && missing === 0
    && mismatch === 0
    && rate === 1;
}

function evaluationAvailable(value) {
  return Boolean(value && typeof value === 'object' && value.status === 'available');
}

function hybridGreen(value) {
  return evaluationAvailable(value)
    && Boolean(value.summary && value.summary.cutover_ready === true);
}

function uniqueBlockers(values) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

export function createP5Receipt({
  binding,
  gitSha,
  verificationAt,
  referenceTime,
} = {}) {
  return {
    schema_version: 'reference-graph.p5-receipt.v1',
    target: validateTargetBinding(binding),
    git_sha: requireGitSha(gitSha),
    verification_at: requireIsoTimestamp(verificationAt, 'verificationAt'),
    reference_time: requireIsoTimestamp(referenceTime, 'referenceTime'),
    production_source: 'legacy-control',
    eligible_for_cutover_review: false,
    cutover_ready: false,
    blockers: [],
    phases: Object.fromEntries(
      P5_PHASES.map((phase) => [phase, { status: 'pending', detail: null }]),
    ),
    selector_contract: null,
    current_control_health: null,
    embedding_coverage: null,
    evaluations: {},
  };
}

export function recordP5Phase(receipt, { phase, status, detail = null } = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new TypeError('receipt must be an object');
  }
  assertPhaseStatus(status);
  const index = phaseIndex(phase);
  const phases = receipt.phases ?? {};

  if (phases[phase]?.status === 'failed') {
    throw new Error(`phase ${phase} is terminal after failure`);
  }

  for (let i = 0; i < index; i += 1) {
    const priorPhase = P5_PHASES[i];
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
  };
  return next;
}

export function finalizeP5Receipt(
  receipt,
  {
    selectorContract = null,
    currentControlHealth = null,
    embeddingCoverage = null,
    evaluations = {},
    blockers = [],
  } = {},
) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new TypeError('receipt must be an object');
  }

  const next = clone(receipt);
  next.selector_contract = selectorContract === null ? null : clone(selectorContract);
  next.current_control_health = currentControlHealth === null
    ? null
    : clone(currentControlHealth);
  next.embedding_coverage = embeddingCoverage === null
    ? null
    : clone(embeddingCoverage);
  next.evaluations = clone(evaluations);

  const reasons = [
    ...phaseBlockers(next.phases),
    ...(selectorVerified(next.selector_contract) ? [] : ['selector contract is not verified']),
    ...(controlHealthy(next.current_control_health) ? [] : ['current control is unhealthy']),
    ...(embeddingComplete(next.embedding_coverage) ? [] : ['embedding coverage is incomplete or text-hash mismatched']),
    ...(evaluationAvailable(next.evaluations?.semantic) ? [] : ['live semantic evidence is unavailable']),
    ...(hybridGreen(next.evaluations?.hybrid) ? [] : ['live hybrid evidence is unavailable or below quality gates']),
    ...(Array.isArray(blockers) ? blockers : [blockers]),
  ];

  next.blockers = uniqueBlockers(reasons);
  next.cutover_ready = next.blockers.length === 0;
  next.eligible_for_cutover_review = next.cutover_ready;
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
      throw new Error(`credential-shaped field is forbidden in P5 receipt: ${[...path, key].join('.')}`);
    }
    scanCredentialKeys(entry, [...path, key]);
  }
}

export function assertSecretFreeP5Receipt(receipt, secrets = []) {
  scanCredentialKeys(receipt);
  const serialized = JSON.stringify(receipt);
  const candidates = Array.isArray(secrets) ? secrets : [secrets];
  for (const secret of candidates) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    if (serialized.includes(secret)) {
      throw new Error('secret material is forbidden in P5 receipt');
    }
  }
  return true;
}
