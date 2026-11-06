import { createHash } from 'node:crypto';
import { inspectAtomicReviewRows, atomicReviewRef } from './memory-atomic-review-provenance.mjs';
import { previewAtomicRuleDraft } from './memory-atomic-rule-draft.mjs';
import { proposeAtomicCandidateShadows } from './memory-atomic-candidate-shadow.mjs';

export const ATOMIC_RULE_STAGING_POLICY_VERSION = 'atomic-confirmed-staging-v1';
export const ATOMIC_RULE_STAGING_SCHEMA_SQL = [
  'CREATE TABLE IF NOT EXISTS memory_atomic_rule_staging (',
  'id TEXT PRIMARY KEY,',
  'project_id TEXT NOT NULL REFERENCES project_registry(project_id),',
  'branch TEXT NOT NULL,',
  'source_candidate_id TEXT NOT NULL REFERENCES memory_candidates(id),',
  'source_evidence_id TEXT NOT NULL REFERENCES evidence(id),',
  'confirmation_evidence_id TEXT NOT NULL UNIQUE REFERENCES evidence(id),',
  'draft_ref TEXT NOT NULL,',
  'rule_sha256 TEXT NOT NULL CHECK (length(rule_sha256) = 64),',
  'policy_version TEXT NOT NULL,',
  "duration TEXT NOT NULL CHECK (duration = 'permanent'),",
  "status TEXT NOT NULL CHECK (status = 'awaiting_promotion_review'),",
  'staged_at TEXT NOT NULL,',
  'UNIQUE (project_id, branch, source_candidate_id, rule_sha256)',
  ') STRICT;',
  'CREATE TABLE IF NOT EXISTS memory_atomic_rule_staging_spans (',
  'staging_id TEXT NOT NULL REFERENCES memory_atomic_rule_staging(id) ON DELETE CASCADE,',
  'review_ref TEXT NOT NULL,',
  'start_offset INTEGER NOT NULL,',
  'end_offset INTEGER NOT NULL,',
  'fragment_sha256 TEXT NOT NULL CHECK (length(fragment_sha256) = 64),',
  'PRIMARY KEY (staging_id, review_ref),',
  'CHECK (start_offset >= 0 AND end_offset > start_offset)',
  ') STRICT;',
  'CREATE INDEX IF NOT EXISTS memory_atomic_rule_staging_scope',
  'ON memory_atomic_rule_staging (project_id, branch, status, staged_at);',
].join('\n');

const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const proper = value => typeof value === 'string' && value.trim().length > 0 && value.trim() === value;

function requireDb(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.exec !== 'function') {
    throw new TypeError('DatabaseSync-like db required');
  }
}

/** Never called by constructor or capture hook: explicit separate migration. */
export function installAtomicRuleStagingSchema(db) {
  requireDb(db);
  db.exec(ATOMIC_RULE_STAGING_SCHEMA_SQL);
}

/** Stable exact-string syntax for a future authenticated user-prompt hook. */
export function atomicRuleConfirmationText({ projectId, branch, draftRef, ruleText }) {
  if (![projectId,branch,draftRef,ruleText].every(proper)
    || /[\r\n]/u.test(projectId + branch + draftRef + ruleText)
    || !/^~d[0-9a-f]{16}$/u.test(draftRef)) {
    throw new TypeError('invalid exact confirmation scope');
  }
  return 'MEMORY CONFIRM PERMANENT PROJECT RULE '
    + draftRef + ' FOR ' + projectId + '@' + branch + ': ' + ruleText;
}

