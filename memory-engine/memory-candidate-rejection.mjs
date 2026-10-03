export const CANDIDATE_REJECTION_POLICY_VERSION = 'candidate-rejection-v1';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function rejectMemoryCandidate({
  memory,
  projectId,
  branch,
  candidateId,
  rejectionEvidenceId,
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
  if (!nonEmptyString(rejectionEvidenceId)) {
    throw new TypeError('rejectionEvidenceId must be a non-empty string');
  }
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function');
  }
  if (typeof memory.rejectCandidate !== 'function') {
    throw new TypeError('memory does not support candidate rejection');
  }

  const result = memory.rejectCandidate({
    projectId,
    branch,
    candidateId,
    rejectionEvidenceId,
    policyVersion: CANDIDATE_REJECTION_POLICY_VERSION,
    rejectedAt: now(),
  });

  return {
    type: 'agent_hub_memory_candidate_rejection',
    policyVersion: CANDIDATE_REJECTION_POLICY_VERSION,
    ...result,
  };
}
