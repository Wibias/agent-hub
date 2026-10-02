import { createHash } from 'node:crypto';

export const CANDIDATE_CONFIRMATION_POLICY_VERSION = 'confirmation-v2';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function memoryCandidateConfirmationClaimId(candidateId) {
  if (!nonEmptyString(candidateId)) {
    throw new TypeError('candidateId must be a non-empty string');
  }
  return 'memory-confirmed-' + createHash('sha256')
    .update(candidateId, 'utf8')
    .digest('hex')
    .slice(0, 24);
}

export function confirmMemoryCandidate({
  memory,
  projectId,
  branch,
  candidateId,
  relation,
  targetClaimId = null,
  confirmationEvidenceId,
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
  if (!nonEmptyString(candidateId)) {
    throw new TypeError('candidateId must be a non-empty string');
  }
  if (!['same', 'update', 'contradict', 'unrelated'].includes(relation)) {
    throw new TypeError('relation must be same, update, contradict, or unrelated');
  }
  if (relation === 'unrelated' && targetClaimId !== null) {
    throw new TypeError('unrelated confirmation requires targetClaimId=null');
  }
  if (relation !== 'unrelated' && !nonEmptyString(targetClaimId)) {
    throw new TypeError(relation + ' confirmation requires targetClaimId');
  }
  if (!nonEmptyString(confirmationEvidenceId)) {
    throw new TypeError('confirmationEvidenceId must be a non-empty string');
  }
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function');
  }
  if (typeof memory.confirmCandidate !== 'function') {
    throw new TypeError('memory does not support candidate confirmation');
  }

  const result = memory.confirmCandidate({
    projectId,
    branch,
    candidateId,
    relation,
    targetClaimId,
    claimId: memoryCandidateConfirmationClaimId(candidateId),
    confirmationEvidenceId,
    policyVersion: CANDIDATE_CONFIRMATION_POLICY_VERSION,
    confirmedAt: now(),
  });

  return {
    type: 'agent_hub_memory_candidate_confirmation',
    policyVersion: CANDIDATE_CONFIRMATION_POLICY_VERSION,
    ...result,
  };
}
