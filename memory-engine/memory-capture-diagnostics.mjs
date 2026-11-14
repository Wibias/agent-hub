/** Read-only, content-free diagnosis of scoped Memory capture and promotion. */
import { DatabaseSync } from 'node:sqlite';

const SAFE_STAGES = new Set([
  'importance', 'relation', 'promotion',
  'agent_importance', 'agent_relation', 'agent_promotion',
  'evidence_extraction', 'evidence_importance', 'evidence_support',
  'evidence_relation', 'evidence_promotion',
  'pipeline_control', 'semantic_sync', 'worker',
]);
const SAFE_CLASSES = new Set([
  'PipelineStalled', 'PipelineMaxRounds', 'RestoreLocked',
  'candidate_stage_failure',
]);

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(label + ' must be non-empty text');
  }
  return value.trim();
}

const DIRECT_CANDIDATE_VALIDATION = /^(?:memory candidate judgment (?:response must be|must be)|unexpected field in memory candidate judgment:|missing field in memory candidate judgment:|(?:decision|suggested_type|durability|future_utility|specificity|confidence|meaning_preserved|canonical_fact|reason|risk_flags)(?: entry)? must |(?:promote|ignore) requires )/u;

/** Failure provenance comes from a fixed prefix, never a substring in provider output. */
export function classifyCaptureFailureOrigin(message) {
  const value = String(message ?? '').trim().toLowerCase();
  if (/^codex candidate judge failed with exit [0-9]+(?:\b|:)/u.test(value)) return 'judge_process_exit';
  if (/^(?:codex|node) timed out after [0-9]+ms/u.test(value)) return 'judge_timeout';
  if (/^(?:candidate judge requires|failed to initialize isolated judge workspace:)/u.test(value)) return 'judge_setup';
  if (DIRECT_CANDIDATE_VALIDATION.test(value)) return 'candidate_validator';
  return 'unknown';
}

/** Categories are diagnostic hints, never a verdict about the provider. */
export function classifyCaptureFailure(message) {
  const value = String(message ?? '').trim().toLowerCase();
  const origin = classifyCaptureFailureOrigin(value);
  if (/\b429\b|rate[ _-]?limit|too many requests|resource.exhausted|quota exceeded/u.test(value)) return 'rate_limit';
  if (/\b401\b|\b403\b|unauthori[sz]ed|permission denied|authentication failed/u.test(value)) return 'authorization';
  if (/timed? out|timeout|deadline exceeded|etimedout/u.test(value)) return 'timeout';
  if (/invalid model|model not found|unknown model|unsupported model|model format/u.test(value)) return 'model_configuration';
  if (origin === 'candidate_validator') return 'response_validation';
  if (/\b502\b|\b503\b|\b504\b|econnreset|econnrefused|network error|service unavailable/u.test(value)) return 'provider_unavailable';
  if (/database is locked|sqlite|foreign key|sql error/u.test(value)) return 'database';
  if (origin === 'judge_process_exit') return 'judge_process_failure';
  if (origin === 'judge_setup') return 'judge_setup_failure';
  return 'unclassified';
}

/** Fixed hints from a failed Codex process. This is not a provider verdict. */
export function classifyCaptureProcessSignal(message) {
  if (classifyCaptureFailureOrigin(message) !== 'judge_process_exit') return null;
  const value = String(message ?? '').toLowerCase();
  if (/\binvalid_model_format\b|invalid model format/u.test(value)) return 'invalid_model_format';
  if (/\bmodel_not_found\b|model (?:not found|does not exist)/u.test(value)) return 'model_not_found';
  if (/\binvalid_request_error\b|\bbad request\b|\bhttp 400\b/u.test(value)) return 'bad_request';
  if (/\binsufficient_quota\b|usage limit|quota exceeded|out of credits/u.test(value)) return 'quota_exhausted';
  if (/\b429\b|rate[ _-]?limit|too many requests/u.test(value)) return 'rate_limit';
  if (/\bauthentication_error\b|\bunauthorized\b|\bhttp 401\b/u.test(value)) return 'authentication';
  if (/\bpermission_denied\b|\bhttp 403\b/u.test(value)) return 'permission_denied';
  if (/\bcontext_length_exceeded\b|context window exceeded/u.test(value)) return 'context_limit';
  if (/\b(?:http 50[0234]|bad gateway|service unavailable|gateway timeout)\b/u.test(value)) return 'provider_5xx';
  if (/econnreset|econnrefused|connection (?:refused|reset|closed)|stream disconnected/u.test(value)) return 'connection';
  return 'unknown';
}