function verifyConfirmation(row, request, createdAt, sourceEvidenceId) {
  let metadata;
  try { metadata = JSON.parse(row?.metadata_json); } catch {}
  if (!row || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || row.id === sourceEvidenceId
    || row.project_id !== request.projectId || row.branch !== request.branch
    || row.authority_class !== 'user_direct' || row.sensitivity !== 'normal'
    || row.source_kind !== 'session' || row.harness !== 'codex'
    || !proper(row.session_id)
    || row.source_ref !== 'session:' + row.session_id
    || row.path !== null
    || metadata.event_type !== 'user_prompt'
    || metadata.hook_event_name !== 'UserPromptSubmit'
    || metadata.explicit_memory !== true
    || metadata.explicit_memory_mode !== 'atomic_rule_confirm'
    || metadata.atomic_rule_draft_ref !== request.draftRef
    || row.content_redacted !== atomicRuleConfirmationText(request)) {
    throw new Error('direct-user exact-rule confirmation evidence invalid');
  }
  if (!Number.isFinite(Date.parse(row.captured_at))
    || !Number.isFinite(Date.parse(createdAt))
    || Date.parse(row.captured_at) <= Date.parse(createdAt)) {
    throw new Error('direct-user confirmation must follow source candidate');
  }
}

function verifiedSource(db, request) {
  const rows = db.prepare(
    'SELECT c.id AS candidate_id, c.project_id, c.branch AS candidate_branch, '
    + 'c.source_authority, c.proposed_type, c.proposed_value, c.status, '
    + 'c.evaluated_at, c.source_evidence_id, c.created_at, '
    + 'e.id AS evidence_id, e.project_id AS evidence_project_id, '
    + 'e.branch AS evidence_branch, e.authority_class, e.sensitivity, e.content_redacted '
    + 'FROM memory_candidates c LEFT JOIN evidence e ON c.source_evidence_id = e.id '
    + 'WHERE c.id = ? AND c.project_id = ? AND c.branch = ?'
  ).all(request.candidateId, request.projectId, request.branch);
  if (rows.length !== 1) throw new Error('source Candidate not in requested scope');
  const source = rows[0];
  const report = inspectAtomicReviewRows(rows, {
    projectId: request.projectId, branch: request.branch,
  });
  if (report.excludedIntegrity !== 0 || report.candidatesWithVerifiedEvidence !== 1
    || report.candidates[0].reviewHintCount < 1) {
    throw new Error('source Candidate integrity or Evidence invalid');
  }
  const draft = previewAtomicRuleDraft({
    report,
    candidateRef: report.candidates[0].candidateRef,
    reviewRefs: request.reviewRefs,
    draftText: request.ruleText,
  });
  if (draft.draftRef !== request.draftRef) throw new Error('draft reference mismatch');

  const generated = proposeAtomicCandidateShadows(source.proposed_value);
  const spans = request.reviewRefs.map(reviewRef => {
    const suggestion = generated.suggestions.find(item => atomicReviewRef({
      candidateId: source.candidate_id,
      evidenceId: source.evidence_id,
      sourceHash: item.sourceHash,
      fragmentHash: item.fragmentHash,
      start: item.start,
      end: item.end,
    }) === reviewRef);
    if (!suggestion || source.proposed_value.slice(suggestion.start,suggestion.end) !== suggestion.fragment) {
      throw new Error('source fragment verification failed');
    }
    return {
      reviewRef, start: suggestion.start, end: suggestion.end,
      hash: suggestion.fragmentHash,
    };
  });
  return { source, spans };
}

/**
 * Stage one rule from a NEW, separately captured direct user confirmation.
 *
 * No Claim is created; no original Candidate is altered. The staging sidecar
 * stores only a hash of the canonical rule (the complete text stays in the
 * existing authenticated confirmation Evidence). Explicit schema setup is
 * required before this function can run.
 */
