import { createHash } from 'node:crypto';

export const CANDIDATE_PROMOTION_POLICY_VERSION = 'promotion-v1';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function memoryCandidatePromotionClaimId(candidateId) {
  if (!nonEmptyString(candidateId)) {
    throw new TypeError('candidateId must be a non-empty string');
  }
  return 'memory-auto-' + createHash('sha256')
    .update(candidateId, 'utf8')
    .digest('hex')
    .slice(0, 24);
}

export function finalizePromotedMemoryCandidates({
  memory,
  projectId,
  branch,
  apply = false,
  limit = 10,
  now = () => new Date().toISOString(),
} = {}) {
  if (!memory || typeof memory !== 'object') {
    throw new TypeError('memory must be a MemoryEngine-like object');
  }
  if (!nonEmptyString(projectId)) {
    throw new TypeError('projectId must be a non-empty string');
  }
  if (!nonEmptyString(branch)) {
    throw new TypeError('branch must be a non-empty string');
  }
  if (typeof apply !== 'boolean') {
    throw new TypeError('apply must be a boolean');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new RangeError('limit must be an integer between 1 and 20');
  }
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function');
  }
  if (typeof memory.listPromotionReadyCandidates !== 'function') {
    throw new TypeError('memory does not support promotion-ready candidate listing');
  }

  const candidates = memory.listPromotionReadyCandidates({
    projectId,
    branch,
    limit,
  });

  const results = [];
  let promoted = 0;
  let superseded = 0;
  let needsConfirmation = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const claimId = memoryCandidatePromotionClaimId(candidate.id);
    try {
      let outcome;
      if (apply) {
        if (typeof memory.finalizeCandidatePromotion !== 'function') {
          throw new TypeError('memory does not support candidate promotion finalization');
        }
        outcome = memory.finalizeCandidatePromotion({
          candidateId: candidate.id,
          claimId,
          policyVersion: CANDIDATE_PROMOTION_POLICY_VERSION,
          finalizedAt: now(),
        });
      } else {
        if (typeof memory.previewCandidatePromotion !== 'function') {
          throw new TypeError('memory does not support candidate promotion preview');
        }
        outcome = memory.previewCandidatePromotion({
          candidateId: candidate.id,
          claimId,
          policyVersion: CANDIDATE_PROMOTION_POLICY_VERSION,
          finalizedAt: now(),
        });
      }

      if (outcome.status === 'promoted') promoted += 1;
      else if (outcome.status === 'superseded') superseded += 1;
      else if (outcome.status === 'needs_confirmation') needsConfirmation += 1;

      results.push({
        candidate_id: candidate.id,
        claim_id: outcome.claim_id,
        relation: outcome.relation,
        status: outcome.status,
        applied: apply,
      });
    } catch (error) {
      failed += 1;
      results.push({
        candidate_id: candidate.id,
        claim_id: null,
        relation: candidate.relation,
        status: 'failed',
        applied: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    type: 'agent_hub_memory_candidate_promotion',
    mode: apply ? 'apply' : 'dry-run',
    projectId,
    branch,
    policyVersion: CANDIDATE_PROMOTION_POLICY_VERSION,
    summary: {
      total: candidates.length,
      promoted,
      superseded,
      needs_confirmation: needsConfirmation,
      failed,
      results,
    },
  };
}
