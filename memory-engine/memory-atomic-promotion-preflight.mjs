import { createHash } from 'node:crypto';
import { inspectAtomicReviewRows } from './memory-atomic-review-provenance.mjs';
import { previewAtomicRuleDraft } from './memory-atomic-rule-draft.mjs';
import { proposeAtomicCandidateShadows } from './memory-atomic-candidate-shadow.mjs';
import { atomicReviewRef } from './memory-atomic-review-provenance.mjs';
import {
  ATOMIC_RULE_STAGING_POLICY_VERSION,
  atomicRuleConfirmationText,
} from './memory-atomic-confirmed-staging.mjs';

const hash = value => createHash('sha256').update(value,'utf8').digest('hex');
const blocked = reason => ({
  status:'blocked',issue:reason,
  preflightPassed:false,manualRelationReviewRequired:true,
});

/**
 * Read-only safety preflight against an existing explicitly staged rule.
 * This is NOT a production promotion authority or a write-capable API.
 */
export function inspectAtomicPromotionPreflight({
  db, projectId, branch, stageId,
} = {}) {
  if (!db || typeof db.prepare !== 'function'
    || [projectId,branch,stageId].some(v => typeof v !== 'string' || !v.trim())) {
    throw new TypeError('exact project, branch and stage scope required');
  }
  const report = {
    type:'agent_hub_atomic_promotion_preflight_v1',
    readOnly:true,modelInvocations:0,writesToSource:false,
    claimCreated:false,promotionAllowed:false,
    scope:{projectId,branch},
    stageRef:'~s'+hash(stageId).slice(0,16),
  };
  let outcome;
  try {
    const installed = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_atomic_rule_staging'"
    ).get();
    if (!installed) return {...report,...blocked('staging_schema_missing')};
    const stage = db.prepare(
      'SELECT * FROM memory_atomic_rule_staging WHERE id=? AND project_id=? AND branch=?'
    ).get(stageId,projectId,branch);
    if (!stage) return {...report,...blocked('staging_entry_missing')};
    if (stage.status !== 'awaiting_promotion_review'
      || stage.duration !== 'permanent'
      || stage.policy_version !== ATOMIC_RULE_STAGING_POLICY_VERSION
      || !/^[0-9a-f]{64}$/u.test(stage.rule_sha256)
      || !/^~d[0-9a-f]{16}$/u.test(stage.draft_ref)) {
      return {...report,...blocked('staging_state_invalid')};
    }
    const source = db.prepare(
      'SELECT c.id AS candidate_id, c.project_id, c.branch AS candidate_branch, '
      + 'c.source_authority, c.proposed_type, c.proposed_value, c.status, '
      + 'c.evaluated_at, c.source_evidence_id, c.created_at, '
      + 'e.id AS evidence_id, e.project_id AS evidence_project_id, '
      + 'e.branch AS evidence_branch, e.authority_class, e.sensitivity, e.content_redacted '
      + 'FROM memory_candidates c LEFT JOIN evidence e ON e.id=c.source_evidence_id '
      + 'WHERE c.id=? AND c.project_id=? AND c.branch=?'
    ).get(stage.source_candidate_id,projectId,branch);
    const sourceReport = inspectAtomicReviewRows(source ? [source] : [], {
      projectId,branch,
    });
    if (!source || sourceReport.excludedIntegrity !== 0
      || sourceReport.candidatesWithVerifiedEvidence !== 1
      || source.evidence_id !== stage.source_evidence_id) {
      return {...report,...blocked('original_evidence_invalid')};
    }
    const confirmation = db.prepare('SELECT * FROM evidence WHERE id=?')
      .get(stage.confirmation_evidence_id);
    let metadata;
    try {metadata=JSON.parse(confirmation?.metadata_json);}catch{}
    if (!confirmation || !metadata || typeof metadata !== 'object'
      || confirmation.project_id !== projectId || confirmation.branch !== branch
      || confirmation.authority_class !== 'user_direct'
      || confirmation.sensitivity !== 'normal'
      || confirmation.harness !== 'codex'
      || confirmation.source_kind !== 'session'
      || typeof confirmation.session_id !== 'string' || !confirmation.session_id
      || confirmation.source_ref !== 'session:' + confirmation.session_id
      || confirmation.path !== null
      || metadata.event_type !== 'user_prompt'
      || metadata.hook_event_name !== 'UserPromptSubmit'
      || metadata.explicit_memory !== true
      || metadata.explicit_memory_mode !== 'atomic_rule_confirm'
      || metadata.atomic_rule_draft_ref !== stage.draft_ref
      || !Number.isFinite(Date.parse(source.created_at))
      || !Number.isFinite(Date.parse(confirmation.captured_at))
      || !Number.isFinite(Date.parse(stage.staged_at))
      || Date.parse(confirmation.captured_at) <= Date.parse(source.created_at)
      || Date.parse(stage.staged_at) < Date.parse(confirmation.captured_at)) {
      return {...report,...blocked('confirmation_evidence_invalid')};
    }
    const prefix = 'MEMORY CONFIRM PERMANENT PROJECT RULE '
      + stage.draft_ref + ' FOR ' + projectId + '@' + branch + ': ';
    if (!confirmation.content_redacted.startsWith(prefix)) {
      return {...report,...blocked('confirmation_text_invalid')};
    }
    const ruleText=confirmation.content_redacted.slice(prefix.length);
    if (!ruleText || hash(ruleText) !== stage.rule_sha256
      || confirmation.content_redacted !== atomicRuleConfirmationText({
        projectId,branch,draftRef:stage.draft_ref,ruleText,
      })) {
      return {...report,...blocked('confirmation_text_invalid')};
    }

    const spans = db.prepare(
      'SELECT * FROM memory_atomic_rule_staging_spans '
      + 'WHERE staging_id=? ORDER BY review_ref'
    ).all(stageId);
    if (spans.length < 1 || spans.length > 5
      || new Set(spans.map(s=>s.review_ref)).size !== spans.length) {
      return {...report,...blocked('original_spans_invalid')};
    }
    const allSuggestions=proposeAtomicCandidateShadows(source.proposed_value);
    const verifiedRefs = spans.map(span => {
      const suggestion=allSuggestions.suggestions.find(item =>
        atomicReviewRef({
          candidateId:source.candidate_id,evidenceId:source.evidence_id,
          sourceHash:item.sourceHash,fragmentHash:item.fragmentHash,
          start:item.start,end:item.end,
        }) === span.review_ref
        && item.start === span.start_offset
        && item.end === span.end_offset
        && item.fragmentHash === span.fragment_sha256
        && source.proposed_value.slice(item.start,item.end) === item.fragment,
      );
      return suggestion ? span.review_ref : null;
    });
    if (verifiedRefs.some(x=>x===null)) {
      return {...report,...blocked('original_spans_invalid')};
    }
    // Draft hashes bind to the human-reviewed original source order, not
    // the staging index's lexicographic review_ref order.
    const orderedRefs = allSuggestions.suggestions.map(item => atomicReviewRef({
      candidateId: source.candidate_id, evidenceId: source.evidence_id,
      sourceHash: item.sourceHash, fragmentHash: item.fragmentHash,
      start: item.start, end: item.end,
    })).filter(ref => verifiedRefs.includes(ref));
    if (orderedRefs.length !== verifiedRefs.length) {
      return {...report,...blocked('original_spans_invalid')};
    }
    const draft = previewAtomicRuleDraft({
      report:sourceReport,
      candidateRef:sourceReport.candidates[0].candidateRef,
      reviewRefs:orderedRefs,
      draftText:ruleText,
    });
    if (draft.draftRef !== stage.draft_ref) {
      return {...report,...blocked('draft_reference_invalid')};
    }

    const activeClaims = db.prepare(
      "SELECT COUNT(*) AS n FROM claims WHERE project_id=? AND branch_scope=? AND state='active'"
    ).get(projectId,branch).n;
    const exactDuplicate = db.prepare(
      "SELECT COUNT(*) AS n FROM claims WHERE project_id=? AND branch_scope=? "
      + "AND state='active' AND value_text=?"
    ).get(projectId,branch,ruleText).n;
    const unresolvedClaims = db.prepare(
      "SELECT COUNT(*) AS n FROM claims WHERE project_id=? AND branch_scope=? "
      + "AND state IN ('candidate','conflicted','stale')"
    ).get(projectId,branch).n;
    if (exactDuplicate > 0) {
      return {...report,...blocked('active_duplicate_claim'),activeClaims};
    }
    // Do not skip other unresolved memory work when the active Claim
    // ledger is empty. A fresh Claim must not silently supersede proposals
    // still awaiting user confirmation or other scoped candidates.
    const otherPendingCandidates = db.prepare(
      "SELECT COUNT(*) AS n FROM memory_candidates WHERE project_id=? AND branch=? "
      + "AND id<>? AND status NOT IN ('ignored','promoted','superseded')"
    ).get(projectId,branch,source.candidate_id).n;
    const proposalTable = db.prepare(
      "SELECT 1 AS present FROM sqlite_master "
      + "WHERE type='table' AND name='memory_evidence_proposals'"
    ).get();
    if (!proposalTable) {
      return {...report,...blocked('proposal_ledger_unavailable')};
    }
    const unresolvedEvidenceProposals = db.prepare(
      "SELECT COUNT(*) AS n FROM memory_evidence_proposals "
      + "WHERE project_id=? AND branch=? AND status NOT IN ('ignored','promoted','superseded')"
    ).get(projectId,branch).n;
    outcome = (activeClaims > 0 || unresolvedClaims > 0)
      ? {status:'needs_relation_review',manualRelationReviewRequired:true}
      : (otherPendingCandidates > 0 || unresolvedEvidenceProposals > 0)
        ? {status:'needs_unresolved_memory_review',manualRelationReviewRequired:true}
        : {status:'eligible_for_manual_promotion_review',manualRelationReviewRequired:false};
    return {
      ...report,...outcome,
      preflightPassed:true,
      confirmedScope:'permanent_branch_scoped',
      sourceEvidenceVerified:true,
      confirmationEvidenceVerified:true,
      sourceSpanCount:spans.length,
      activeClaimsInScope:activeClaims,
      unresolvedClaimsInScope:unresolvedClaims,
      otherPendingCandidates,
      unresolvedEvidenceProposals,
      requiresSeparateWriteCapableImplementation:true,
    };
  } catch {
    // Do not return database paths, error messages, source text or IDs.
    return {...report,...blocked('integrity_or_schema_error')};
  }
}
