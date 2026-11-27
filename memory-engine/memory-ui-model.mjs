import {
  memoryCandidateRef,
  memoryClaimRef,
} from './adapters/codex-hooks.mjs';
import { buildMemoryGraphV2 } from './memory-graph-v2.mjs';
import { projectClaimEntities } from './memory-graph-entities.mjs';
import { pipelineRunRef } from './pipeline-observability.mjs';

function text(value) {
  return typeof value === 'string' ? value : '';
}

function timeValue(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function evidenceAuthority(evidence) {
  return text(evidence?.authority_class) || 'unknown';
}

function evidenceMetadata(evidence) {
  if (
    evidence?.metadata
    && typeof evidence.metadata === 'object'
    && !Array.isArray(evidence.metadata)
  ) {
    return evidence.metadata;
  }
  if (typeof evidence?.metadata_json === 'string') {
    try {
      const parsed = JSON.parse(evidence.metadata_json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {}
  }
  return {};
}

function provenance(evidence) {
  const metadata = evidenceMetadata(evidence);
  if (evidenceAuthority(evidence) === 'user_direct') {
    return {
      type: 'user',
      label: 'User direct',
      sessionId: evidence?.session_id ?? null,
      turnId: metadata.turn_id ?? null,
      agentId: null,
      agentType: null,
      eventType: metadata.event_type ?? null,
    };
  }

  if (metadata.event_type === 'subagent_stop') {
    return {
      type: 'subagent',
      label: metadata.agent_type
        ? `Subagent · ${metadata.agent_type}`
        : 'Subagent',
      sessionId: evidence?.session_id ?? null,
      turnId: metadata.turn_id ?? null,
      agentId: metadata.agent_id ?? null,
      agentType: metadata.agent_type ?? null,
      eventType: metadata.event_type,
    };
  }

  if (metadata.event_type === 'assistant_stop') {
    return {
      type: 'root_agent',
      label: 'Root agent',
      sessionId: evidence?.session_id ?? null,
      turnId: metadata.turn_id ?? null,
      agentId: null,
      agentType: metadata.agent_type ?? 'root',
      eventType: metadata.event_type,
    };
  }

  return {
    type: evidence?.source_kind ?? 'unknown',
    label: evidence?.source_kind ?? 'Unknown',
    sessionId: evidence?.session_id ?? null,
    turnId: metadata.turn_id ?? null,
    agentId: metadata.agent_id ?? null,
    agentType: metadata.agent_type ?? null,
    eventType: metadata.event_type ?? null,
  };
}

function claimAuthority(claim, evidenceById) {
  return evidenceAuthority(evidenceById.get(claim.created_from_evidence_id));
}

function projectBranches(exported, projectId) {
  const branches = new Set();

  for (const claim of exported.claims) {
    if (claim.project_id === projectId && text(claim.branch_scope)) {
      branches.add(claim.branch_scope);
    }
  }
  for (const evidence of exported.evidence) {
    if (evidence.project_id === projectId && text(evidence.branch)) {
      branches.add(evidence.branch);
    }
  }

  return [...branches].sort((left, right) => {
    if (left === 'main') return -1;
    if (right === 'main') return 1;
    return left.localeCompare(right, 'en');
  });
}

export function memoryUiOverview(memory) {
  if (!memory || typeof memory.exportCanonical !== 'function') {
    throw new TypeError('memory must support canonical export');
  }

  const exported = memory.exportCanonical();
  const evidenceById = new Map(
    exported.evidence.map((item) => [item.id, item]),
  );

  const projects = exported.projects.map((project) => {
    const claims = exported.claims.filter(
      (claim) => claim.project_id === project.project_id,
    );
    const branches = projectBranches(exported, project.project_id);
    const branchSummaries = branches.map((branch) => {
      const scoped = claims.filter((claim) => claim.branch_scope === branch);
      return {
        branch,
        total: scoped.length,
        active: scoped.filter((claim) => claim.state === 'active').length,
        userDirect: scoped.filter(
          (claim) => claimAuthority(claim, evidenceById) === 'user_direct',
        ).length,
        agentInference: scoped.filter(
          (claim) => claimAuthority(claim, evidenceById) === 'agent_inference',
        ).length,
        latestAt: scoped
          .map((claim) => claim.created_at)
          .filter(Boolean)
          .sort((left, right) => timeValue(right) - timeValue(left))[0] ?? null,
      };
    });

    return {
      projectId: project.project_id,
      canonicalRemote: project.canonical_remote,
      repoIdentity: project.repo_identity,
      createdAt: project.created_at,
      total: claims.length,
      active: claims.filter((claim) => claim.state === 'active').length,
      branches: branchSummaries,
      defaultBranch: branches.includes('main')
        ? 'main'
        : branches[0] ?? null,
      latestAt: claims
        .map((claim) => claim.created_at)
        .filter(Boolean)
        .sort((left, right) => timeValue(right) - timeValue(left))[0] ?? null,
    };
  });

  projects.sort((left, right) => (
    timeValue(right.latestAt) - timeValue(left.latestAt)
    || left.projectId.localeCompare(right.projectId, 'en')
  ));

  return {
    format: exported.format,
    version: exported.version,
    projects,
  };
}

export function memoryUiGraph(memory, {
  projectId,
  branch,
  revisionSha = null,
  includeSimilarity = true,
  semanticThreshold = 0.82,
  maxSemanticNeighbors = 3,
  scope = 'branch',
  maxProjectClaims = 500,
} = {}) {
  if (!['branch', 'project'].includes(scope)) {
    throw new TypeError('scope must be branch or project');
  }
  if (!Number.isInteger(maxProjectClaims) || maxProjectClaims < 1 || maxProjectClaims > 500) {
    throw new RangeError('maxProjectClaims must be between 1 and 500');
  }
  let graph;
  if (scope === 'project') {
    const branches = [...new Set(memory.exportCanonical().claims
      .filter((claim) => claim.project_id === projectId)
      .map((claim) => claim.branch_scope)
      .filter(Boolean))].sort();
    const parts = branches.map((scopeBranch) => buildMemoryGraphV2(memory, {
      projectId,
      branch: scopeBranch,
      revisionSha: null,
      includeSimilarity,
      semanticThreshold,
      maxSemanticNeighbors,
    }));
    const partsStats = parts.map((part) => part.stats ?? {});
    const allNodes = parts.flatMap((part) => part.nodes);
    const allEdges = parts.flatMap((part) => part.edges);
    const allClaims = allNodes.filter((node) => (node.nodeType ?? 'claim') === 'claim');
    const partOmittedClaims = partsStats.reduce(
      (sum, item) => sum + Number(item.omittedClaims ?? 0), 0,
    );
    let nodes = allNodes;
    let edges = allEdges;
    let projectOmittedClaims = 0;
    if (allClaims.length > maxProjectClaims) {
      // Deterministic newest-first cap across branches. Older claims stay in
      // canonical storage and are not deleted; only this projection is bounded.
      const keep = new Set(allClaims
        .slice()
        .sort((left, right) => (
          String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''), 'en')
          || left.id.localeCompare(right.id, 'en')
        ))
        .slice(0, maxProjectClaims)
        .map((node) => node.id));
      nodes = allNodes.filter((node) => (node.nodeType ?? 'claim') !== 'claim' || keep.has(node.id));
      edges = allEdges.filter((edge) => keep.has(edge.from) && keep.has(edge.to));
      projectOmittedClaims = allClaims.length - keep.size;
    }
    const groups = new Map();
    for (const node of nodes) {
      const id = node.group ?? 'unknown';
      const current = groups.get(id) ?? {
        id, label: node.groupLabel ?? 'Unknown authority', count: 0,
      };
      current.count += 1;
      groups.set(id, current);
    }
    const claimNodes = nodes.filter((node) => (node.nodeType ?? 'claim') === 'claim');
    graph = {
      schemaVersion: parts[0]?.schemaVersion ?? 2,
      projectId,
      branch: null,
      scope: 'project',
      branches,
      includedBranches: [...new Set(claimNodes
        .map((node) => node.branch)
        .filter(Boolean))].sort(),
      nodes,
      edges,
      groups: [...groups.values()].sort((left, right) => (
        right.count - left.count || left.id.localeCompare(right.id, 'en')
      )),
      stats: {
        totalClaims: claimNodes.length,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        explicitEdges: edges.filter((edge) => edge.origin === 'explicit').length,
        inferredEdges: edges.filter((edge) => edge.relation === 'semantic_similarity').length,
        typedRelations: edges.filter((edge) => edge.source === 'typed_relation').length,
        typedRelationsOmittedByBound: partsStats.reduce(
          (sum, item) => sum + Number(item.typedRelationsOmittedByBound ?? 0), 0,
        ),
        truncated: partsStats.some((item) => item.truncated === true)
          || projectOmittedClaims > 0,
        omittedClaims: partOmittedClaims + projectOmittedClaims,
        projectClaimsOmittedByBound: projectOmittedClaims,
        semanticThreshold,
        maxSemanticNeighbors,
        similarityEnabled: includeSimilarity,
        repositoryNodesUnchecked: nodes.filter((node) => node.freshness?.status === 'unchecked').length,
        repositoryNodesStale: nodes.filter((node) => node.freshness?.status === 'stale').length,
      },
      gitContext: { status: 'project_scope', revisionSha: null },
    };
  } else {
    graph = buildMemoryGraphV2(memory, {
      projectId,
      branch,
      revisionSha,
      includeSimilarity,
      semanticThreshold,
      maxSemanticNeighbors,
    });
  }
  graph = projectClaimEntities(graph, {
    projectId,
    branch: scope === 'project' ? null : branch,
  });
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      ref: node.nodeType === 'entity' ? node.ref : memoryClaimRef(node.id),
      authority: node.authority,
    })),
  };
}

