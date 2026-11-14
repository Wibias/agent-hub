import { createHash } from 'node:crypto';
import { memoryCandidateJudgeRef } from './memory-candidate-judge.mjs';
import { proposeAtomicCandidateShadows } from './memory-atomic-candidate-shadow.mjs';

/**
 * Read-only candidate review protocol. A match is NOT a user confirmation,
 * and this module cannot create or promote a memory Claim.
 */
const KIND = new Set(['decision', 'preference', 'constraint', 'correction', 'rejected_approach', 'known_issue']);
const INTENT = new Set(['retain_for_confirmation', 'dismiss_preview', 'defer']);

const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

function validRow(row, projectId, branch) {
  return row
    && typeof row.candidate_id === 'string'
    && typeof row.evidence_id === 'string'
    && row.project_id === projectId
    && row.candidate_branch === branch
    && row.source_authority === 'user_direct'
    && row.status === 'pending'
    && row.evaluated_at === null
    && row.source_evidence_id === row.evidence_id
    && row.evidence_project_id === projectId
    && row.evidence_branch === branch
    && row.authority_class === 'user_direct'
    && row.sensitivity === 'normal'
    && typeof row.proposed_value === 'string'
    && row.proposed_value === row.content_redacted;
}

export function atomicReviewRef({ candidateId, evidenceId, sourceHash, start, end, fragmentHash }) {
  if ([candidateId, evidenceId, sourceHash, fragmentHash].some(
    value => typeof value !== 'string' || !value.trim(),
  ) || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end <= start) {
    throw new TypeError('invalid source-bound atomic review identity');
  }
  return '~a' + hash(JSON.stringify([
    'atomic-review-v1', candidateId, evidenceId, sourceHash, start, end, fragmentHash,
  ])).slice(0, 16);
}

export function inspectAtomicReviewRows(rows, {
  projectId,
  branch,
  showLocalContent = false,
} = {}) {
  if (!Array.isArray(rows) || typeof projectId !== 'string'
    || !projectId.trim() || typeof branch !== 'string' || !branch.trim()) {
    throw new TypeError('exact scoped rows required');
  }
  const candidates = [];
  let excludedIntegrity = 0;
  let excludedScopedAudit = 0;
  for (const row of rows) {
    if (!validRow(row, projectId, branch)) {
      excludedIntegrity += 1;
      continue;
    }
    const result = proposeAtomicCandidateShadows(row.proposed_value, {
      sourceAuthority: row.source_authority,
    });
    if (result.reason === 'scoped_audit_protocol') excludedScopedAudit++;
    const reviewHints = [];
    for (const item of result.suggestions) {
      if (row.proposed_value.slice(item.start, item.end) !== item.fragment) {
        excludedIntegrity += 1;
        continue;
      }
      reviewHints.push({
        reviewRef: atomicReviewRef({
          candidateId: row.candidate_id,
          evidenceId: row.evidence_id,
          sourceHash: item.sourceHash,
          fragmentHash: item.fragmentHash,
          start: item.start,
          end: item.end,
        }),
        kind: item.disposition,
        reasonCode: item.reasonCode,
        ...(showLocalContent ? { localVerbatimFragment: item.fragment } : {}),
      });
    }
    candidates.push({
      candidateRef: memoryCandidateJudgeRef(row.candidate_id),
      candidateKind: KIND.has(row.proposed_type) ? row.proposed_type : 'unknown',
      shadowReason: result.reason,
      reviewHintCount: reviewHints.length,
      hints: reviewHints,
    });
  }
  return {
    type: 'agent_hub_atomic_review_provenance_v1',
    readOnly: true,
    modelInvocations: 0,
    contentIncluded: showLocalContent,
    writesToSource: false,
    canPromote: false,
    scope: { projectId, branch },
    candidatesInspected: rows.length,
    candidatesWithVerifiedEvidence: candidates.length,
    excludedIntegrity,
    excludedScopedAudit,
    candidatesRequiringReview: candidates.filter(x => x.reviewHintCount > 0).length,
    reviewHintCount: candidates.reduce((n, x) => n + x.reviewHintCount, 0),
    candidates,
  };
}

export function previewAtomicReviewIntent({
  report,
  candidateRef,
  reviewRefs,
  intent,
} = {}) {
  if (!report || report.type !== 'agent_hub_atomic_review_provenance_v1'
    || !Array.isArray(report.candidates)
    || typeof candidateRef !== 'string'
    || !Array.isArray(reviewRefs)
    || reviewRefs.length < 1 || reviewRefs.length > 5
    || reviewRefs.some(x => typeof x !== 'string' || !x)
    || new Set(reviewRefs).size !== reviewRefs.length
    || !INTENT.has(intent)) {
    throw new TypeError('invalid explicit review intent');
  }
  const candidate = report.candidates.find(c => c.candidateRef === candidateRef);
  if (!candidate || reviewRefs.some(ref => !candidate.hints.some(h => h.reviewRef === ref))) {
    throw new Error('review selection is not grounded in this scoped candidate');
  }
  return {
    type: 'agent_hub_atomic_review_intent_preview_v1',
    readOnly: true,
    writesToSource: false,
    claimCreated: false,
    userConfirmationEvidencePresent: false,
    status: intent === 'retain_for_confirmation'
      ? 'explicit_direct_user_confirmation_required'
      : intent === 'dismiss_preview' ? 'dismissal_not_applied' : 'deferred_not_applied',
    intent,
    scope: report.scope,
    candidateRef,
    reviewRefs,
    selectedHintCount: reviewRefs.length,
    confirmedDurableRules: 0,
    operatorSelectionIsNotConfirmation: true,
    nextAction: intent === 'retain_for_confirmation'
      ? 'Obtain a new explicit user-direct confirmation of one precisely scoped, human-reviewed statement. Existing whole-candidate confirmation must not be used.'
      : 'No database mutation occurred.',
  };
}
