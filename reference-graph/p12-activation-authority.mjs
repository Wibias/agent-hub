import { createHash } from 'node:crypto';

import { validateTargetBinding } from './target-binding.mjs';

const P11_EVIDENCE_HEAD = '541e9667ea28c75de5492b79d84edf89f9cac8ac';
const P11_IMPLEMENTATION_SHA = '849a8782be4081a5821bdb354e54c33b2e2b0fb9';
const TARGET = Object.freeze({
  purpose: 'agent-hub-reference-graph',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
});

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function requireGitSha(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) {
    throw new TypeError(`${name} must be a 40-character commit SHA`);
  }
  return value.toLowerCase();
}

function requireSha256(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new TypeError(`${name} must be a 64-character SHA-256 hex digest`);
  }
  return value.toLowerCase();
}

function requireDate(value, name = 'snapshot date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${name} must be a YYYY-MM-DD snapshot date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${name} must be a valid snapshot date`);
  }
  return value;
}

function requireExactTarget(target) {
  const normalized = validateTargetBinding(target);
  for (const [key, expected] of Object.entries(TARGET)) {
    if (normalized[key] !== expected) {
      throw new Error(`target ${key} must be ${expected}`);
    }
  }
  return normalized;
}

function sortedClone(value) {
  if (Array.isArray(value)) return value.map(sortedClone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedClone(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(sortedClone(value));
}

function bindingContractReady(binding) {
  try {
    const value = requireObject(binding, 'binding');
    requireGitSha(value.p11_evidence_head, 'p11 evidence head');
    requireGitSha(value.p11_implementation_sha, 'p11 implementation SHA');
    requireExactTarget(value.target);
    requireDate(value.projection_snapshot_date);
    requireSha256(value.query_source_sha256, 'query source SHA-256');
    requireSha256(value.router_source_sha256, 'router source SHA-256');
    requireSha256(value.p11_evidence_sha256, 'P11 evidence SHA-256');
    return value.schema_version === 'reference-graph.p12-activation-binding.v1'
      && value.p11_evidence_head === P11_EVIDENCE_HEAD
      && value.p11_implementation_sha === P11_IMPLEMENTATION_SHA
      && value.profile === 'quick'
      && value.activation_flag === 'REFERENCE_GRAPH_QUICK_RUNTIME'
      && value.activation_value === 'graph'
      && value.runtime_auth_mode === 'publishable'
      && value.service_role_runtime_allowed === false
      && value.timeout_ms === 1500
      && value.legacy_first === true
      && value.record_parity_required === 'exact-ordered'
      && value.pattern_parity_required === 'exact-ordered'
      && value.fallback_source === 'legacy-control'
      && value.standard_mode === 'legacy-only'
      && value.deep_mode === 'legacy-only'
      && value.repository_default_graph_enabled === false
      && value.projection_candidate_count === 275
      && value.projection_metadata_complete_count === 275
      && value.projection_unique_legacy_id_count === 275
      && value.rollback_action === 'unset-or-change-REFERENCE_GRAPH_QUICK_RUNTIME';
  } catch {
    return false;
  }
}

function p11ReadinessReady(evidence) {
  return Boolean(
    evidence
    && typeof evidence === 'object'
    && !Array.isArray(evidence)
    && evidence.schema_version === 'reference-graph.p11-activation-readiness.v1'
    && evidence.quick_activation_ready === true
    && evidence.production_source === 'legacy-control'
    && evidence.repository_default_graph_enabled === false
    && evidence.activation_performed === false
    && evidence.profile_support?.quick === 'activation-ready'
    && evidence.profile_support?.standard === 'legacy-only'
    && evidence.profile_support?.deep === 'legacy-only',
  );
}

function p11CanaryReady(evidence) {
  const value = evidence?.live_activated_canary;
  return Boolean(
    value
    && value.status === 'available'
    && value.case_count === 24
    && value.authoritative_graph_count === 24
    && value.exact_record_count === 24
    && value.exact_pattern_count === 24
    && value.coverage_exit_exact_count === 24
    && value.mismatch_count === 0
    && value.auth_mode === 'publishable',
  );
}

function p11FallbackReady(evidence) {
  const value = evidence?.fallback_verification;
  return Boolean(
    value
    && value.transport_failure_fallback === true
    && value.missing_key_zero_fetch_fallback === true
    && value.stale_snapshot_fallback === true
    && value.empty_snapshot_fallback === true
    && value.malformed_payload_fallback === true
    && value.usage_exact_once_graph === true
    && value.usage_exact_once_fallback === true,
  );
}

function p11IsolationReady(evidence) {
  const value = evidence?.profile_isolation;
  return Boolean(
    value
    && value.standard_legacy_only === true
    && value.deep_legacy_only === true
    && value.standard_fetch_count === 0
    && value.deep_fetch_count === 0,
  );
}

function p11SecurityReady(evidence) {
  const value = evidence?.security;
  return Boolean(
    value
    && value.runtime_auth_mode === 'publishable'
    && value.service_role_runtime_used === false
    && value.security_advisor_p9_p10_warn_error_count === 0,
  );
}

function repositoryBindingReady(binding, repository) {
  return Boolean(
    repository
    && typeof repository === 'object'
    && !Array.isArray(repository)
    && repository.p11_evidence_head_matches === true
    && repository.query_source_sha256 === binding.query_source_sha256
    && repository.router_source_sha256 === binding.router_source_sha256
    && repository.p11_evidence_sha256 === binding.p11_evidence_sha256,
  );
}

function liveProjectionComplete(binding, liveProjection) {
  return Boolean(
    liveProjection
    && typeof liveProjection === 'object'
    && !Array.isArray(liveProjection)
    && liveProjection.candidate_count === binding.projection_candidate_count
    && liveProjection.metadata_complete_count === binding.projection_metadata_complete_count
    && liveProjection.unique_legacy_id_count === binding.projection_unique_legacy_id_count,
  );
}

function unique(values) {
  return [...new Set(values)];
}

export function createP12ActivationBinding({
  p11EvidenceHead,
  p11ImplementationSha,
  target,
  projectionSnapshotDate,
  querySourceSha256,
  routerSourceSha256,
  p11EvidenceSha256,
} = {}) {
  const evidenceHead = requireGitSha(p11EvidenceHead, 'p11 evidence head commit SHA');
  const implementationSha = requireGitSha(p11ImplementationSha, 'p11 implementation commit SHA');
  if (evidenceHead !== P11_EVIDENCE_HEAD) {
    throw new Error(`p11 evidence head commit SHA must be ${P11_EVIDENCE_HEAD}`);
  }
  if (implementationSha !== P11_IMPLEMENTATION_SHA) {
    throw new Error(`p11 implementation commit SHA must be ${P11_IMPLEMENTATION_SHA}`);
  }

  return {
    schema_version: 'reference-graph.p12-activation-binding.v1',
    p11_evidence_head: evidenceHead,
    p11_implementation_sha: implementationSha,
    target: requireExactTarget(target),
    profile: 'quick',
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_value: 'graph',
    runtime_auth_mode: 'publishable',
    service_role_runtime_allowed: false,
    timeout_ms: 1500,
    legacy_first: true,
    record_parity_required: 'exact-ordered',
    pattern_parity_required: 'exact-ordered',
    fallback_source: 'legacy-control',
    standard_mode: 'legacy-only',
    deep_mode: 'legacy-only',
    repository_default_graph_enabled: false,
    projection_snapshot_date: requireDate(projectionSnapshotDate),
    projection_candidate_count: 275,
    projection_metadata_complete_count: 275,
    projection_unique_legacy_id_count: 275,
    query_source_sha256: requireSha256(querySourceSha256, 'query source SHA-256'),
    router_source_sha256: requireSha256(routerSourceSha256, 'router source SHA-256'),
    p11_evidence_sha256: requireSha256(p11EvidenceSha256, 'P11 evidence SHA-256'),
    rollback_action: 'unset-or-change-REFERENCE_GRAPH_QUICK_RUNTIME',
  };
}

export function hashP12ActivationBinding(binding) {
  requireObject(binding, 'binding');
  return createHash('sha256').update(canonicalJson(binding), 'utf8').digest('hex');
}

export function evaluateP12ActivationPreflight({
  binding,
  p11Evidence,
  liveProjection,
  security,
  repository,
  now,
} = {}) {
  requireObject(binding, 'binding');
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new TypeError('now must be a valid Date');
  }

  const currentDate = now.toISOString().slice(0, 10);
  const checks = {
    binding_contract: bindingContractReady(binding),
    p11_readiness: p11ReadinessReady(p11Evidence),
    p11_canary: p11CanaryReady(p11Evidence),
    p11_fallback: p11FallbackReady(p11Evidence),
    p11_profile_isolation: p11IsolationReady(p11Evidence),
    p11_security: p11SecurityReady(p11Evidence),
    repository_binding: repositoryBindingReady(binding, repository),
    repository_default_off: repository?.repository_default_graph_enabled === false,
    repository_no_migration_010: repository?.migration_010_present === false,
    repository_no_service_role_runtime: repository?.service_role_runtime_reference === false,
    live_target_healthy: liveProjection?.target_status === 'ACTIVE_HEALTHY',
    live_snapshot_current_utc_date:
      liveProjection?.snapshot_date === currentDate
      && binding.projection_snapshot_date === currentDate,
    live_projection_complete: liveProjectionComplete(binding, liveProjection),
    live_projection_identity_clean:
      liveProjection?.empty_legacy_id_count === 0
      && liveProjection?.duplicate_legacy_id_count === 0,
    security_boundary:
      security?.runtime_auth_mode === 'publishable'
      && security?.service_role_runtime_used === false
      && security?.security_advisor_p9_p10_warn_error_count === 0,
  };

  const blockerByCheck = {
    binding_contract: 'P12 activation binding does not match the frozen contract',
    p11_readiness: 'P11 activation-readiness evidence is not structurally green',
    p11_canary: 'P11 live canary is not exact across all 24 quick cases',
    p11_fallback: 'P11 fallback and usage-once evidence is incomplete',
    p11_profile_isolation: 'P11 standard/deep legacy-only isolation is incomplete',
    p11_security: 'P11 publishable-only runtime security evidence is incomplete',
    repository_binding: 'repository source or P11 evidence hashes do not match the activation binding',
    repository_default_off: 'repository default graph mode is not off',
    repository_no_migration_010: 'P12 repository contains a forbidden activation migration 010',
    repository_no_service_role_runtime: 'repository contains a forbidden service-role runtime reference',
    live_target_healthy: 'dedicated Reference Graph target is not ACTIVE_HEALTHY',
    live_snapshot_current_utc_date: 'projection snapshot does not match current UTC date',
    live_projection_complete: 'live projection is not complete at 275/275/275',
    live_projection_identity_clean: 'live projection contains empty or duplicate legacy identities',
    security_boundary: 'live runtime security boundary is not publishable-only and warning-free',
  };

  const blockers = unique(
    Object.entries(checks)
      .filter(([, passed]) => passed !== true)
      .map(([name]) => blockerByCheck[name]),
  );

  return {
    preflightReady: blockers.length === 0,
    bindingHash: hashP12ActivationBinding(binding),
    checks,
    blockers,
  };
}