function memoryListItem(memory, claim, evidence, staleIds) {
  const inspected = memory.inspectClaimObservability({
    projectId: claim.project_id,
    branch: claim.branch_scope,
    claimId: claim.id,
  });
  const candidate = inspected?.candidate ?? null;
  const relation = inspected?.relation ?? null;
  const usage = inspected?.recall_usage ?? {
    retrieval_count: 0,
    retained_count: 0,
    context_count: 0,
    last_retained_at: null,
    last_context_at: null,
  };

  return {
    claimId: claim.id,
    ref: memoryClaimRef(claim.id),
    value: claim.value_text,
    kind: claim.kind,
    subject: claim.subject,
    predicate: claim.predicate,
    state: claim.state,
    branch: claim.branch_scope,
    createdAt: claim.created_at,
    validFrom: claim.valid_from,
    validUntil: claim.valid_until,
    authority: evidenceAuthority(evidence),
    provenance: provenance(evidence),
    semanticIndexed: inspected?.semantic_indexed === true,
    embeddingModels: (inspected?.embeddings ?? []).map((item) => ({
      modelId: item.model_id,
      modelRevision: item.model_revision,
      dimensions: item.dimensions,
      indexedAt: item.indexed_at,
    })),
    candidate: candidate
      ? {
          id: candidate.id,
          ref: memoryCandidateRef(candidate.id),
          status: candidate.status,
          sourceAuthority: candidate.source_authority,
          importance: (() => {
            try {
              return candidate.evaluation_json
                ? JSON.parse(candidate.evaluation_json)
                : null;
            } catch {
              return null;
            }
          })(),
        }
      : null,
    relation: relation
      ? {
          relation: relation.relation,
          targetRef: relation.related_claim_id
            ? memoryClaimRef(relation.related_claim_id)
            : null,
          evaluatedAt: relation.evaluated_at,
        }
      : null,
    stale: staleIds.has(claim.id),
    usage,
  };
}

