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

/** Categories are diagnostic hints, never a verdict about the provider. */
export function classifyCaptureFailure(message) {
  const value = String(message ?? '').toLowerCase();
  if (/\b429\b|rate[ _-]?limit|too many requests|resource.exhausted|quota exceeded/u.test(value)) return 'rate_limit';
  if (/\b401\b|\b403\b|unauthori[sz]ed|permission denied|authentication failed/u.test(value)) return 'authorization';
  if (/timed? out|timeout|deadline exceeded|etimedout/u.test(value)) return 'timeout';
  if (/invalid model|model not found|unknown model|unsupported model|model format/u.test(value)) return 'model_configuration';
  if (/json|parse error|parsing|schema|validation|unexpected field|missing field|invalid (?:response|judgment|output)/u.test(value)) return 'response_validation';
  if (/\b502\b|\b503\b|\b504\b|econnreset|econnrefused|network error|service unavailable/u.test(value)) return 'provider_unavailable';
  if (/database is locked|sqlite|foreign key|sql error/u.test(value)) return 'database';
  return 'unclassified';
}

/** Fixed allowlist of validation error types, without exposing model output. */
export function classifyCaptureValidationDetail(message) {
  const value = String(message ?? '').toLowerCase();
  if (classifyCaptureFailure(value) !== 'response_validation') return null;
  if (/memory candidate judgment response must be json|unexpected (?:token|end of json input)|unterminated string in json|json at position/u.test(value)) return 'invalid_json';
  if (/unexpected field in memory candidate judgment/u.test(value)) return 'unexpected_field';
  if (/missing field in memory candidate judgment/u.test(value)) return 'missing_field';
  if (/(?:promote|ignore) requires/u.test(value)) return 'decision_invariant';
  if (/memory candidate judgment must be an object|(?:risk_flags|canonical_fact|meaning_preserved|suggested_type|durability|future_utility|specificity|confidence|reason|decision)(?: entry)? must (?:be|not|contain)|risk_flags must not contain duplicates/u.test(value)) return 'schema_violation';
  return 'other_validation';
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
      const validationDetail = classifyCaptureValidationDetail(failure.error_text);
      const key = JSON.stringify([stage, errorClass, category, validationDetail]);
      failureGroups.set(key, (failureGroups.get(key) ?? 0) + 1);
    }
    const groupedFailures = sortGroups([...failureGroups].map(([key, n]) => {
      const [stage, errorClass, category, validationDetail] = JSON.parse(key);
      return { stage, errorClass, category, ...(validationDetail === null ? {} : { validationDetail }), count: n };
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
