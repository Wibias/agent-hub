import { validateTargetBinding } from './target-binding.mjs';

export const P6_PHASES = Object.freeze([
  'preflight',
  'migration',
  'embeddings',
  'shadow',
]);

export const P6_QUALITY_THRESHOLDS = Object.freeze({
  min_cases: 20,
  min_comparable_cases: 20,
  min_average_overlap: 0.65,
  min_top1_retention: 0.75,
  max_empty_rate: 0.05,
  min_exact_surface_rate: 0.7,
  min_exact_platform_rate: 0.8,
});

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

function requireGitSha(value, name = 'gitSha') {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) {
    throw new TypeError(`${name} must be a 40-character commit SHA`);
  }
  return value.toLowerCase();
}

function phaseIndex(phase) {
  const index = P6_PHASES.indexOf(phase);
  if (index === -1) throw new Error(`unknown P6 phase: ${phase}`);
  return index;
}

function assertPhaseStatus(status) {
  if (!PHASE_STATUSES.has(status)) {
    throw new Error(`invalid P6 phase status: ${status}`);
  }
}

function phaseBlockers(phases) {
  return P6_PHASES
    .filter((phase) => phases?.[phase]?.status !== 'success')
    .map((phase) => `phase ${phase} is not successful`);
}

function positiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function nonNegativeInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 0;
}

function controlHealthy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const caseCount = Number(value.case_count);
  const blockers = Array.isArray(value.blockers) ? value.blockers : [];
  return value.healthy === true
    && positiveInteger(value.fresh_pool_count)
    && caseCount === 24
    && Number(value.full_limit_case_count) === 24
    && nonNegativeInteger(value.cases_with_coverage_gaps)
    && Number(value.cases_with_coverage_gaps) === 0
    && blockers.length === 0;
}

function embeddingComplete(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const eligible = Number(value.eligible_chunk_count);
  const compatible = Number(value.compatible_count);
  const missing = Number(value.missing_count);
  const mismatch = Number(value.text_hash_mismatch_count);
  const rate = Number(value.coverage_rate);
  return [eligible, compatible, missing, mismatch, rate].every(Number.isFinite)
    && eligible === 275
    && compatible === 275
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

function baselineAvailable(value) {
  return Boolean(value && typeof value === 'object' && value.status === 'available' && value.summary);
}

function migrationApplied(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && value.status === 'applied'
    && value.file === 'reference-graph/schema/006_reference_graph_retrieval_quality.sql'
    && typeof value.sha256 === 'string'
    && /^[0-9a-f]{64}$/i.test(value.sha256),
  );
}

function uniqueBlockers(values) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

export function createP6Receipt({
  binding,
  gitSha,
  verificationAt,
  referenceTime,
  baseSha,
} = {}) {
  return {
    schema_version: 'reference-graph.p6-receipt.v1',
    target: validateTargetBinding(binding),
    base_sha: requireGitSha(baseSha, 'baseSha'),
    git_sha: requireGitSha(gitSha),
    verification_at: requireIsoTimestamp(verificationAt, 'verificationAt'),
    reference_time: requireIsoTimestamp(referenceTime, 'referenceTime'),
    production_source: 'legacy-control',
    quality_thresholds: clone(P6_QUALITY_THRESHOLDS),
    eligible_for_cutover_review: false,
    cutover_ready: false,
    blockers: [],
    phases: Object.fromEntries(
      P6_PHASES.map((phase) => [phase, { status: 'pending', detail: null }]),
    ),
    current_control_health: null,
    embedding_coverage: null,
    p5_baseline: null,
    evaluations: {},
    migration: null,
  };
}

export function recordP6Phase(receipt, { phase, status, detail = null } = {}) {
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
    const priorPhase = P6_PHASES[i];
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

export function finalizeP6Receipt(
  receipt,
  {
    currentControlHealth = null,
    embeddingCoverage = null,
    p5Baseline = null,
    evaluations = {},
    migration = null,
    blockers = [],
  } = {},
) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new TypeError('receipt must be an object');
  }

  const next = clone(receipt);
  next.current_control_health = currentControlHealth === null ? null : clone(currentControlHealth);
  next.embedding_coverage = embeddingCoverage === null ? null : clone(embeddingCoverage);
  next.p5_baseline = p5Baseline === null ? null : clone(p5Baseline);
  next.evaluations = clone(evaluations);
  next.migration = migration === null ? null : clone(migration);

  const reasons = [
    ...phaseBlockers(next.phases),
    ...(migrationApplied(next.migration) ? [] : ['migration 006 is not verified as applied']),
    ...(controlHealthy(next.current_control_health) ? [] : ['current control is unhealthy']),
    ...(embeddingComplete(next.embedding_coverage) ? [] : ['embedding coverage is incomplete or text-hash mismatched']),
    ...(baselineAvailable(next.p5_baseline) ? [] : ['P5 lexical baseline evidence is unavailable']),
    ...(evaluationAvailable(next.evaluations?.lexical) ? [] : ['P6 lexical evidence is unavailable']),
    ...(evaluationAvailable(next.evaluations?.semantic) ? [] : ['P6 semantic diagnostic evidence is unavailable']),
    ...(hybridGreen(next.evaluations?.hybrid) ? [] : ['P6 guarded hybrid evidence is unavailable or below quality gates']),
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
      throw new Error(`credential-shaped field is forbidden in P6 receipt: ${[...path, key].join('.')}`);
    }
    scanCredentialKeys(entry, [...path, key]);
  }
}

export function assertSecretFreeP6Receipt(receipt, secrets = []) {
  scanCredentialKeys(receipt);
  const serialized = JSON.stringify(receipt);
  const candidates = Array.isArray(secrets) ? secrets : [secrets];
  for (const secret of candidates) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    if (serialized.includes(secret)) {
      throw new Error('secret material is forbidden in P6 receipt');
    }
  }
  return true;
}
