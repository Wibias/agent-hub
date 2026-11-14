import { createHash } from 'node:crypto';
import {
  evidenceBoundDecisionRef,
  inspectEvidenceBoundDecision,
} from './evidence-bound-decision-preflight.mjs';

export const EVIDENCE_BOUND_INTENT_POLICY = 'evidence-bound-review-intent-v1';
export const EVIDENCE_BOUND_INTENT_SCHEMA_SQL = [
  'CREATE TABLE IF NOT EXISTS memory_evidence_bound_review_intents (',
  'proposal_id TEXT PRIMARY KEY REFERENCES memory_evidence_proposals(id),',
  'decision_evidence_id TEXT NOT NULL UNIQUE REFERENCES evidence(id),',
  'project_id TEXT NOT NULL, branch TEXT NOT NULL,',
  'revision_sha TEXT NOT NULL CHECK (length(revision_sha) = 40),',
  'proposal_ref TEXT NOT NULL,',
  'snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256) = 64),',
  'canonical_fact_sha256 TEXT NOT NULL CHECK (length(canonical_fact_sha256) = 64),',
  "decision TEXT NOT NULL CHECK (decision IN ('confirm','reject')),",
  'policy_version TEXT NOT NULL, recorded_at TEXT NOT NULL,',
  "status TEXT NOT NULL CHECK (status = 'awaiting_independent_host_authorization')",
  ') STRICT;',
  'CREATE INDEX IF NOT EXISTS memory_evidence_bound_review_intents_scope',
  'ON memory_evidence_bound_review_intents(project_id, branch, recorded_at);',
].join('\n');

const nonempty = value => typeof value === 'string'
  && value.trim().length > 0 && value === value.trim();

export function evidenceBoundReviewIntentCommand({
  proposalRef, projectId, branch, revisionSha, snapshotSha256,
  canonicalFactSha256, decision,
} = {}) {
  if (!/^E~[0-9a-f]{10}$/u.test(proposalRef ?? '')
    || !nonempty(projectId) || /[\s:@]/u.test(projectId)
    || !nonempty(branch) || /[\s:@]/u.test(branch)
    || !/^[0-9a-f]{40}$/u.test(revisionSha ?? '')
    || !/^[0-9a-f]{64}$/u.test(snapshotSha256 ?? '')
    || !/^[0-9a-f]{64}$/u.test(canonicalFactSha256 ?? '')
    || !['confirm','reject'].includes(decision)) {
    throw new TypeError('exact review intent fields required');
  }
  return 'MEMORY EVIDENCE REVIEW ' + decision.toUpperCase()
    + ' ' + proposalRef + ' FOR ' + projectId + '@' + branch
    + ' REV ' + revisionSha
    + ' SNAP ' + snapshotSha256 + ' FACT ' + canonicalFactSha256;
}

/** No auto-migration: only invoked separately in approved, isolated scopes. */
export function installEvidenceBoundReviewIntentSchema(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.exec !== 'function') {
    throw new TypeError('DatabaseSync-like db required');
  }
  db.exec(EVIDENCE_BOUND_INTENT_SCHEMA_SQL);
}

/**
 * Writes a review INTENT, never a final decision or Claim. The user_direct
 * label is not authentication of a hostile same-account agent.
 * Not wired to hooks, MCP, CLI, Stop or any auto-pipeline.
 */
