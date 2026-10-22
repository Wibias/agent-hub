import { createHash } from 'node:crypto';

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function evidenceId({ projectId, referenceId, learning, capturedAt }) {
  const digest = createHash('sha256')
    .update(`${projectId}\n${referenceId}\n${learning}\n${capturedAt}`, 'utf8')
    .digest('hex')
    .slice(0, 20);
  return `reference_evidence_${digest}`;
}

export function buildMemoryEvidenceProposal({
  explicitPromotion = false,
  projectId,
  referenceId,
  learning,
  requestedBy,
  capturedAt,
  requestId,
} = {}) {
  if (explicitPromotion !== true) return null;

  const normalized = {
    projectId: requireString(projectId, 'projectId'),
    referenceId: requireString(referenceId, 'referenceId'),
    learning: requireString(learning, 'learning'),
    requestedBy: requireString(requestedBy, 'requestedBy'),
    capturedAt: requireString(capturedAt, 'capturedAt'),
    requestId: requireString(requestId, 'requestId'),
  };

  return {
    protocol: 'memory.protocol.v1',
    operation: 'capture_evidence',
    request_id: normalized.requestId,
    payload: {
      id: evidenceId(normalized),
      project_id: normalized.projectId,
      harness: 'reference-graph',
      source_kind: 'agent_inference',
      source_ref: `reference:${normalized.referenceId}`,
      captured_at: normalized.capturedAt,
      content: normalized.learning,
      metadata: {
        reference_id: normalized.referenceId,
        requested_by: normalized.requestedBy,
        promotion_stage: 'evidence_only',
      },
    },
  };
}
