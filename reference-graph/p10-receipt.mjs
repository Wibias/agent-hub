import { validateTargetBinding } from './target-binding.mjs';

export const P10_PHASES = Object.freeze([
  'preflight',
  'migration',
  'projection',
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
  const index = P10_PHASES.indexOf(phase);
  if (index === -1) throw new Error(`unknown P10 phase: ${phase}`);
  return index;
}

function assertPhaseStatus(status) {
  if (!PHASE_STATUSES.has(status)) {
    throw new Error(`invalid P10 phase status: ${status}`);
  }
}

function phaseBlockers(phases) {
  return P10_PHASES
    .filter((phase) => phases?.[phase]?.status !== 'success')
    .map((phase) => `phase ${phase} is not successful`);
}

function migrationReady(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.status === 'verified'
    && value.migration === '009_reference_graph_runtime_projection.sql'
    && value.projection === 'reference_graph_quick_runtime_projection_p10'
    && value.refresh_rpc === 'reference_graph_refresh_quick_runtime_projection_p10'
    && value.rls_enabled === true
    && value.current_date_only === true
    && value.p9_runtime_closed === true,
  );
}

function runtimeSecurityReady(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.p9_anon_execute === false
    && value.p9_authenticated_execute === false
    && value.projection_anon_select === true
    && value.projection_authenticated_select === true
    && value.projection_runtime_write_denied === true
    && value.refresh_anon_execute === false
    && value.refresh_authenticated_execute === false
    && value.refresh_service_role_execute === true
    && value.direct_table_select_denied === true
    && value.service_role_used_by_canary === false
    && Number.isInteger(value.security_advisor_p9_p10_warn_error_count)
    && value.security_advisor_p9_p10_warn_error_count === 0,
  );
}

function projectionReady(value, referenceDate) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.status === 'available'
    && value.snapshot_date === referenceDate
    && Number(value.candidate_count) === 275
    && Number(value.complete_metadata_count) === 275
    && Number(value.unique_legacy_id_count) === 275
    && typeof value.live_hash === 'string'
    && value.live_hash.length > 0
    && value.live_hash === value.offline_hash
    && value.equivalent === true,
  );
}

function transportReady(value, referenceDate) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.status === 'available'
    && value.live_http_transport_verified === true
    && value.auth_mode === 'publishable'
    && Number(value.candidate_count) === 275
    && value.snapshot_date === referenceDate,
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
    && Number(value.mismatch_count) === 0
    && Number(value.legacy_authoritative_count) === 24,
  );
}

function fallbackReady(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.transport_failure_fallback === true
    && value.malformed_payload_fallback === true
    && value.stale_snapshot_fallback === true
    && value.empty_snapshot_fallback === true
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

export function createP10Receipt({
  binding,
  gitSha,
  verificationAt,
  referenceTime,
  baseSha,
} = {}) {
  return {
    schema_version: 'reference-graph.p10-runtime-projection.v1',
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
      P10_PHASES.map((phase) => [phase, { status: 'pending', detail: null, error: null }]),
    ),
    migration: null,
    runtime_security: null,
    projection: null,
    transport: null,
    canary: null,
    fallback_verification: null,
  };
}

export function recordP10Phase(
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
    const priorPhase = P10_PHASES[i];
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

export function finalizeP10Receipt(
  receipt,
  {
    migration = null,
    runtimeSecurity = null,
    projection = null,
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
  next.projection = projection === null ? null : clone(projection);
  next.transport = transport === null ? null : clone(transport);
  next.canary = canary === null ? null : clone(canary);
  next.fallback_verification = fallbackVerification === null ? null : clone(fallbackVerification);

  const referenceDate = next.reference_time.slice(0, 10);
  const commonReasons = [
    ...phaseBlockers(next.phases),
    ...(migrationReady(next.migration) ? [] : ['P10 migration contract is not verified']),
    ...(runtimeSecurityReady(next.runtime_security) ? [] : ['P10 runtime security or privilege boundary is not verified']),
    ...(projectionReady(next.projection, referenceDate) ? [] : ['P10 runtime projection is incomplete, stale, or not equivalent']),
    ...(transportReady(next.transport, referenceDate) ? [] : ['P10 publishable live HTTP transport is unavailable, stale, or unverified']),
  ];

  const canaryReasons = [
    ...commonReasons,
    ...(canaryReady(next.canary) ? [] : ['P10 quick canary is incomplete, non-authoritative, or not exact']),
    ...(fallbackReady(next.fallback_verification) ? [] : ['P10 fallback, stale/empty snapshot, no-network, or usage regression evidence is incomplete']),
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

  // P10 proves the least-privilege projection and shadow canary only. A later
  // explicit phase must decide activation and refresh operations.
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
      throw new Error(`credential-shaped field is forbidden in P10 receipt: ${[...path, key].join('.')}`);
    }
    scanCredentialKeys(entry, [...path, key]);
  }
}

export function assertSecretFreeP10Receipt(receipt, secrets = []) {
  scanCredentialKeys(receipt);
  const serialized = JSON.stringify(receipt);
  const candidates = Array.isArray(secrets) ? secrets : [secrets];
  for (const secret of candidates) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    if (serialized.includes(secret)) {
      throw new Error('secret material is forbidden in P10 receipt');
    }
  }
  return true;
}
