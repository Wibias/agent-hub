import { createHash } from 'node:crypto';
import { inspectMemoryTextSensitivity } from './index.mjs';
import { previewAtomicReviewIntent } from './memory-atomic-review-provenance.mjs';

/**
 * One operator-written rule draft, bound to verified evidence-backed review
 * spans. This is a local preview, NOT user-direct confirmation evidence and
 * never a request to insert a Candidate or Claim.
 */
export function previewAtomicRuleDraft({
  report,
  candidateRef,
  reviewRefs,
  draftText,
} = {}) {
  const selection = previewAtomicReviewIntent({
    report,
    candidateRef,
    reviewRefs,
    intent: 'retain_for_confirmation',
  });
  if (typeof draftText !== 'string') {
    throw new TypeError('draft text must be a string');
  }
  const draft = draftText.replace(/^\uFEFF/u, '').trim();
  if (draft.length < 40 || draft.length > 500 || /[\r\n]/u.test(draft)) {
    throw new TypeError('one 40..500-character draft sentence is required');
  }
  if (inspectMemoryTextSensitivity(draft).containsSecret
    || /\b(?:api[_-]?key|access[_-]?token|password|passwort)\s*[:=]/iu.test(draft)) {
    throw new TypeError('draft contains potentially sensitive material');
  }

  const identity = [
    'atomic-rule-draft-preview-v1',
    selection.scope.projectId,
    selection.scope.branch,
    selection.candidateRef,
    ...selection.reviewRefs,
    draft,
  ];
  const draftRef = '~d' + createHash('sha256')
    .update(JSON.stringify(identity), 'utf8')
    .digest('hex')
    .slice(0, 16);
  return {
    type: 'agent_hub_atomic_rule_draft_preview_v1',
    status: 'awaiting_explicit_user_direct_confirmation',
    mode: 'preview_only',
    readOnly: true,
    writesToSource: false,
    modelInvocations: 0,
    scope: selection.scope,
    candidateRef: selection.candidateRef,
    reviewRefs: [...selection.reviewRefs],
    selectedHintCount: selection.selectedHintCount,
    proposedRuleCount: 1,
    draftRef,
    draftTextIncluded: false,
    evidenceVerified: true,
    semanticEquivalenceVerified: false,
    durationConfirmed: false,
    confirmationEvidencePresent: false,
    claimCreated: false,
    promotionAllowed: false,
    originalCandidateConfirmable: false,
    nextAction: 'Human must review the local rule draft for accurate meaning, scope and duration. Obtain a NEW explicit direct-user confirmation and separately implement audited atomic evidence storage; never promote the mixed original Candidate.',
  };
}
