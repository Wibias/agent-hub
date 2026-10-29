import { expandMemoryGraph } from './memory-graph.mjs';

const POLICY_VERSION = 'graph-recall-shadow-v1';
const DEFAULT_MAX_ANCHORS = 3;
const DEFAULT_MAX_HOPS = 1;
const DEFAULT_MAX_CANDIDATES = 8;
const DEFAULT_MIN_WEIGHT = 0.82;

function boundedInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`expected integer between ${min} and ${max}`);
  }
  return value;
}

function boundedNumber(value, fallback, { min = 0, max = 1 } = {}) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`expected number between ${min} and ${max}`);
  }
  return value;
}

function uniqueIds(values) {
  const seen = new Set();
  const ids = [];
  for (const value of values ?? []) {
    if (typeof value !== 'string' || value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

function clockValue(clockMs) {
  const value = Number(clockMs());
  return Number.isFinite(value) ? value : 0;
}

export function estimateGraphRecallCandidateTokens(value) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (text.length === 0) return 0;
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

export function evaluateGraphRecallShadow({
  graph,
  sourceCandidates = [],
  authoritativeSelectedIds = [],
  judgeCalled = false,
  judgeAvailable = false,
  maxAnchors = DEFAULT_MAX_ANCHORS,
  maxHops = DEFAULT_MAX_HOPS,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  minWeight = DEFAULT_MIN_WEIGHT,
  clockMs = () => performance.now(),
} = {}) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new TypeError('graph with nodes and edges is required');
  }
  if (!Array.isArray(sourceCandidates)) {
    throw new TypeError('sourceCandidates must be an array');
  }
  if (!Array.isArray(authoritativeSelectedIds)) {
    throw new TypeError('authoritativeSelectedIds must be an array');
  }
  if (typeof clockMs !== 'function') {
    throw new TypeError('clockMs must be a function');
  }

  const anchorLimit = boundedInteger(maxAnchors, DEFAULT_MAX_ANCHORS, { min: 1, max: 20 });
  const hopLimit = boundedInteger(maxHops, DEFAULT_MAX_HOPS, { min: 1, max: 5 });
  const candidateLimit = boundedInteger(maxCandidates, DEFAULT_MAX_CANDIDATES, { min: 1, max: 100 });
  const weightFloor = boundedNumber(minWeight, DEFAULT_MIN_WEIGHT);
  const startedAt = clockValue(clockMs);

  const graphNodeById = new Map();
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== 'string' || node.id.length === 0) continue;
    if (!graphNodeById.has(node.id)) graphNodeById.set(node.id, node);
  }
  const graphIds = new Set(graphNodeById.keys());

  const sourceTextById = new Map();
  const sourceIds = [];
  const sourceSeen = new Set();
  for (const candidate of sourceCandidates) {
    if (!candidate || typeof candidate.id !== 'string' || candidate.id.length === 0) continue;
    if (!sourceTextById.has(candidate.id)) {
      sourceTextById.set(
        candidate.id,
        typeof candidate.text === 'string' ? candidate.text : String(candidate.text ?? ''),
      );
    }
    if (sourceSeen.has(candidate.id)) continue;
    sourceSeen.add(candidate.id);
    sourceIds.push(candidate.id);
  }

  const presentSourceIds = sourceIds.filter((id) => graphIds.has(id));
  const missingAnchorIds = sourceIds.filter((id) => !graphIds.has(id));
  const anchorIds = presentSourceIds.slice(0, Math.min(anchorLimit, candidateLimit));

  const expansion = anchorIds.length > 0
    ? expandMemoryGraph(graph, {
        anchorIds,
        maxHops: hopLimit,
        maxCandidates: candidateLimit,
        minWeight: weightFloor,
      })
    : { anchorIds: [], claimIds: [], traversedEdges: [] };

  const graphCandidateIds = uniqueIds(expansion.claimIds);
  const graphCandidateSet = new Set(graphCandidateIds);
  const sourceSet = new Set(sourceIds);
  const sourceRetainedIds = sourceIds.filter((id) => graphCandidateSet.has(id));
  const sourcePrunedIds = sourceIds.filter((id) => !graphCandidateSet.has(id));
  const novelGraphIds = graphCandidateIds.filter((id) => !sourceSet.has(id));

  const normalizedAuthoritativeIds = uniqueIds(authoritativeSelectedIds);
  const authoritativeHitIds = normalizedAuthoritativeIds.filter((id) => graphCandidateSet.has(id));
  const falseNegativeIds = normalizedAuthoritativeIds.filter((id) => !graphCandidateSet.has(id));
  const qualityEligible = judgeCalled === true && judgeAvailable === true;

  const finalSelectionRecall = (
    qualityEligible && normalizedAuthoritativeIds.length > 0
      ? authoritativeHitIds.length / normalizedAuthoritativeIds.length
      : null
  );
  const exactPreservation = qualityEligible ? falseNegativeIds.length === 0 : null;

  const estimatedSourceTokens = sourceIds.reduce(
    (total, id) => total + estimateGraphRecallCandidateTokens(sourceTextById.get(id) ?? ''),
    0,
  );
  const estimatedGraphTokens = graphCandidateIds.reduce((total, id) => {
    const value = sourceTextById.has(id)
      ? sourceTextById.get(id)
      : graphNodeById.get(id)?.value ?? '';
    return total + estimateGraphRecallCandidateTokens(value);
  }, 0);

  const finishedAt = clockValue(clockMs);
  const localDurationMs = Math.max(0, finishedAt - startedAt);

  return {
    schemaVersion: 1,
    policyVersion: POLICY_VERSION,
    qualityEligible,
    judgeCalled: judgeCalled === true,
    judgeAvailable: judgeAvailable === true,
    anchorIds,
    missingAnchorIds,
    graphCandidateIds,
    sourceRetainedIds,
    sourcePrunedIds,
    novelGraphIds,
    authoritativeSelectedIds: normalizedAuthoritativeIds,
    authoritativeHitIds,
    falseNegativeIds,
    traversedEdges: [...(expansion.traversedEdges ?? [])],
    metrics: {
      source_candidate_count: sourceIds.length,
      anchor_count: anchorIds.length,
      missing_anchor_count: missingAnchorIds.length,
      graph_candidate_count: graphCandidateIds.length,
      source_retained_count: sourceRetainedIds.length,
      source_pruned_count: sourcePrunedIds.length,
      novel_graph_count: novelGraphIds.length,
      authoritative_selected_count: normalizedAuthoritativeIds.length,
      authoritative_hit_count: authoritativeHitIds.length,
      false_negative_count: falseNegativeIds.length,
      final_selection_recall: finalSelectionRecall,
      exact_preservation: exactPreservation,
      graph_vs_source_candidate_delta: graphCandidateIds.length - sourceIds.length,
      estimated_source_candidate_tokens: estimatedSourceTokens,
      estimated_graph_candidate_tokens: estimatedGraphTokens,
      local_duration_ms: localDurationMs,
    },
  };
}
