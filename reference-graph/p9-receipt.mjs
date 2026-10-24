import { validateTargetBinding } from './target-binding.mjs';

export const P9_PHASES = Object.freeze([
  'preflight',
  'migration',
  'transport',
  'canary',
]);

const PHASE_STATUSES = new Set([
  'pending',
  'success',
  'failed',
  'skipped',
  'unavailable',
]);

const CREDENTIAL_KEY_RE = /^(?:authorization|database[_-]?password|access[_-]?token|bearer[_-]?token|secret[_-]?key|(?:.*[_-])?(?:service[_-]?role|publishable|anon)(?:[_-](?:api[_-]?)?)?(?:key|secret|password|token))$/i;

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
  const index = P9_PHASES.indexOf(phase);
  if (index === -1) throw new Error(`unknown P9 phase: ${phase}`);
  return index;
}

function assertPhaseStatus(status) {
  if (!PHASE_STATUSES.has(status)) {
    throw new Error(`invalid P9 phase status: ${status}`);
  }
}

function phaseBlockers(phases) {
  return P9_PHASES
    .filter((phase) => phases?.[phase]?.status !== 'success')
    .map((phase) => `phase ${phase} is not successful`);
}

function migrationReady(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.status === 'verified'
    && value.migration === '008_reference_graph_runtime_canary.sql'
    && value.runtime_rpc === 'reference_graph_quick_candidate_pool_runtime_p9'
    && value.zero_argument === true
    && value.current_date_only === true,
  );
}

function runtimeSecurityReady(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.anon_wrapper_execute === true
    && value.authenticated_wrapper_execute === true
    && value.p7_denied === true
    && value.p6_denied === true
    && value.write_denied === true
    && value.direct_table_select_denied === true
    && value.service_role_used_by_canary === false
    && Number.isInteger(value.security_advisor_p9_warn_error_count)
    && value.security_advisor_p9_warn_error_count === 0,
  );
}

function candidatePoolReady(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.status === 'available'
    && Number(value.candidate_count) === 275
    && Number(value.complete_metadata_count) === 275
    && Number(value.unique_legacy_id_count) === 275
    && typeof value.live_hash === 'string'
    && value.live_hash.length > 0
    && value.live_hash === value.offline_hash
    && value.equivalent === true,
  );
}

function transportReady(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.status === 'available'
    && value.live_http_transport_verified === true
    && value.auth_mode === 'publishable'
    && Number(value.candidate_count) === 275,
  );
}

function canaryReady(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.status === 'available'
    && Number(value.case_count) === 24
    && Number(value.exact_record_count) === 24
    && Number(value.exact_pattern_count) === 24
    && Number(value.mismatch_count) === 0,
  );
}

function fallbackReady(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.transport_failure_fallback === true
    && value.malformed_payload_fallback === true
    && value.standard_no_network === true
    && value.deep_no_network === true
    && value.usage_legacy_only === true,
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

export function createP9Receipt({
  binding,
  gitSha,
  verificationAt,
  referenceTime,
  baseSha,
} = {}) {
  return {
    schema_version: 'reference-graph.p9-runtime-canary.v1',
    target: validateTargetBinding(binding),
    base_sha: requireGitSha(baseSha, 'baseSha'),
    git_sha: requireGitSha(gitSha),
    verification_at: requireIsoTimestamp(verificationAt, 'verificationAt'),
    reference_time: requireIsoTimestamp(referenceTime, 'referenceTime'),
    production_source: 'legacy-control',
    activation_performed: false,
    least_privilege_transport_ready: false,
    quick_shadow_canary_ready: false,
    production_activation_ready: false,
    profile_support: {
      quick: 'blocked',
      standard: 'legacy-only',
      deep: 'legacy-only',
    },
    blockers: [],
    phases: Object.fromEntries(
      P9_PHASES.map((phase) => [phase, { status: 'pending', detail: null, error: null }]),
    ),
    migration: null,
    runtime_security: null,
    candidate_pool: null,
    transport: null,
    canary: null,
    fallback_verification: null,
  };
}

export function recordP9Phase(
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
    const priorPhase = P9_PHASES[i];
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

export function finalizeP9Receipt(
  receipt,
  {
    migration = null,
    runtimeSecurity = null,
    candidatePool = null,
    transport = null,
    canary = null,
    fallbackVerification = null,
    blockers = [],
  } = {},
) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new TypeError('receipt must be an object');
  }

  const next = clone(receipt);
  next.migration = migration === null ? null : clone(migration);
  next.runtime_security = runtimeSecurity === null ? null : clone(runtimeSecurity);
  next.candidate_pool = candidatePool === null ? null : clone(candidatePool);
  next.transport = transport === null ? null : clone(transport);
  next.canary = canary === null ? null : clone(canary);
  next.fallback_verification = fallbackVerification === null ? null : clone(fallbackVerification);

  const commonReasons = [
    ...phaseBlockers(next.phases),
    ...(migrationReady(next.migration) ? [] : ['P9 migration contract is not verified']),
    ...(runtimeSecurityReady(next.runtime_security) ? [] : ['P9 runtime security or privilege boundary is not verified']),
    ...(candidatePoolReady(next.candidate_pool) ? [] : ['P9 candidate pool is incomplete or not equivalent']),
    ...(transportReady(next.transport) ? [] : ['P9 publishable live HTTP transport is unavailable or unverified']),
  ];

  const canaryReasons = [
    ...commonReasons,
    ...(canaryReady(next.canary) ? [] : ['P9 quick canary is incomplete or not exact']),
    ...(fallbackReady(next.fallback_verification) ? [] : ['P9 fallback, no-network, or usage regression evidence is incomplete']),
  ];

  next.least_privilege_transport_ready = commonReasons.length === 0;
  next.quick_shadow_canary_ready = canaryReasons.length === 0;
  next.profile_support = {
    quick: next.quick_shadow_canary_ready ? 'shadow-ready' : 'blocked',
    standard: 'legacy-only',
    deep: 'legacy-only',
  };
  next.blockers = uniqueBlockers([
    ...canaryReasons,
    ...(Array.isArray(blockers) ? blockers : [blockers]),
  ]);

  // P9 proves a reversible shadow-canary boundary only. Production activation
  // is deliberately outside this phase even when every P9 gate is green.
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
      throw new Error(`credential-shaped field is forbidden in P9 receipt: ${[...path, key].join('.')}`);
    }
    scanCredentialKeys(entry, [...path, key]);
  }
}

export function assertSecretFreeP9Receipt(receipt, secrets = []) {
  scanCredentialKeys(receipt);
  const serialized = JSON.stringify(receipt);
  const candidates = Array.isArray(secrets) ? secrets : [secrets];
  for (const secret of candidates) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    if (serialized.includes(secret)) {
      throw new Error('secret material is forbidden in P9 receipt');
    }
  }
  return true;
}