/** Fixed allowlist of validation error types, without exposing model output. */
export function classifyCaptureValidationDetail(message) {
  const value = String(message ?? '').toLowerCase();
  if (classifyCaptureFailureOrigin(value) !== 'candidate_validator') return null;
  if (/memory candidate judgment response must be json|unexpected (?:token|end of json input)|unterminated string in json|json at position/u.test(value)) return 'invalid_json';
  if (/unexpected field in memory candidate judgment/u.test(value)) return 'unexpected_field';
  if (/missing field in memory candidate judgment/u.test(value)) return 'missing_field';
  if (/(?:promote|ignore) requires/u.test(value)) return 'decision_invariant';
  if (/memory candidate judgment must be an object|(?:risk_flags|canonical_fact|meaning_preserved|suggested_type|durability|future_utility|specificity|confidence|reason|decision)(?: entry)? must (?:be|not|contain)|risk_flags must not contain duplicates/u.test(value)) return 'schema_violation';
  return 'other_validation';
}

const VALIDATION_FIELDS = Object.freeze([
  'decision', 'suggested_type', 'durability', 'future_utility',
  'specificity', 'confidence', 'meaning_preserved', 'canonical_fact',
  'reason', 'risk_flags',
]);

/** Emits only canonical schema field labels, never the failing output or unknown keys. */
export function classifyCaptureValidationField(message) {
  const detail = classifyCaptureValidationDetail(message);
  if (detail !== 'schema_violation' && detail !== 'decision_invariant') return null;

  const value = String(message ?? '').toLowerCase();
  if (detail === 'schema_violation' && /memory candidate judgment must be an object/u.test(value)) {
    return 'judgment_object';
  }
  for (const field of VALIDATION_FIELDS) {
    const pattern = new RegExp('(?:^|[^a-z_])' + field + '(?: entry)? must (?:be|not|contain)', 'u');
    if (pattern.test(value)) return field;
  }
  if (detail === 'decision_invariant') {
    const requirement = value.match(/(?:promote|ignore) requires (?:non-empty |empty )?([a-z_]+)(?:=|\b)/u)?.[1];
    return VALIDATION_FIELDS.includes(requirement) ? requirement : 'unknown';
  }
  return 'unknown';
}

/** Fixed error-shape labels. This never returns untrusted response fragments. */
export function classifyCaptureValidationRule(message) {
  if (classifyCaptureValidationDetail(message) !== 'schema_violation') return null;
  const value = String(message ?? '').toLowerCase();
  if (/must be one of:/u.test(value)) return 'invalid_enum';
  if (/must not contain duplicates/u.test(value)) return 'duplicate_entries';
  if (/must contain at most \d+ entries/u.test(value)) return 'too_many_entries';
  if (/must be at most \d+ characters/u.test(value)) return 'too_long';
  if (/must be an? (?:array|boolean|object|non-empty string)|must be a non-empty string/u.test(value)) return 'invalid_type_or_empty';
  return 'other_schema';
}

function sortGroups(rows, keys) {
  return rows.sort((a, b) => b.count - a.count
    || keys.map((key) => String(a[key]).localeCompare(String(b[key]), 'en')).find((n) => n !== 0) || 0);
}