export function memoryUiScope(memory, {
  projectId,
  branch,
} = {}) {
  if (!text(projectId) || !text(branch)) {
    throw new TypeError('projectId and branch are required');
  }

  const exported = memory.exportCanonical();
  const project = exported.projects.find(
    (item) => item.project_id === projectId,
  );
  if (!project) {
    throw new Error('unknown project');
  }

  const branches = projectBranches(exported, projectId);
  if (!branches.includes(branch)) {
    throw new Error('unknown project branch');
  }

  const evidenceById = new Map(
    exported.evidence.map((item) => [item.id, item]),
  );
  const stale = typeof memory.listStaleAgentMemories === 'function'
    ? memory.listStaleAgentMemories({
        projectId,
        branch,
        limit: 200,
      })
    : [];
  const staleIds = new Set(stale.map((item) => item.claim_id));

  const memories = exported.claims
    .filter((claim) => (
      claim.project_id === projectId
      && claim.branch_scope === branch
    ))
    .map((claim) => memoryListItem(
      memory,
      claim,
      evidenceById.get(claim.created_from_evidence_id) ?? null,
      staleIds,
    ))
    .sort((left, right) => (
      (left.state === 'active' ? -1 : 0) - (right.state === 'active' ? -1 : 0)
      || timeValue(right.createdAt) - timeValue(left.createdAt)
      || left.ref.localeCompare(right.ref, 'en')
    ));

  const candidates = typeof memory.listScopedCandidates === 'function'
    ? memory.listScopedCandidates({ projectId, branch }).map((candidate) => {
        let importance = null;
        try {
          importance = candidate.evaluation_json
            ? JSON.parse(candidate.evaluation_json)
            : null;
        } catch {}

        const keptForReview = (
          candidate.status === 'pending'
          && candidate.relation === null
          && importance?.decision === 'keep_candidate'
        );
        return {
          id: candidate.id,
          ref: memoryCandidateRef(candidate.id),
          value: candidate.proposed_value,
          authority: candidate.source_authority,
          status: candidate.status,
          relation: candidate.relation,
          relatedRef: candidate.related_claim_id
            ? memoryClaimRef(candidate.related_claim_id)
            : null,
          createdAt: candidate.created_at,
          evaluatedAt: candidate.evaluated_at,
          importance,
          reviewable: (
            candidate.status === 'needs_confirmation'
            || keptForReview
          ),
        };
      })
    : [];

  const pipelineRuns = typeof memory.listPipelineRuns === 'function'
    ? memory.listPipelineRuns({
        projectId,
        branch,
        limit: 50,
      }).map((run) => ({
        ...run,
        ref: pipelineRunRef(run.id),
      }))
    : [];
  const pipelineFailures = typeof memory.listPipelineFailures === 'function'
    ? memory.listPipelineFailures({
        projectId,
        branch,
        limit: 50,
      }).map((failure) => ({
        ...failure,
        runRef: pipelineRunRef(failure.run_id),
      }))
    : [];

  return {
    project: {
      projectId: project.project_id,
      canonicalRemote: project.canonical_remote,
      repoIdentity: project.repo_identity,
      createdAt: project.created_at,
    },
    branch,
    branches,
    memories,
    candidates,
    stale: stale.map((item) => ({
      ...item,
      ref: memoryClaimRef(item.claim_id),
    })),
    health: typeof memory.healthSnapshot === 'function'
      ? memory.healthSnapshot({ projectId, branch })
      : null,
    quality: typeof memory.memoryQualitySnapshot === 'function'
      ? memory.memoryQualitySnapshot({ projectId, branch })
      : null,
    pipeline: {
      runs: pipelineRuns,
      failures: pipelineFailures,
    },
    conflicts: exported.conflicts
      .filter((item) => item.project_id === projectId)
      .filter((item) => {
        const claimA = exported.claims.find((claim) => claim.id === item.claim_a);
        const claimB = exported.claims.find((claim) => claim.id === item.claim_b);
        return claimA?.branch_scope === branch || claimB?.branch_scope === branch;
      })
      .map((item) => ({
        state: item.state,
        claimARef: memoryClaimRef(item.claim_a),
        claimBRef: memoryClaimRef(item.claim_b),
        createdAt: item.created_at,
        resolvedAt: item.resolved_at,
      })),
  };
}

