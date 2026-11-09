/**
 * P62: nonexecuting review-record shape for future Reference Graph activation.
 *
 * This is a STRUCTURAL gate only. It cannot authenticate who supplied this
 * record, whether evidence was independently observed, whether a named signer
 * controls the owner key, or whether a nonce was spent/revoked on other hosts.
 * It is never imported by P11, P30, the public query or a release actuator.
 */
const SHA256 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ID = /^[A-Za-z0-9_-]{3,64}$/;
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;

const RECORD_KEYS = Object.freeze([
  'schema_version', 'repository', 'repository_sha', 'project_ref',
  'operator_id', 'operator_host_id', 'owner_id', 'independent_reviewer_id',
  'profiles', 'canary_percent', 'default_off',
  'snapshot_date', 'refreshed_at', 'not_before', 'expires_at',
  'evidence', 'human_approval', 'revocation',
]);
const EVIDENCE_KEYS = Object.freeze([
  'p26_frozen_source_sha256',
  'p7_p31_source_sha256',
  'standard_deep_48_case_full_public_sha256',
  'protected_data_api_24h_sha256',
  'production_multi_host_fencing_sha256',
  'production_rollback_rehearsal_sha256',
  'post_change_monitor_sha256',
]);
const APPROVAL_KEYS = Object.freeze([
  'reviewer_attestation_sha256', 'owner_activation_decision_sha256',
]);
const REVOCATION_KEYS = Object.freeze([
  'nonce', 'ledger_anchor_sha256', 'rollback_plan_sha256',
  'rollback_triggers',
]);
const REQUIRED_TRIGGERS = Object.freeze([
  'manual-revoke', 'signature-invalid', 'evidence-expired',
  'source-stale', 'http-error', 'timeout', 'parity-mismatch',
  'quality-regression', 'latency-budget', 'critical-monitor',
]);

function exact(value, keys) {
  return value !== null && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
}
function timestamp(value) {
  return typeof value === 'string' && UTC.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}
function allDigests(value, keys) {
  return exact(value, keys) && keys.every(k => SHA256.test(value[k]));
}
function sameMembers(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length
    && new Set(actual).size === actual.length
    && expected.every(x => actual.includes(x));
}

function result(contractValid, reason) {
  return {
    schema_version: 'reference-graph.p62-release-review-preflight.v1',
    contract_valid: contractValid,
    reason,
    // A submitted digest is only a claimed reference, not a verified
    // signature, origin record or authority decision.
    independent_source_attestation_verified: false,
    reviewer_identity_and_approval_verified: false,
    owner_identity_and_activation_approval_verified: false,
    signer_trust_anchor_verified: false,
    nonce_single_use_and_revocation_verified: false,
    protected_24h_soak_verified: false,
    production_multi_host_rollback_verified: false,
    runtime_controller_connected: false,
    activation_authorized: false,
    repository_default_graph_enabled: false,
  };
}

/**
 * Validate only the complete, versioned shape and the exact requested scope.
 * Even a perfectly shaped record with syntactically valid attestation digests
 * is BLOCKED until SEPARATE trusted validators authenticate the source,
 * signers, current revocation state, live operation and final owner decision.
 *
 * A code-merge owner waiver, P35 historical lock, P49/P50 CI or same-operator
 * source hash may never substitute for any of those validations.
 */
export function evaluateP62ReleaseReviewRecord({
  record, expectedRepositorySha, now = new Date(),
} = {}) {
  if (!SHA40.test(expectedRepositorySha ?? '')
    || !(now instanceof Date) || Number.isNaN(now.getTime())
    || !exact(record, RECORD_KEYS)
    || record.schema_version !== 'reference-graph.p62-release-review-record.v1'
    || record.repository !== 'Wibias/agent-hub'
    || record.repository_sha !== expectedRepositorySha
    || record.project_ref !== 'vrznfnxzlxaavpqbzbzd') {
    return result(false, 'repository-or-contract-invalid');
  }
  if (!ID.test(record.operator_id ?? '')
    || !ID.test(record.operator_host_id ?? '')
    || record.owner_id !== 'Wibias'
    || !ID.test(record.independent_reviewer_id ?? '')
    || record.independent_reviewer_id === record.owner_id
    || record.independent_reviewer_id === record.operator_id
    || !Array.isArray(record.profiles)
    || record.profiles.length < 1 || record.profiles.length > 2
    || !record.profiles.every(p => p === 'standard' || p === 'deep')
    || new Set(record.profiles).size !== record.profiles.length
    || !Number.isInteger(record.canary_percent)
    || record.canary_percent < 1 || record.canary_percent > 5
    || record.default_off !== true) {
    return result(false, 'scope-or-identity-invalid');
  }
  if (!timestamp(record.refreshed_at)
    || !timestamp(record.not_before)
    || !timestamp(record.expires_at)
    || typeof record.snapshot_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(record.snapshot_date)
    || record.snapshot_date !== record.refreshed_at.slice(0, 10)) {
    return result(false, 'snapshot-or-window-invalid');
  }
  const start = Date.parse(record.not_before);
  const end = Date.parse(record.expires_at);
  if (end <= start || end - start > 3_600_000
    || now.getTime() < start - 60_000
    || now.getTime() >= end) {
    return result(false, 'window-invalid');
  }
  if (!allDigests(record.evidence, EVIDENCE_KEYS)
    || !allDigests(record.human_approval, APPROVAL_KEYS)
    || !exact(record.revocation, REVOCATION_KEYS)
    || !NONCE.test(record.revocation.nonce ?? '')
    || !SHA256.test(record.revocation.ledger_anchor_sha256 ?? '')
    || !SHA256.test(record.revocation.rollback_plan_sha256 ?? '')
    || !sameMembers(record.revocation.rollback_triggers, REQUIRED_TRIGGERS)) {
    return result(false, 'evidence-approval-or-revocation-invalid');
  }

  return result(true, 'external-source-review-owner-and-revocation-trust-missing');
}

export const P62_MANDATORY_RELEASE_EVIDENCE = EVIDENCE_KEYS;
export const P62_MANDATORY_ROLLBACK_TRIGGERS = REQUIRED_TRIGGERS;
