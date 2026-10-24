import { validateTargetBinding } from './target-binding.mjs';

export const P8_PHASES = Object.freeze([
  'preflight',
  'offline_contract',
  'live_review',
  'security_boundary',
]);

const PHASE_STATUSES = new Set([
  'pending',
  'success',
  'failed',
  'skipped',
  'unavailable',
]);
const CREDENTIAL_KEY_RE = /(?:service[_-]?role[_-]?(?:key|secret)|database[_-]?password|authorization|access[_-]?token|bearer[_-]?token|secret[_-]?key)/i;
const RUNTIME_CREDENTIAL_BLOCKER = 'service-role is operator-only and not an approved production runtime credential';

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
  const index = P8_PHASES.indexOf(phase);
  if (index === -1) throw new Error(`unknown P8 phase: ${phase}`);
  return index;
}

function assertPhaseStatus(status) {
  if (!PHASE_STATUSES.has(status)) {
    throw new Error(`invalid P8 phase status: ${status}`);
  }
}

function phaseReviewBlockers(phases) {
  return P8_PHASES
    .filter((phase) => phases?.[phase]?.status !== 'success')
    .map((phase) => `phase ${phase} is not successful`);
}

function p7Ready(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.schema_version === 'reference-graph.p7-receipt.v1'
    && value.cutover_ready === true
    && value.eligible_for_cutover_review === true
    && value.production_source === 'legacy-control'
    && Array.isArray(value.blockers)
    && value.blockers.length === 0,
  );
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

function handoffExact(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.status === 'available'
    && Number(value.case_count) === 24
    && Number(value.exact_handoff_count) === 24
    && Number(value.mismatch_count) === 0
    && Number(value.pattern_exact_count) === 24
    && Number(value.hydration_failure_count) === 0,
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

export function createP8Receipt({
  binding,
  gitSha,
  verificationAt,
  referenceTime,
  baseSha,
} = {}) {
  return {
    schema_version: 'reference-graph.p8-cutover-review.v1',
    target: validateTargetBinding(binding),
    base_sha: requireGitSha(baseSha, 'baseSha'),
    git_sha: requireGitSha(gitSha),
    verification_at: requireIsoTimestamp(verificationAt, 'verificationAt'),
    reference_time: requireIsoTimestamp(referenceTime, 'referenceTime'),
    production_source: 'legacy-control',
    activation_performed: false,
    quick_path_review_eligible: false,
    production_activation_ready: false,
    profile_support: {
      quick: 'blocked',
      standard: 'legacy-only',
      deep: 'legacy-only',
    },
    review_blockers: [],
    blockers: [],
    phases: Object.fromEntries(
      P8_PHASES.map((phase) => [phase, { status: 'pending', detail: null, error: null }]),
    ),
    p7_receipt: null,
    current_control_health: null,
    candidate_pool: null,
    offline_review: null,
    live_review: null,
  };
}

export function recordP8Phase(
  receipt,
  { phase, status, detail = null, error = null } = {},
) {
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
    const priorPhase = P8_PHASES[i];
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

export function finalizeP8Receipt(
  receipt,
  {
    p7Receipt = null,
    currentControlHealth = null,
    candidatePool = null,
    offlineReview = null,
    liveReview = null,
    blockers = [],
  } = {},
) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new TypeError('receipt must be an object');
  }

  const next = clone(receipt);
  next.p7_receipt = p7Receipt === null ? null : clone(p7Receipt);
  next.current_control_health = currentControlHealth === null ? null : clone(currentControlHealth);
  next.candidate_pool = candidatePool === null ? null : clone(candidatePool);
  next.offline_review = offlineReview === null ? null : clone(offlineReview);
  next.live_review = liveReview === null ? null : clone(liveReview);

  const reviewReasons = [
    ...phaseReviewBlockers(next.phases),
    ...(p7Ready(next.p7_receipt) ? [] : ['P7 receipt is not blocker-free and review-ready']),
    ...(controlHealthy(next.current_control_health) ? [] : ['current control is unhealthy or structurally incomplete']),
    ...(candidatePoolComplete(next.candidate_pool) ? [] : ['P7 candidate pool is incomplete or has invalid legacy identities']),
    ...(handoffExact(next.offline_review) ? [] : ['offline quick handoff is incomplete or not exact']),
    ...(handoffExact(next.live_review) ? [] : ['live quick handoff is incomplete or not exact']),
  ];
  next.review_blockers = uniqueBlockers(reviewReasons);
  next.quick_path_review_eligible = next.review_blockers.length === 0;
  next.profile_support = {
    quick: next.quick_path_review_eligible ? 'review-eligible' : 'blocked',
    standard: 'legacy-only',
    deep: 'legacy-only',
  };

  next.blockers = uniqueBlockers([
    ...next.review_blockers,
    RUNTIME_CREDENTIAL_BLOCKER,
    ...(Array.isArray(blockers) ? blockers : [blockers]),
  ]);
  next.production_activation_ready = false;
  next.production_source = 'legacy-control';
  next.activation_performed = false;
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
      throw new Error(`credential-shaped field is forbidden in P8 receipt: ${[...path, key].join('.')}`);
    }
    scanCredentialKeys(entry, [...path, key]);
  }
}

export function assertSecretFreeP8Receipt(receipt, secrets = []) {
  scanCredentialKeys(receipt);
  const serialized = JSON.stringify(receipt);
  const candidates = Array.isArray(secrets) ? secrets : [secrets];
  for (const secret of candidates) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    if (serialized.includes(secret)) {
      throw new Error('secret material is forbidden in P8 receipt');
    }
  }
  return true;
}