export function stageConfirmedAtomicRule(request = {}) {
  const {
    db, projectId, branch, candidateId, reviewRefs, draftRef, ruleText,
    confirmationEvidenceId, stagedAt = new Date().toISOString(),
  } = request;
  requireDb(db);
  if (![projectId,branch,candidateId,draftRef,ruleText,confirmationEvidenceId,stagedAt].every(proper)
    || !Array.isArray(reviewRefs) || reviewRefs.length < 1 || reviewRefs.length > 5
    || reviewRefs.some(value => !/^~a[0-9a-f]{16}$/u.test(value))
    || new Set(reviewRefs).size !== reviewRefs.length
    || !Number.isFinite(Date.parse(stagedAt))) {
    throw new TypeError('complete bounded scoped rule staging request required');
  }
  if (!db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='memory_atomic_rule_staging'"
  ).get()) throw new Error('atomic staging schema is not installed');
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) {
    throw new Error('atomic staging requires SQLite foreign-key enforcement');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const verified = verifiedSource(db, {
      projectId, branch, candidateId, reviewRefs, draftRef, ruleText,
    });
    const confirmation = db.prepare(
      'SELECT * FROM evidence WHERE id = ?'
    ).get(confirmationEvidenceId);
    verifyConfirmation(confirmation, {
      projectId, branch, candidateId, reviewRefs, draftRef, ruleText,
    }, verified.source.created_at, verified.source.evidence_id);
    if (Date.parse(stagedAt) < Date.parse(confirmation.captured_at)) {
      throw new Error('staging timestamp cannot precede direct-user confirmation');
    }

    const alreadyActive = db.prepare(
      'SELECT id FROM claims WHERE project_id = ? AND branch_scope = ? '
      + "AND state = 'active' AND kind = 'user_direct' "
      + "AND subject = 'user memory' AND predicate = 'states' AND value_text = ? LIMIT 1"
    ).get(projectId, branch, ruleText);
    if (alreadyActive) throw new Error('exact durable Claim is already active');

    const stageId = 'atomic-stage-' + sha256(JSON.stringify([
      ATOMIC_RULE_STAGING_POLICY_VERSION, projectId, branch, candidateId,
      draftRef, confirmationEvidenceId,
    ])).slice(0,24);
    const ruleHash = sha256(ruleText);
    const existing = db.prepare(
      'SELECT * FROM memory_atomic_rule_staging WHERE id = ?'
    ).get(stageId);
    if (existing) {
      const priorRefs = db.prepare(
        'SELECT review_ref FROM memory_atomic_rule_staging_spans WHERE staging_id = ? ORDER BY review_ref'
      ).all(stageId).map(row => row.review_ref);
      if (existing.project_id !== projectId || existing.branch !== branch
        || existing.source_candidate_id !== candidateId
        || existing.source_evidence_id !== verified.source.evidence_id
        || existing.confirmation_evidence_id !== confirmationEvidenceId
        || existing.draft_ref !== draftRef || existing.rule_sha256 !== ruleHash
        || JSON.stringify(priorRefs) !== JSON.stringify([...reviewRefs].sort())) {
        throw new Error('existing stage has mismatched provenance');
      }
      db.exec('COMMIT');
      return {
        status:'already_staged',stageId,selectedReviewHintCount:reviewRefs.length,
        durableClaimCreated:false,originalCandidateModified:false,promotionAllowed:false,
      };
    }

    db.prepare(
      'INSERT INTO memory_atomic_rule_staging '
      + '(id,project_id,branch,source_candidate_id,source_evidence_id,'
      + 'confirmation_evidence_id,draft_ref,rule_sha256,policy_version,'
      + 'duration,status,staged_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(
      stageId,projectId,branch,candidateId,verified.source.evidence_id,
      confirmationEvidenceId,draftRef,ruleHash,ATOMIC_RULE_STAGING_POLICY_VERSION,
      'permanent','awaiting_promotion_review',stagedAt,
    );
    const insertSpan = db.prepare(
      'INSERT INTO memory_atomic_rule_staging_spans '
      + '(staging_id,review_ref,start_offset,end_offset,fragment_sha256) '
      + 'VALUES (?,?,?,?,?)'
    );
    for (const span of verified.spans) {
      insertSpan.run(stageId,span.reviewRef,span.start,span.end,span.hash);
    }
    db.exec('COMMIT');
    return {
      status:'staged_for_promotion_review',stageId,
      selectedReviewHintCount:verified.spans.length,
      durableClaimCreated:false,originalCandidateModified:false,promotionAllowed:false,
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
