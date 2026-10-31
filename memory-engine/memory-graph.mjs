const DEFAULT_MAX_NODES = 500;
const DEFAULT_SEMANTIC_THRESHOLD = 0.82;
const DEFAULT_MAX_SEMANTIC_NEIGHBORS = 3;
const DEFAULT_MAX_HOPS = 1;
const DEFAULT_MAX_CANDIDATES = 8;

function requiredText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} is required`);
  }
  return value.trim();
}

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

function timeValue(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareClaims(left, right) {
  const leftActive = left.state === 'active' ? 1 : 0;
  const rightActive = right.state === 'active' ? 1 : 0;
  return (
    rightActive - leftActive
    || timeValue(right.created_at) - timeValue(left.created_at)
    || String(left.id).localeCompare(String(right.id), 'en')
  );
}

function evidenceProvenance(evidence) {
  if (!evidence) return null;
  return {
    evidenceId: evidence.id ?? null,
    harness: evidence.harness ?? null,
    sourceKind: evidence.source_kind ?? null,
    sourceRef: evidence.source_ref ?? null,
    capturedAt: evidence.captured_at ?? null,
    authorityClass: evidence.authority_class ?? null,
    commitSha: evidence.commit_sha ?? null,
    path: evidence.path ?? null,
    blobOid: evidence.blob_oid ?? null,
  };
}

function claimNode(memory, claim, evidence) {
  const inspected = typeof memory.inspectClaimObservability === 'function'
    ? memory.inspectClaimObservability({
        projectId: claim.project_id,
        branch: claim.branch_scope,
        claimId: claim.id,
      })
    : null;
  const usage = inspected?.recall_usage ?? null;
  const embeddings = (inspected?.embeddings ?? []).map((item) => ({
    modelId: item.model_id,
    modelRevision: item.model_revision,
    dimensions: item.dimensions,
    indexedAt: item.indexed_at,
  }));

  return {
    id: claim.id,
    value: claim.value_text,
    kind: claim.kind,
    subject: claim.subject,
    predicate: claim.predicate,
    state: claim.state,
    branch: claim.branch_scope,
    createdAt: claim.created_at,
    validFrom: claim.valid_from ?? null,
    validUntil: claim.valid_until ?? null,
    provenance: evidenceProvenance(evidence),
    semanticIndexed: inspected?.semantic_indexed === true,
    embeddingModels: embeddings,
    usage: usage
      ? {
          retrievalCount: Number(usage.retrieval_count ?? 0),
          retainedCount: Number(usage.retained_count ?? 0),
          contextCount: Number(usage.context_count ?? 0),
          lastRetainedAt: usage.last_retained_at ?? null,
          lastContextAt: usage.last_context_at ?? null,
        }
      : null,
  };
}

function lifecycleRelation(action) {
  if (action === 'supersede') return 'supersedes';
  if (action === 'reject') return 'rejects';
  return action ? String(action) : null;
}

function semanticProfileKey(item) {
  return `${item.model_id}\u0000${item.model_revision}\u0000${item.dimensions}`;
}

function cosineSimilarity(left, right) {
  if (!left || !right || left.length !== right.length || left.length === 0) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return null;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function pairKey(leftId, rightId) {
  return [leftId, rightId].sort((a, b) => a.localeCompare(b, 'en')).join('\u0000');
}

function semanticEdges(memory, claims, threshold, maxNeighbors) {
  if (
    typeof memory.inspectClaimObservability !== 'function'
    || typeof memory.getClaimEmbedding !== 'function'
  ) {
    return [];
  }

  const profiles = new Map();
  for (const claim of claims) {
    const inspected = memory.inspectClaimObservability({
      projectId: claim.project_id,
      branch: claim.branch_scope,
      claimId: claim.id,
    });
    for (const metadata of inspected?.embeddings ?? []) {
      if (
        typeof metadata.model_id !== 'string'
        || typeof metadata.model_revision !== 'string'
        || !Number.isInteger(metadata.dimensions)
        || metadata.dimensions <= 0
      ) {
        continue;
      }
      const stored = memory.getClaimEmbedding({
        claimId: claim.id,
        modelId: metadata.model_id,
        modelRevision: metadata.model_revision,
      });
      if (!stored?.vector || stored.vector.length !== metadata.dimensions) continue;
      const key = semanticProfileKey(metadata);
      if (!profiles.has(key)) profiles.set(key, []);
      profiles.get(key).push({
        claimId: claim.id,
        vector: stored.vector,
        modelId: metadata.model_id,
        modelRevision: metadata.model_revision,
        dimensions: metadata.dimensions,
      });
    }
  }

  const candidatesByPair = new Map();
  for (const profile of profiles.values()) {
    profile.sort((left, right) => left.claimId.localeCompare(right.claimId, 'en'));
    for (let leftIndex = 0; leftIndex < profile.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < profile.length; rightIndex += 1) {
        const left = profile[leftIndex];
        const right = profile[rightIndex];
        const similarity = cosineSimilarity(left.vector, right.vector);
        if (similarity === null || similarity < threshold) continue;
        const key = pairKey(left.claimId, right.claimId);
        const previous = candidatesByPair.get(key);
        if (!previous || similarity > previous.weight) {
          candidatesByPair.set(key, {
            id: `inferred:semantic:${left.claimId}:${right.claimId}:${left.modelId}@${left.modelRevision}`,
            from: left.claimId,
            to: right.claimId,
            relation: 'semantic_similarity',
            origin: 'inferred',
            directed: false,
            weight: similarity,
            provenance: {
              modelId: left.modelId,
              modelRevision: left.modelRevision,
              dimensions: left.dimensions,
            },
          });
        }
      }
    }
  }

  const candidates = [...candidatesByPair.values()].sort((left, right) => (
    right.weight - left.weight
    || left.from.localeCompare(right.from, 'en')
    || left.to.localeCompare(right.to, 'en')
    || left.id.localeCompare(right.id, 'en')
  ));
  const degree = new Map();
  const accepted = [];
  for (const edge of candidates) {
    const leftDegree = degree.get(edge.from) ?? 0;
    const rightDegree = degree.get(edge.to) ?? 0;
    if (leftDegree >= maxNeighbors || rightDegree >= maxNeighbors) continue;
    accepted.push(edge);
    degree.set(edge.from, leftDegree + 1);
    degree.set(edge.to, rightDegree + 1);
  }
  return accepted;
}

export function buildMemoryGraph(memory, {
  projectId,
  branch,
  maxNodes = DEFAULT_MAX_NODES,
  includeSemantic = true,
  semanticThreshold = DEFAULT_SEMANTIC_THRESHOLD,
  maxSemanticNeighbors = DEFAULT_MAX_SEMANTIC_NEIGHBORS,
} = {}) {
  if (!memory || typeof memory.exportCanonical !== 'function') {
    throw new TypeError('memory engine is required');
  }
  const normalizedProjectId = requiredText(projectId, 'projectId');
  const normalizedBranch = requiredText(branch, 'branch');
  const nodeLimit = boundedInteger(maxNodes, DEFAULT_MAX_NODES, { min: 1, max: DEFAULT_MAX_NODES });
  const threshold = boundedNumber(semanticThreshold, DEFAULT_SEMANTIC_THRESHOLD);
  const semanticNeighborLimit = boundedInteger(
    maxSemanticNeighbors,
    DEFAULT_MAX_SEMANTIC_NEIGHBORS,
    { min: 1, max: 20 },
  );

  const exported = memory.exportCanonical();
  const project = exported.projects?.find((item) => item.project_id === normalizedProjectId);
  if (!project) throw new Error('unknown project');

  const scopedClaims = (exported.claims ?? [])
    .filter((claim) => (
      claim.project_id === normalizedProjectId
      && claim.branch_scope === normalizedBranch
    ))
    .sort(compareClaims);
  if (scopedClaims.length === 0) {
    const branchExists = (
      (exported.claims ?? []).some((claim) => (
        claim.project_id === normalizedProjectId
        && claim.branch_scope === normalizedBranch
      ))
      || (exported.evidence ?? []).some((evidence) => (
        evidence.project_id === normalizedProjectId
        && evidence.branch === normalizedBranch
      ))
    );
    if (!branchExists) throw new Error('unknown project branch');
  }

  const selectedClaims = scopedClaims.slice(0, nodeLimit);
  const selectedIds = new Set(selectedClaims.map((claim) => claim.id));
  const evidenceById = new Map(
    (exported.evidence ?? []).map((item) => [item.id, item]),
  );
  const nodes = selectedClaims.map((claim) => claimNode(
    memory,
    claim,
    evidenceById.get(claim.created_from_evidence_id) ?? null,
  ));

  const edges = [];
  for (const event of exported.lifecycle_events ?? []) {
    if (
      event.project_id !== normalizedProjectId
      || !selectedIds.has(event.source_claim_id)
      || !selectedIds.has(event.target_claim_id)
    ) {
      continue;
    }
    const relation = lifecycleRelation(event.action);
    if (!relation) continue;
    edges.push({
      id: `explicit:lifecycle:${event.action}:${event.source_claim_id}:${event.target_claim_id}:${event.created_at ?? ''}`,
      from: event.source_claim_id,
      to: event.target_claim_id,
      relation,
      origin: 'explicit',
      directed: true,
      weight: 1,
      provenance: {
        evidenceId: event.evidence_id ?? null,
        createdAt: event.created_at ?? null,
      },
    });
  }

  const seenConflicts = new Set();
  for (const conflict of exported.conflicts ?? []) {
    if (
      conflict.project_id !== normalizedProjectId
      || !selectedIds.has(conflict.claim_a)
      || !selectedIds.has(conflict.claim_b)
    ) {
      continue;
    }
    const key = pairKey(conflict.claim_a, conflict.claim_b);
    if (seenConflicts.has(key)) continue;
    seenConflicts.add(key);
    const [from, to] = [conflict.claim_a, conflict.claim_b]
      .sort((left, right) => left.localeCompare(right, 'en'));
    edges.push({
      id: `explicit:conflict:${from}:${to}`,
      from,
      to,
      relation: 'conflicts_with',
      origin: 'explicit',
      directed: false,
      weight: 1,
      provenance: {
        state: conflict.state ?? null,
        createdAt: conflict.created_at ?? null,
        resolvedAt: conflict.resolved_at ?? null,
      },
    });
  }

  if (includeSemantic === true) {
    edges.push(...semanticEdges(
      memory,
      selectedClaims,
      threshold,
      semanticNeighborLimit,
    ));
  }

  edges.sort((left, right) => (
    (left.origin === right.origin ? 0 : left.origin === 'explicit' ? -1 : 1)
    || left.from.localeCompare(right.from, 'en')
    || left.to.localeCompare(right.to, 'en')
    || left.relation.localeCompare(right.relation, 'en')
    || left.id.localeCompare(right.id, 'en')
  ));

  const explicitEdges = edges.filter((edge) => edge.origin === 'explicit').length;
  const inferredEdges = edges.length - explicitEdges;
  return {
    schemaVersion: 1,
    projectId: normalizedProjectId,
    branch: normalizedBranch,
    nodes,
    edges,
    stats: {
      totalClaims: scopedClaims.length,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      explicitEdges,
      inferredEdges,
      truncated: scopedClaims.length > nodes.length,
      omittedClaims: Math.max(0, scopedClaims.length - nodes.length),
      semanticThreshold: threshold,
      maxSemanticNeighbors: semanticNeighborLimit,
    },
  };
}

function edgeEligible(edge, minWeight) {
  if (edge.origin === 'explicit') return true;
  return Number.isFinite(edge.weight) && edge.weight >= minWeight;
}

function otherClaimId(edge, claimId) {
  if (edge.from === claimId) return edge.to;
  if (edge.to === claimId) return edge.from;
  return null;
}

export function expandMemoryGraph(graph, {
  anchorIds = [],
  maxHops = DEFAULT_MAX_HOPS,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  minWeight = DEFAULT_SEMANTIC_THRESHOLD,
} = {}) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new TypeError('graph with nodes and edges is required');
  }
  if (!Array.isArray(anchorIds)) throw new TypeError('anchorIds must be an array');
  const hopLimit = boundedInteger(maxHops, DEFAULT_MAX_HOPS, { min: 1, max: 5 });
  const candidateLimit = boundedInteger(maxCandidates, DEFAULT_MAX_CANDIDATES, { min: 1, max: 100 });
  const weightFloor = boundedNumber(minWeight, DEFAULT_SEMANTIC_THRESHOLD);
  const knownIds = new Set(graph.nodes.map((node) => node.id));
  const anchors = [...new Set(anchorIds.filter((id) => knownIds.has(id)))];
  if (anchors.length === 0) {
    return { anchorIds: [], claimIds: [], traversedEdges: [] };
  }

  const claimIds = anchors.slice(0, candidateLimit);
  const seen = new Set(claimIds);
  const traversedEdges = [];
  const traversedEdgeIds = new Set();
  let frontier = [...claimIds];

  for (let hop = 0; hop < hopLimit && frontier.length > 0 && claimIds.length < candidateLimit; hop += 1) {
    const opportunities = [];
    for (const sourceId of frontier) {
      for (const edge of graph.edges) {
        if (!edgeEligible(edge, weightFloor)) continue;
        const targetId = otherClaimId(edge, sourceId);
        if (!targetId || !knownIds.has(targetId) || seen.has(targetId)) continue;
        opportunities.push({ sourceId, targetId, edge });
      }
    }
    opportunities.sort((left, right) => (
      (left.edge.origin === right.edge.origin ? 0 : left.edge.origin === 'explicit' ? -1 : 1)
      || (Number(right.edge.weight ?? 0) - Number(left.edge.weight ?? 0))
      || left.targetId.localeCompare(right.targetId, 'en')
      || String(left.edge.id).localeCompare(String(right.edge.id), 'en')
    ));

    const nextFrontier = [];
    for (const opportunity of opportunities) {
      if (claimIds.length >= candidateLimit) break;
      if (seen.has(opportunity.targetId)) continue;
      seen.add(opportunity.targetId);
      claimIds.push(opportunity.targetId);
      nextFrontier.push(opportunity.targetId);
      if (!traversedEdgeIds.has(opportunity.edge.id)) {
        traversedEdgeIds.add(opportunity.edge.id);
        traversedEdges.push(opportunity.edge);
      }
    }
    frontier = nextFrontier;
  }

  return {
    anchorIds: anchors,
    claimIds,
    traversedEdges,
  };
}
