import { validateTargetBinding } from './target-binding.mjs';

export const P11_PHASES = Object.freeze([
  'preflight',
  'router',
  'live_canary',
  'rollback',
]);

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
  const index = P11_PHASES.indexOf(phase);
  if (index === -1) throw new Error(`unknown P11 phase: ${phase}`);
  return index;
}

function assertPhaseStatus(status) {
  if (!PHASE_STATUSES.has(status)) {
    throw new Error(`invalid P11 phase status: ${status}`);
  }
}

function phaseBlockers(phases) {
  return P11_PHASES
    .filter((phase) => phases?.[phase]?.status !== 'success')
    .map((phase) => `phase ${phase} is not successful`);
}

function defaultOffReady(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.verified === true
    && value.repository_default_graph_enabled === false
    && value.default_quick_legacy_equivalent === true
    && Number(value.default_graph_fetch_count) === 0,
  );
}

function canaryReady(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.status === 'available'
    && Number(value.case_count) === 24
    && Number(value.authoritative_graph_count) === 24
    && Number(value.exact_record_count) === 24
    && Number(value.exact_pattern_count) === 24
    && Number(value.coverage_exit_exact_count) === 24
    && Number(value.mismatch_count) === 0
    && value.auth_mode === 'publishable',
  );
}

function fallbackReady(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.transport_failure_fallback === true
    && value.missing_key_zero_fetch_fallback === true
    && value.stale_snapshot_fallback === true
    && value.empty_snapshot_fallback === true
    && value.malformed_payload_fallback === true
    && value.usage_exact_once_graph === true
    && value.usage_exact_once_fallback === true,
  );
}

function profileIsolationReady(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.standard_legacy_only === true
    && value.deep_legacy_only === true
    && Number(value.standard_fetch_count) === 0
    && Number(value.deep_fetch_count) === 0,
  );
}

function securityReady(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.runtime_auth_mode === 'publishable'
    && value.service_role_runtime_used === false
    && Number.isInteger(value.security_advisor_p9_p10_warn_error_count)
    && value.security_advisor_p9_p10_warn_error_count === 0,
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

export function createP11Receipt({
  binding,
  baseSha,
  gitSha,
  verificationAt,
  referenceTime,
} = {}) {
  return {
    schema_version: 'reference-graph.p11-activation-readiness.v1',
    target: validateTargetBinding(binding),
    base_sha: requireGitSha(baseSha, 'baseSha'),
    git_sha: requireGitSha(gitSha),
    verification_at: requireIsoTimestamp(verificationAt, 'verificationAt'),
    reference_time: requireIsoTimestamp(referenceTime, 'referenceTime'),
    production_source: 'legacy-control',
    repository_default_graph_enabled: false,
    activation_performed: false,
    quick_activation_ready: false,
    profile_support: {
      quick: 'blocked',
      standard: 'legacy-only',
      deep: 'legacy-only',
    },
    blockers: [],
    phases: Object.fromEntries(
      P11_PHASES.map((phase) => [phase, { status: 'pending', detail: null, error: null }]),
    ),
    default_off: null,
    live_activated_canary: null,
    fallback_verification: null,
    profile_isolation: null,
    security: null,
  };
}

export function recordP11Phase(
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
    const priorPhase = P11_PHASES[i];
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

export function finalizeP11Receipt(
  receipt,
  {
    defaultOff = null,
    liveActivatedCanary = null,
    fallbackVerification = null,
    profileIsolation = null,
    security = null,
    blockers = [],
  } = {},
) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new TypeError('receipt must be an object');
  }

  const next = clone(receipt);
  next.default_off = defaultOff === null ? null : clone(defaultOff);
  next.live_activated_canary = liveActivatedCanary === null ? null : clone(liveActivatedCanary);
  next.fallback_verification = fallbackVerification === null ? null : clone(fallbackVerification);
  next.profile_isolation = profileIsolation === null ? null : clone(profileIsolation);
  next.security = security === null ? null : clone(security);

  const reasons = [
    ...phaseBlockers(next.phases),
    ...(defaultOffReady(next.default_off) ? [] : ['P11 default-off legacy equivalence is not verified']),
    ...(canaryReady(next.live_activated_canary) ? [] : ['P11 activated quick canary is incomplete or not exact']),
    ...(fallbackReady(next.fallback_verification) ? [] : ['P11 fallback or usage-once rollback evidence is incomplete']),
    ...(profileIsolationReady(next.profile_isolation) ? [] : ['P11 standard/deep legacy-only zero-network isolation is incomplete']),
    ...(securityReady(next.security) ? [] : ['P11 publishable runtime security boundary is incomplete']),
    ...(Array.isArray(blockers) ? blockers : [blockers]),
  ];

  next.blockers = uniqueBlockers(reasons);
  next.quick_activation_ready = next.blockers.length === 0;
  next.profile_support = {
    quick: next.quick_activation_ready ? 'activation-ready' : 'blocked',
    standard: 'legacy-only',
    deep: 'legacy-only',
  };

  // P11 proves the opt-in mechanism is activation-ready. The repository
  // default stays legacy and P11 itself never performs global activation.
  next.repository_default_graph_enabled = false;
  next.activation_performed = false;
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
      throw new Error(`credential-shaped field is forbidden in P11 receipt: ${[...path, key].join('.')}`);
    }
    scanCredentialKeys(entry, [...path, key]);
  }
}

export function assertSecretFreeP11Receipt(receipt, secrets = []) {
  scanCredentialKeys(receipt);
  const serialized = JSON.stringify(receipt);
  const candidates = Array.isArray(secrets) ? secrets : [secrets];
  for (const secret of candidates) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    if (serialized.includes(secret)) {
      throw new Error('secret material is forbidden in P11 receipt');
    }
  }
  return true;
}
