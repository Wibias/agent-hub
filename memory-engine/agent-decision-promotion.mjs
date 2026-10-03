import { createHash } from 'node:crypto';

export const AGENT_DECISION_PROMOTION_POLICY_VERSION = 'agent-promotion-v1';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function agentDecisionPromotionClaimId(candidateId) {
  if (!nonEmpty(candidateId)) {
    throw new TypeError('candidateId must be a non-empty string');
  }
  return 'agent-memory-' + createHash('sha256')
    .update(candidateId, 'utf8')
    .digest('hex')
    .slice(0, 24);
}

export function finalizeAgentDecisionCandidates({
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
  if (!nonEmpty(projectId) || !nonEmpty(branch)) {
    throw new TypeError('projectId and branch must be non-empty');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new RangeError('limit must be an integer between 1 and 20');
  }

  const candidates = memory.listAgentPromotionReadyCandidates({
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
    const claimId = agentDecisionPromotionClaimId(candidate.id);
    try {
      const outcome = apply
        ? memory.finalizeAgentCandidatePromotion({
          candidateId: candidate.id,
          claimId,
          policyVersion: AGENT_DECISION_PROMOTION_POLICY_VERSION,
          finalizedAt: now(),
        })
        : memory.previewAgentCandidatePromotion({
          candidateId: candidate.id,
          claimId,
          policyVersion: AGENT_DECISION_PROMOTION_POLICY_VERSION,
          finalizedAt: now(),
        });

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
    type: 'agent_hub_agent_decision_promotion',
    mode: apply ? 'apply' : 'dry-run',
    projectId,
    branch,
    policyVersion: AGENT_DECISION_PROMOTION_POLICY_VERSION,
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
