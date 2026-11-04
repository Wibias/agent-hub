import { createHash } from 'node:crypto';

/**
 * D1a: advisory semantic relation contract only.
 * This module does not persist, authorize, or modify lifecycle state.
 */
const TYPES = new Set(['supports', 'depends_on', 'implements', 'related_to']);
export const RELATION_AUTHORITY_CLASSES = Object.freeze([
  'user_direct', 'repo_trusted', 'tool_observation',
  'agent_inference', 'external_untrusted', 'unclassified',
]);
const AUTHORITY_TAG_KINDS = new Set(RELATION_AUTHORITY_CLASSES);

/** A claim's kind may be a category like 'decision'. Evidence determines authority. */
export function relationClaimEvidenceAuthority(claim, evidence) {
  if (!claim || !evidence || !AUTHORITY_TAG_KINDS.has(evidence.authority_class)) {
    throw new Error('semantic relation requires valid Evidence authority');
  }
  // Legacy claims may have a descriptive kind. If the kind itself names an
  // authority class, it must not contradict the primary Evidence authority.
  if (AUTHORITY_TAG_KINDS.has(claim.kind) && claim.kind !== evidence.authority_class) {
    throw new Error('claim/evidence authority mismatch');
  }
  return evidence.authority_class;
}

const INPUT_KEYS = new Set([
  'projectId', 'branch', 'sourceClaimId', 'targetClaimId',
  'relation', 'confidence', 'reason',
]);

function requireText(value, label, maxLength = 512) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new TypeError(`${label} must be non-empty text of at most ${maxLength} characters`);
  }
  return value.trim();
}

function normalizedEdge({ projectId, branch, sourceClaimId, targetClaimId, relation }) {
  const fields = {
    projectId: requireText(projectId, 'projectId'),
    branch: requireText(branch, 'branch'),
    sourceClaimId: requireText(sourceClaimId, 'sourceClaimId'),
    targetClaimId: requireText(targetClaimId, 'targetClaimId'),
    relation: requireText(relation, 'relation', 32),
  };
  if (!TYPES.has(fields.relation)) throw new TypeError(`unsupported typed relation: ${fields.relation}`);
  if (fields.sourceClaimId === fields.targetClaimId) throw new TypeError('typed relation claims must be distinct');
  if (fields.relation === 'related_to' && fields.sourceClaimId > fields.targetClaimId) {
    [fields.sourceClaimId, fields.targetClaimId] = [fields.targetClaimId, fields.sourceClaimId];
  }
  return fields;
}

/** Stable deduplication key. Does not imply truth or authority. */
export function typedRelationKey(input) {
  const fields = normalizedEdge(input);
  return createHash('sha256').update(JSON.stringify([
    'semantic-relation-v1', fields.projectId, fields.branch,
    fields.sourceClaimId, fields.targetClaimId, fields.relation,
  ])).digest('hex');
}

/**
 * Verify that an advisory proposal points only to two distinct, active,
 * same-project, same-branch claims in a canonical export. Does not write DB.
 */
export function validateClaimRelationProposal(canonical, proposal) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    throw new TypeError('proposal must be an object');
  }
  for (const field of Object.keys(proposal)) {
    if (!INPUT_KEYS.has(field)) throw new TypeError(`unexpected field: ${field}`);
  }
  const edge = normalizedEdge(proposal);
  if (proposal.confidence !== 'high') throw new TypeError('semantic relation requires high confidence');
  const reason = requireText(proposal.reason, 'reason', 500);
  if (!canonical || !Array.isArray(canonical.claims)) {
    throw new TypeError('canonical claims are required');
  }
  const matchesFor = (id) => canonical.claims.filter((claim) => claim?.id === id);
  const sources = matchesFor(edge.sourceClaimId);
  const targets = matchesFor(edge.targetClaimId);
  if (sources.length !== 1 || targets.length !== 1) throw new Error('claim not found or ambiguous');
  const [source] = sources;
  const [target] = targets;
  for (const claim of [source, target]) {
    if (claim.project_id !== edge.projectId || claim.branch_scope !== edge.branch) {
      throw new Error('relation claims must share the same project and branch');
    }
    if (claim.state !== 'active') throw new Error('semantic relation requires active claims');
  }
  return Object.freeze({
    key: typedRelationKey(edge),
    project_id: edge.projectId,
    branch_scope: edge.branch,
    source_claim_id: edge.sourceClaimId,
    target_claim_id: edge.targetClaimId,
    relation: edge.relation,
    origin: 'inferred',
    advisory: true,
    directed: edge.relation !== 'related_to',
    confidence: 'high',
    reason,
  });
}
