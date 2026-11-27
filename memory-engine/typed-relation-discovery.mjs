/**
 * Bounded, read-only discovery of typed advisory relation proposals.
 * Candidate signals are not relation evidence. The existing semantic judge
 * validates the exact scope and allowed output contract; no automatic writes.
 */
import { buildMemoryGraphV2 } from './memory-graph-v2.mjs';
import { extractClaimEntities } from './memory-graph-entities.mjs';
import {
  buildSemanticRelationPrompt,
  parseSemanticRelationResponse,
  SEMANTIC_RELATION_POLICY_VERSION,
} from './semantic-relation-judge.mjs';

const DISCOVERY_AUTHORITIES = new Set(['user_direct', 'repo_trusted', 'tool_observation', 'agent_inference']);

function bounded(value, max, name) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(name + ' must be an integer from 1 to ' + max);
  }
}

function eligible(node) {
  return node.lifecycleStatus === 'current'
    && ['not_repository', 'fresh'].includes(node.freshness?.status)
    && DISCOVERY_AUTHORITIES.has(node.authority)
    && typeof node.provenance?.evidenceId === 'string'
    && typeof node.value === 'string'
    && node.value.length <= 2000;
}

function pairKey(a, b) {
  return JSON.stringify([a, b].sort());
}

export function planTypedRelationDiscovery({
  memory, projectId, branch, sourceClaimId = null, afterClaimId = null,
  maxSources = 5, maxTargets = 6, at = new Date().toISOString(),
} = {}) {
  bounded(maxSources, 10, 'maxSources');
  bounded(maxTargets, 12, 'maxTargets');
  if (sourceClaimId !== null && afterClaimId !== null) {
    throw new TypeError('sourceClaimId and afterClaimId are mutually exclusive');
  }
  const graph = buildMemoryGraphV2(memory, {
    projectId, branch, at, includeSimilarity: true,
    semanticThreshold: 0.82, maxSemanticNeighbors: 5,
  });
  const nodes = graph.nodes.filter(eligible).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (sourceClaimId !== null && !nodes.some(node => node.id === sourceClaimId)) {
    throw new Error('source claim is not eligible in the bounded branch graph');
  }
  const nodeIds = new Set(nodes.map(node => node.id));
  const signals = new Map();
  const excluded = new Set();
  const existing = new Set();
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    const key = pairKey(edge.from, edge.to);
    if (edge.relation === 'conflicts_with') excluded.add(key);
    if (edge.source === 'embedding_similarity') signals.set(key, edge.weight);
    if (edge.source === 'typed_relation') {
      existing.add(JSON.stringify([edge.from, edge.to]));
      if (!edge.directed) existing.add(JSON.stringify([edge.to, edge.from]));
    }
  }
  const keysByNode = new Map(nodes.map(node => [
    node.id, new Set(extractClaimEntities(node.value)
      .filter(entity => ['technology', 'product', 'module', 'code'].includes(entity.kind))
      .map(entity => entity.key)),
  ]));
  const sources = nodes.filter(node => sourceClaimId !== null
    ? node.id === sourceClaimId
    : afterClaimId === null || node.id.localeCompare(afterClaimId, 'en') > 0);
  const candidateSources = [];
  for (const source of sources) {
    const candidates = [];
    for (const target of nodes) {
      if (target.id === source.id) continue;
      const key = pairKey(source.id, target.id);
      if (excluded.has(key) || existing.has(JSON.stringify([source.id, target.id]))) continue;
      const similarity = signals.get(key) ?? null;
      const shared = [...keysByNode.get(source.id)].filter(item => keysByNode.get(target.id).has(item)).length;
      if (similarity === null && shared === 0) continue;
      candidates.push({ claimId: target.id, similarity, sharedEntities: shared });
    }
    candidates.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0)
      || b.sharedEntities - a.sharedEntities || a.claimId.localeCompare(b.claimId, 'en'));
    if (candidates.length) candidateSources.push({
      sourceClaimId: source.id, targets: candidates.slice(0, maxTargets),
      omittedTargets: Math.max(0, candidates.length - maxTargets),
    });
  }
  const batches = candidateSources.slice(0, maxSources);
  return {
    projectId, branch, at, policyVersion: SEMANTIC_RELATION_POLICY_VERSION,
    mode: 'read-only-plan', graphTruncated: Boolean(graph.stats?.truncated),
    eligibleClaims: nodes.length, candidateSources: candidateSources.length,
    batches, remainingSources: Math.max(0, candidateSources.length - batches.length),
    nextAfterClaimId: candidateSources.length > batches.length ? batches.at(-1).sourceClaimId : null,
  };
}

/** Compare only relevant immutable inputs, not unrelated DB changes. */
function scopeSnapshot(canonical, ids) {
  return JSON.stringify(ids.map(id => {
    const claim = canonical.claims.find(item => item.id === id);
    const evidence = canonical.evidence.find(item => item.id === claim?.created_from_evidence_id);
    return [claim ?? null, evidence ?? null];
  }));
}

export async function discoverTypedRelations({
  memory, projectId, branch, sourceClaimId = null, afterClaimId = null,
  maxSources = 5, maxTargets = 6, judge,
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof judge !== 'function') throw new TypeError('judge is required');
  const plan = planTypedRelationDiscovery({
    memory, projectId, branch, sourceClaimId, afterClaimId, maxSources, maxTargets, at: now(),
  });
  const results = [];
  const seen = new Set();
  for (const batch of plan.batches) {
    const targetClaimIds = batch.targets.map(target => target.claimId);
    const ids = [batch.sourceClaimId, ...targetClaimIds];
    const canonical = memory.exportCanonical();
    const scope = {
      canonical, projectId, branch, sourceClaimId: batch.sourceClaimId,
      targetClaimIds, at: now(),
    };
    const snapshot = scopeSnapshot(canonical, ids);
    let prompt;
    try {
      prompt = buildSemanticRelationPrompt(scope);
    } catch {
      results.push({ sourceClaimId: batch.sourceClaimId, status: 'invalid_context', proposals: [] });
      continue;
    }
    let raw;
    try {
      raw = await judge({ prompt, projectId, branch, sourceClaimId: batch.sourceClaimId, targetClaimIds });
    } catch {
      results.push({ sourceClaimId: batch.sourceClaimId, status: 'judge_failed', proposals: [] });
      continue;
    }
    const current = memory.exportCanonical();
    if (scopeSnapshot(current, ids) !== snapshot) {
      results.push({ sourceClaimId: batch.sourceClaimId, status: 'stale_context', proposals: [] });
      continue;
    }
    try {
      const proposals = parseSemanticRelationResponse(raw, { ...scope, canonical: current, at: now() })
        .filter(proposal => {
          if (seen.has(proposal.key)) return false;
          seen.add(proposal.key);
          return true;
        });
      results.push({ sourceClaimId: batch.sourceClaimId, status: 'ok', proposals });
    } catch {
      results.push({ sourceClaimId: batch.sourceClaimId, status: 'invalid_response', proposals: [] });
    }
  }
  return {
    ...plan, mode: 'read-only-discovery', results,
    proposed: results.reduce((sum, result) => sum + result.proposals.length, 0),
    failed: results.filter(result => result.status !== 'ok').length,
  };
}