/** Inspect only aggregates and allowlisted metadata; never emit stored text, IDs, or paths. */
export function inspectMemoryCapture({ dbPath, projectId, branch, recentLimit = 10 } = {}) {
  required(dbPath, 'dbPath');
  projectId = required(projectId, 'projectId');
  branch = required(branch, 'branch');
  if (!Number.isInteger(recentLimit) || recentLimit < 1 || recentLimit > 50) {
    throw new RangeError('recentLimit must be an integer between 1 and 50');
  }
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    const has = (table) => tables.has(table);
    const scalar = (sql) => Number(db.prepare(sql).get(projectId, branch)?.count ?? 0);
    const count = (table, clause) => has(table)
      ? scalar(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ? AND ${clause} = ?`)
      : null;

    const candidates = has('memory_candidates') ? db.prepare(`
      SELECT status, source_authority AS authority, proposed_type AS kind,
        CASE WHEN status = 'ignored' THEN 'ignored'
             WHEN status = 'needs_confirmation' THEN 'review'
             WHEN status IN ('promoted','superseded','failed') THEN 'finalized'
             WHEN evaluated_at IS NULL THEN 'importance'
             WHEN relation IS NULL THEN 'relation_or_review'
             ELSE 'promotion' END AS phase,
        COUNT(*) AS count
      FROM memory_candidates
      WHERE project_id = ? AND branch = ?
      GROUP BY status, source_authority, proposed_type, phase
    `).all(projectId, branch) : [];

    const proposals = has('memory_evidence_proposals') ? db.prepare(`
      SELECT status, kind,
        CASE WHEN status = 'ignored' THEN 'ignored'
             WHEN status = 'needs_confirmation' THEN 'review'
             WHEN status IN ('promoted','superseded','failed') THEN 'finalized'
             WHEN importance_json IS NULL THEN 'importance'
             WHEN support_json IS NULL THEN 'support'
             ELSE 'relation_or_promotion' END AS phase,
        COUNT(*) AS count
      FROM memory_evidence_proposals
      WHERE project_id = ? AND branch = ?
      GROUP BY status, kind, phase
    `).all(projectId, branch) : [];

    const failures = has('memory_pipeline_failures') ? db.prepare(`
      SELECT stage, error_class, error_text
      FROM memory_pipeline_failures
      WHERE project_id = ? AND branch = ?
    `).all(projectId, branch) : [];
    const failureGroups = new Map();
    for (const failure of failures) {
      const stage = SAFE_STAGES.has(failure.stage) ? failure.stage : 'other';
      const errorClass = SAFE_CLASSES.has(failure.error_class) ? failure.error_class : 'other';
      const category = classifyCaptureFailure(failure.error_text);
      const failureOrigin = classifyCaptureFailureOrigin(failure.error_text);
      const processSignal = classifyCaptureProcessSignal(failure.error_text);
      const validationDetail = classifyCaptureValidationDetail(failure.error_text);
      const validationField = classifyCaptureValidationField(failure.error_text);
      const validationRule = classifyCaptureValidationRule(failure.error_text);
      const key = JSON.stringify([stage, errorClass, category, failureOrigin, processSignal, validationDetail, validationField, validationRule]);
      failureGroups.set(key, (failureGroups.get(key) ?? 0) + 1);
    }
    const groupedFailures = sortGroups([...failureGroups].map(([key, n]) => {
      const [stage, errorClass, category, failureOrigin, processSignal, validationDetail, validationField, validationRule] = JSON.parse(key);
      return {
        stage, errorClass, category, failureOrigin,
        ...(processSignal === null ? {} : { processSignal }),
        ...(validationDetail === null ? {} : { validationDetail }),
        ...(validationField === null ? {} : { validationField }),
        ...(validationRule === null ? {} : { validationRule }),
        count: n,
      };
    }), ['stage', 'category']);

    const recentRuns = has('memory_pipeline_runs') ? db.prepare(`
      SELECT trigger, status, promoted_count AS promotedCount, started_at AS startedAt
      FROM memory_pipeline_runs
      WHERE project_id = ? AND branch = ?
      ORDER BY started_at DESC, id DESC LIMIT ?
    `).all(projectId, branch, recentLimit).map(({ trigger, status, promotedCount, startedAt }) => ({
      trigger: ['Stop', 'Stop:evidence_bound', 'SubagentStop', 'manual', 'UserPromptSubmit'].includes(trigger) ? trigger : 'other',
      status: ['drained', 'partial', 'failed', 'stalled', 'max_rounds', 'restore_locked', 'running'].includes(status) ? status : 'other',
      promotedCount: Number(promotedCount),
      startedAt,
    })) : [];

    return {
      type: 'agent_hub_memory_capture_diagnostic_v1',
      readOnly: true,
      scope: { projectId, branch },
      claims: count('claims', 'branch_scope'),
      activeClaims: has('claims') ? Number(db.prepare(`
        SELECT COUNT(*) AS count FROM claims
        WHERE project_id = ? AND branch_scope = ? AND state = 'active'
      `).get(projectId, branch)?.count ?? 0) : null,
      candidates: { available: has('memory_candidates'), total: candidates.reduce((s, x) => s + x.count, 0), groups: sortGroups(candidates, ['status', 'phase']) },
      evidenceProposals: { available: has('memory_evidence_proposals'), total: proposals.reduce((s, x) => s + x.count, 0), groups: sortGroups(proposals, ['status', 'phase']) },
      pipeline: {
        available: has('memory_pipeline_runs'),
        failureLedgerAvailable: has('memory_pipeline_failures'),
        failureCount: failures.length,
        failureGroups: groupedFailures,
        recentRuns,
      },
    };
  } finally {
    db.close();
  }
}