export function memoryUiClaim(memory, {
  projectId,
  branch,
  claimId,
} = {}) {
  if (!text(projectId) || !text(branch) || !text(claimId)) {
    throw new TypeError('projectId, branch, and claimId are required');
  }

  const inspected = memory.inspectClaimObservability({
    projectId,
    branch,
    claimId,
  });
  if (!inspected) return null;

  const claim = inspected.claim;
  const evidence = inspected.evidence ?? null;
  const candidate = inspected.candidate ?? null;

  return {
    claim: {
      ...claim,
      ref: memoryClaimRef(claim.id),
      authority: evidenceAuthority(evidence),
      provenance: provenance(evidence),
    },
    evidence,
    candidate: candidate
      ? {
          ...candidate,
          ref: memoryCandidateRef(candidate.id),
          importance: (() => {
            try {
              return candidate.evaluation_json
                ? JSON.parse(candidate.evaluation_json)
                : null;
            } catch {
              return null;
            }
          })(),
        }
      : null,
    relation: inspected.relation
      ? {
          ...inspected.relation,
          targetRef: inspected.relation.related_claim_id
            ? memoryClaimRef(inspected.relation.related_claim_id)
            : null,
        }
      : null,
    promotion: inspected.promotion,
    confirmation: inspected.confirmation,
    lifecycle: (inspected.lifecycle ?? []).map((item) => ({
      ...item,
      sourceRef: item.source_claim_id
        ? memoryClaimRef(item.source_claim_id)
        : null,
      targetRef: item.target_claim_id
        ? memoryClaimRef(item.target_claim_id)
        : null,
    })),
    conflicts: (inspected.conflicts ?? []).map((item) => ({
      ...item,
      claimARef: memoryClaimRef(item.claim_a),
      claimBRef: memoryClaimRef(item.claim_b),
    })),
    semanticIndexed: inspected.semantic_indexed === true,
    embeddings: inspected.embeddings ?? [],
    recallUsage: inspected.recall_usage ?? null,
  };
}
