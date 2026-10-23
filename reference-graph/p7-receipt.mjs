import { validateTargetBinding } from './target-binding.mjs';

export const P7_PHASES = Object.freeze([
  'preflight',
  'migration',
  'reimport',
  'shadow',
]);

export const P7_QUALITY_THRESHOLDS = Object.freeze({
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
const HASH_RE = /^[0-9a-f]{64}$/i;
const IDENTITY_HASH_FIELDS = Object.freeze([
  'source_ids_sha256',
  'asset_ids_sha256',
  'chunk_ids_sha256',
  'asset_content_hashes_sha256',
  'chunk_text_hashes_sha256',
]);

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
  const index = P7_PHASES.indexOf(phase);
  if (index === -1) throw new Error(`unknown P7 phase: ${phase}`);
  return index;
}

function assertPhaseStatus(status) {
  if (!PHASE_STATUSES.has(status)) {
    throw new Error(`invalid P7 phase status: ${status}`);
  }
}

function phaseBlockers(phases) {
  return P7_PHASES
    .filter((phase) => phases?.[phase]?.status !== 'success')
    .map((phase) => `phase ${phase} is not successful`);
}

function controlHealthy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const blockers = Array.isArray(value.blockers) ? value.blockers : [];
  return value.healthy === true
    && Number(value.fresh_pool_count) === 275
    && Number(value.case_count) === 24
    && Number(value.full_limit_case_count) === 24
    && Number(value.cases_with_coverage_gaps) === 0
    && blockers.length === 0;
}

function embeddingComplete(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Number(value.eligible_chunk_count) === 275
    && Number(value.compatible_count) === 275
    && Number(value.missing_count) === 0
    && Number(value.text_hash_mismatch_count) === 0
    && Number(value.coverage_rate) === 1;
}

function validIdentitySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  if (Number(snapshot.source_count) !== 576
    || Number(snapshot.asset_count) !== 600
    || Number(snapshot.current_asset_count) !== 600
    || Number(snapshot.chunk_count) !== 600
    || Number(snapshot.embedding_count) !== 600
    || Number(snapshot.fresh_eligible_count) !== 275) {
    return false;
  }
  return IDENTITY_HASH_FIELDS.every((field) => HASH_RE.test(String(snapshot[field] ?? '')));
}

function identityVerified(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.status !== 'verified'
    || Number(value.import_runs) < 2
    || value.unchanged !== true
    || Number(value.metadata_complete_count) !== 600
    || !validIdentitySnapshot(value.before)
    || !validIdentitySnapshot(value.after)) {
    return false;
  }
  const countFields = [
    'source_count',
    'asset_count',
    'current_asset_count',
    'chunk_count',
    'embedding_count',
    'fresh_eligible_count',
  ];
  return [...countFields, ...IDENTITY_HASH_FIELDS].every(
    (field) => value.before[field] === value.after[field],
  );
}

function candidatePoolComplete(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.status === 'available'
    && Number(value.eligible_count) === 275
    && Number(value.complete_metadata_count) === 275
    && Number(value.unique_legacy_id_count) === 275,
  );
}

function migrationApplied(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.status === 'applied'
    && value.file === 'reference-graph/schema/007_reference_graph_lexical_parity.sql'
    && HASH_RE.test(String(value.sha256 ?? '')),
  );
}

function evaluationGreen(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.status !== 'available') {
    return false;
  }
  const summary = value.summary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return false;
  const blockers = Array.isArray(summary.blockers) ? summary.blockers : [];
  return Number(summary.case_count) === 24
    && Number(summary.comparable_case_count) === 24
    && Number(summary.average_overlap_at_k) >= P7_QUALITY_THRESHOLDS.min_average_overlap
    && Number(summary.legacy_top1_retention_rate) >= P7_QUALITY_THRESHOLDS.min_top1_retention
    && Number(summary.graph_empty_rate) <= P7_QUALITY_THRESHOLDS.max_empty_rate
    && Number(summary.average_exact_surface_rate) >= P7_QUALITY_THRESHOLDS.min_exact_surface_rate
    && Number(summary.average_exact_platform_rate) >= P7_QUALITY_THRESHOLDS.min_exact_platform_rate
    && summary.cutover_ready === true
    && blockers.length === 0;
}

function uniqueBlockers(values) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

export function createP7Receipt({
  binding,
  gitSha,
  verificationAt,
  referenceTime,
  baseSha,
} = {}) {
  return {
    schema_version: 'reference-graph.p7-receipt.v1',
    target: validateTargetBinding(binding),
    base_sha: requireGitSha(baseSha, 'baseSha'),
    git_sha: requireGitSha(gitSha),
    verification_at: requireIsoTimestamp(verificationAt, 'verificationAt'),
    reference_time: requireIsoTimestamp(referenceTime, 'referenceTime'),
    production_source: 'legacy-control',
    quality_thresholds: clone(P7_QUALITY_THRESHOLDS),
    eligible_for_cutover_review: false,
    cutover_ready: false,
    blockers: [],
    phases: Object.fromEntries(
      P7_PHASES.map((phase) => [phase, { status: 'pending', detail: null }]),
    ),
    current_control_health: null,
    identity_evidence: null,
    embedding_coverage: null,
    candidate_pool: null,
    evaluation: null,
    migration: null,
  };
}

export function recordP7Phase(receipt, { phase, status, detail = null } = {}) {
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
    const priorPhase = P7_PHASES[i];
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

export function finalizeP7Receipt(
  receipt,
  {
    currentControlHealth = null,
    identityEvidence = null,
    embeddingCoverage = null,
    candidatePool = null,
    evaluation = null,
    migration = null,
    blockers = [],
  } = {},
) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new TypeError('receipt must be an object');
  }

  const next = clone(receipt);
  next.current_control_health = currentControlHealth === null ? null : clone(currentControlHealth);
  next.identity_evidence = identityEvidence === null ? null : clone(identityEvidence);
  next.embedding_coverage = embeddingCoverage === null ? null : clone(embeddingCoverage);
  next.candidate_pool = candidatePool === null ? null : clone(candidatePool);
  next.evaluation = evaluation === null ? null : clone(evaluation);
  next.migration = migration === null ? null : clone(migration);

  const reasons = [
    ...phaseBlockers(next.phases),
    ...(migrationApplied(next.migration) ? [] : ['migration 007 is not verified as applied']),
    ...(controlHealthy(next.current_control_health) ? [] : ['current control is unhealthy or structurally incomplete']),
    ...(identityVerified(next.identity_evidence) ? [] : ['metadata re-import identity evidence is incomplete or changed']),
    ...(embeddingComplete(next.embedding_coverage) ? [] : ['embedding coverage is incomplete or text-hash mismatched']),
    ...(candidatePoolComplete(next.candidate_pool) ? [] : ['P7 candidate pool is incomplete or has invalid legacy identities']),
    ...(evaluationGreen(next.evaluation) ? [] : ['P7 parity lexical evidence is unavailable or below quality gates']),
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
      throw new Error(`credential-shaped field is forbidden in P7 receipt: ${[...path, key].join('.')}`);
    }
    scanCredentialKeys(entry, [...path, key]);
  }
}

export function assertSecretFreeP7Receipt(receipt, secrets = []) {
  scanCredentialKeys(receipt);
  const serialized = JSON.stringify(receipt);
  const candidates = Array.isArray(secrets) ? secrets : [secrets];
  for (const secret of candidates) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    if (serialized.includes(secret)) {
      throw new Error('secret material is forbidden in P7 receipt');
    }
  }
  return true;
}