export function stageEvidenceBoundReviewIntent({
  db, projectId, branch, revisionSha, selectedRef,
  expectedSnapshot, expectedFactHash, decision, decisionEvidenceId, recordedAt,
} = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.exec !== 'function'
    || !nonempty(projectId) || !nonempty(branch)
    || !/^[0-9a-f]{40}$/u.test(revisionSha ?? '')
    || !/^E~[0-9a-f]{10}$/u.test(selectedRef ?? '')
    || !/^[0-9a-f]{64}$/u.test(expectedSnapshot ?? '')
    || !/^[0-9a-f]{64}$/u.test(expectedFactHash ?? '')
    || !['confirm','reject'].includes(decision)
    || !nonempty(decisionEvidenceId)
    || !nonempty(recordedAt) || !Number.isFinite(Date.parse(recordedAt))) {
    throw new TypeError('exact scope, review snapshot and intent evidence required');
  }
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) {
    throw new Error('foreign-key enforcement required');
  }
  if (!db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_evidence_bound_review_intents'",
  ).get()) {
    throw new Error('explicit review intent schema not installed');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const preview = inspectEvidenceBoundDecision({
      db, projectId, branch, revisionSha, selectedRef,
    });
    if (!['requires_review','reviewable_no_write_authority'].includes(preview.status)
      || preview.reviewSnapshotSha256 !== expectedSnapshot
      || preview.canonicalFactHash !== expectedFactHash
      || preview.promotionAllowed !== false
      || preview.hostUserOriginAuthenticated !== false) {
      throw new Error('review snapshot is stale or ineligible');
    }
    const matches = db.prepare(
      "SELECT id, created_at FROM memory_evidence_proposals "
      + "WHERE project_id=? AND branch=? AND status='needs_confirmation'",
    ).all(projectId, branch)
      .filter(row => evidenceBoundDecisionRef(row.id) === selectedRef);
    if (matches.length !== 1) throw new Error('ambiguous proposal identity');
    const proposal = matches[0];
    const source = db.prepare('SELECT * FROM evidence WHERE id=?').get(decisionEvidenceId);
    let metadata;
    try { metadata = JSON.parse(source?.metadata_json ?? 'null'); } catch {}
    const expectedCommand = evidenceBoundReviewIntentCommand({
      proposalRef: selectedRef,
      projectId, branch, revisionSha,
      snapshotSha256: expectedSnapshot, canonicalFactSha256: expectedFactHash,
      decision,
    });
    if (!source || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || source.project_id !== projectId || source.branch !== branch
      || source.authority_class !== 'user_direct' || source.sensitivity !== 'normal'
      || source.harness !== 'codex' || source.source_kind !== 'session'
      || !nonempty(source.session_id)
      || source.source_ref !== 'session:' + source.session_id
      || source.path !== null || source.content_redacted !== expectedCommand
      || metadata.event_type !== 'user_prompt'
      || metadata.hook_event_name !== 'UserPromptSubmit'
      || metadata.explicit_memory !== true
      || metadata.explicit_memory_mode !== 'evidence_bound_review_intent'
      || !Number.isFinite(Date.parse(source.captured_at))
      || Date.parse(source.captured_at) <= Date.parse(proposal.created_at)
      || Date.parse(recordedAt) < Date.parse(source.captured_at)) {
      throw new Error('fresh exact user-direct review-intent Evidence required');
    }
    if (db.prepare(
      'SELECT 1 FROM memory_evidence_proposal_evidence WHERE proposal_id=? AND evidence_id=?',
    ).get(proposal.id, decisionEvidenceId)) {
      throw new Error('review intent cannot reuse original proposal Evidence');
    }
    const previous = db.prepare(
      'SELECT * FROM memory_evidence_bound_review_intents WHERE proposal_id=?',
    ).get(proposal.id);
    if (previous) {
      if (previous.decision_evidence_id !== decisionEvidenceId
        || previous.project_id !== projectId || previous.branch !== branch
        || previous.revision_sha !== revisionSha
        || previous.proposal_ref !== selectedRef
        || previous.snapshot_sha256 !== expectedSnapshot
        || previous.canonical_fact_sha256 !== expectedFactHash
        || previous.decision !== decision
        || previous.policy_version !== EVIDENCE_BOUND_INTENT_POLICY
        || previous.status !== 'awaiting_independent_host_authorization') {
        throw new Error('conflicting review intent or stale replay');
      }
      db.exec('COMMIT');
      return {
        status: 'already_staged', proposalRef: selectedRef,
        independentHostAuthorizationEstablished: false,
        claimCreated: false, proposalModified: false,
      };
    }
    const inserted = db.prepare(
      'INSERT INTO memory_evidence_bound_review_intents '
      + '(proposal_id,decision_evidence_id,project_id,branch,revision_sha,'
      + 'proposal_ref,snapshot_sha256,canonical_fact_sha256,decision,'
      + 'policy_version,recorded_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      proposal.id, decisionEvidenceId, projectId, branch, revisionSha,
      selectedRef, expectedSnapshot, expectedFactHash, decision,
      EVIDENCE_BOUND_INTENT_POLICY, recordedAt,
      'awaiting_independent_host_authorization',
    );
    if (Number(inserted.changes) !== 1) throw new Error('review intent insert raced');
    db.exec('COMMIT');
    return {
      status: 'staged_for_independent_host_authorization',
      proposalRef: selectedRef,
      independentHostAuthorizationEstablished: false,
      claimCreated: false, proposalModified: false,
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
