/**
 * D4: read-only Graph Quality v2 projection.
 *
 * The legacy graph and graph-recall shadow remain unchanged. Typed relations are
 * advisory, never canonical facts. Repository-backed endpoints require an
 * independently supplied, trusted full revision SHA and the canonical
 * MemoryEngine materialization gate. Without that context they fail closed.
 */
import { buildMemoryGraph } from './memory-graph.mjs';

const AUTHORITIES = new Map([
  ['user_direct', 'User direct'],
  ['repo_trusted', 'Repository trusted'],
  ['tool_observation', 'Tool observation'],
  ['agent_inference', 'Agent inference'],
  ['external_untrusted', 'External untrusted'],
  ['unclassified', 'Unclassified'],
]);
const TYPED_RELATIONS = new Set(['supports', 'depends_on', 'implements', 'related_to']);
const MAX_NODES = 500;
const MAX_TYPED_CANDIDATES = 5000;
const MAX_TYPED_EDGES = 1500;

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}

function validTime(value, label) {
  if (typeof value !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be a valid timestamp`);
  }
  return Date.parse(value);
}

function isRepositoryEvidence(provenance) {
  if (!provenance) return false;
  if (provenance.path != null || provenance.blobOid != null
      || provenance.authorityClass === 'repo_trusted') return true;
  return /^(?:repo|repository|git)(?:$|[_/-])/.test(String(provenance.sourceKind ?? '').toLowerCase());
}

function isTemporallyCurrent(node, asOfMs) {
  const from = node.validFrom == null ? null : Date.parse(node.validFrom);
  const until = node.validUntil == null ? null : Date.parse(node.validUntil);
  if ((from !== null && !Number.isFinite(from)) || (until !== null && !Number.isFinite(until))) {
    return false;
  }
  if (from !== null && until !== null && from >= until) return false;
  return node.state === 'active' && (from === null || from <= asOfMs)
    && (until === null || asOfMs < until);
}

function projectionAuthority(node) {
  const authority = node.provenance?.authorityClass;
  return AUTHORITIES.has(authority) ? authority : 'unknown';
}

function freshnessEligible(memory, projectId, branch, revisionSha, claimIds) {
  if (!revisionSha || claimIds.length === 0 || typeof memory.materializeRecall !== 'function') {
    return new Set();
  }
  try {
    const result = memory.materializeRecall({
      projectId,
      branch,
      revisionSha,
      mode: 'current',
      claimIds,
    });
    if (!result || !Array.isArray(result.items)) return new Set();
    const requested = new Set(claimIds);
    return new Set(result.items
      .map((item) => item?.claim?.id)
      .filter((id) => requested.has(id)));
  } catch {
    // A stale or inaccessible freshness ledger is not permission to infer.
    return new Set();
  }
}

function namedGroups(nodes) {
  const counts = new Map();
  for (const node of nodes) {
    counts.set(node.group, (counts.get(node.group) ?? 0) + 1);
  }
  return [...counts].map(([id, count]) => ({
    id,
    label: AUTHORITIES.get(id) ?? 'Unknown authority',
    count,
  })).sort((left, right) => right.count - left.count || left.id.localeCompare(right.id, 'en'));
}

function edgeOrder(a, b) {
  const rank = (edge) => edge.origin === 'explicit' ? 0 : edge.source === 'typed_relation' ? 1 : 2;
  return rank(a) - rank(b)
    || a.from.localeCompare(b.from, 'en')
    || a.to.localeCompare(b.to, 'en')
    || a.relation.localeCompare(b.relation, 'en')
    || a.id.localeCompare(b.id, 'en');
}

/**
 * @param {object} options
 * @param {string|null} options.revisionSha Trusted server-side revision of the
 * selected repository checkout, never copied from an arbitrary HTTP query.
 */
export function buildMemoryGraphV2(memory, options = {}) {
  const {
    projectId, branch, maxNodes = MAX_NODES,
    includeSimilarity = false, semanticThreshold = 0.82, maxSemanticNeighbors = 3,
  } = options;
  // Keep the legacy graph API untouched for graph-recall shadow users.
  const base = buildMemoryGraph(memory, {
    projectId, branch, maxNodes, includeSemantic: includeSimilarity,
    semanticThreshold, maxSemanticNeighbors,
  });
  return projectMemoryGraphV2(memory, base, options);
}

/** Project a previously constructed, trusted legacy graph without mutations. */
export function projectMemoryGraphV2(memory, graph, {
  projectId,
  branch,
  maxNodes = MAX_NODES,
  at = new Date().toISOString(),
  revisionSha = null,
  includeSimilarity = false,
  semanticThreshold = 0.82,
  maxSemanticNeighbors = 3,
} = {}) {
  if (!memory || typeof memory.exportCanonical !== 'function') {
    throw new TypeError('read-only MemoryEngine is required');
  }
  const project = requiredText(projectId, 'projectId');
  const scopedBranch = requiredText(branch, 'branch');
  if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > MAX_NODES) {
    throw new RangeError('maxNodes must be between 1 and 500');
  }
  if (typeof includeSimilarity !== 'boolean') throw new TypeError('includeSimilarity must be boolean');
  if (revisionSha !== null && (typeof revisionSha !== 'string' || !/^[0-9a-f]{40}$/i.test(revisionSha))) {
    throw new TypeError('revisionSha must be a full trusted Git commit SHA');
  }
  const asOfMs = validTime(at, 'at');
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)
      || graph.projectId !== project || graph.branch !== scopedBranch) {
    throw new TypeError('trusted legacy graph must match requested project and branch');
  }
  if (graph.nodes.length > maxNodes) throw new RangeError('trusted graph exceeds maxNodes');
  const repositories = graph.nodes.filter((node) => isRepositoryEvidence(node.provenance));
  const verified = freshnessEligible(
    memory, project, scopedBranch, revisionSha,
    repositories.filter((node) => isTemporallyCurrent(node, asOfMs)).map((node) => node.id),
  );
  const nodes = graph.nodes.map((node) => {
    const repository = isRepositoryEvidence(node.provenance);
    const current = isTemporallyCurrent(node, asOfMs);
    const freshness = repository
      ? (revisionSha === null ? 'unchecked' : verified.has(node.id) && current ? 'fresh' : 'stale')
      : 'not_repository';
    const authority = projectionAuthority(node);
    return {
      ...node,
      authority,
      group: authority,
      groupLabel: AUTHORITIES.get(authority) ?? 'Unknown authority',
      lifecycleStatus: current ? 'current' : 'historical',
      freshness: {
        status: freshness,
        revisionSha: repository ? revisionSha : null,
        explanation: !repository ? 'No repository freshness requirement'
          : freshness === 'unchecked' ? 'No independently verified Git revision supplied'
            : freshness === 'fresh' ? 'Eligible at the trusted Git revision'
              : 'Not eligible at the trusted Git revision',
      },
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const endpointEligible = (node) => node
    && node.lifecycleStatus === 'current'
    && node.freshness.status !== 'stale'
    && node.freshness.status !== 'unchecked';
  const edges = graph.edges
    .filter((edge) => {
      if (!byId.has(edge.from) || !byId.has(edge.to)) return false;
      if (edge.relation === 'semantic_similarity') {
        return includeSimilarity && endpointEligible(byId.get(edge.from)) && endpointEligible(byId.get(edge.to));
      }
      // Explicit history is retained, but cannot be confused with current facts.
      return edge.origin === 'explicit';
    })
    .map((edge) => ({
      ...edge,
      source: edge.origin === 'explicit' ? 'canonical' : 'embedding_similarity',
      advisory: edge.origin !== 'explicit',
      current: edge.origin === 'explicit'
        ? endpointEligible(byId.get(edge.from)) && endpointEligible(byId.get(edge.to))
        : false,
    }));

  const counters = { considered: 0, shown: 0, suppressedFreshness: 0, suppressedOther: 0, truncated: 0 };
  if (typeof memory.listTypedRelations === 'function') {
    // Read-only projection; the source ledger's own SQL enforces scope,
    // active temporal validity, Evidence authority and primary provenance.
    const typed = memory.listTypedRelations({ projectId: project, branch: scopedBranch, activeOnly: true, at });
    if (!Array.isArray(typed)) throw new TypeError('typed relations must be an array');
    const bounded = typed.slice(0, MAX_TYPED_CANDIDATES);
    counters.truncated = typed.length - bounded.length;
    for (let index = 0; index < bounded.length; index++) {
      if (counters.shown >= MAX_TYPED_EDGES) {
        counters.truncated += bounded.length - index;
        break;
      }
      const row = bounded[index];
      counters.considered++;
      const source = byId.get(row?.source_claim_id);
      const target = byId.get(row?.target_claim_id);
      if (!source || !target || !TYPED_RELATIONS.has(row.relation)
          || row.origin !== 'inferred' || row.confidence !== 'high'
          || source.provenance?.evidenceId !== row.source_evidence_id
          || target.provenance?.evidenceId !== row.target_evidence_id
          || (row.created_at && Date.parse(row.created_at) > asOfMs)
          || (row.validated_at && Date.parse(row.validated_at) > asOfMs)) {
        counters.suppressedOther++;
        continue;
      }
      if (!endpointEligible(source) || !endpointEligible(target)) {
        counters.suppressedFreshness++;
        continue;
      }
      edges.push({
        id: `advisory:typed:${row.id}`,
        from: source.id,
        to: target.id,
        relation: row.relation,
        origin: 'inferred',
        source: 'typed_relation',
        directed: row.relation !== 'related_to',
        advisory: true,
        current: true,
        weight: null,
        provenance: {
          sourceEvidenceId: row.source_evidence_id,
          targetEvidenceId: row.target_evidence_id,
          evaluatorId: row.evaluator_id,
          policyVersion: row.policy_version,
          validatedAt: row.validated_at,
          reason: row.reason,
        },
      });
      counters.shown++;
    }
  }
  edges.sort(edgeOrder);
  return {
    ...graph,
    schemaVersion: 2,
    projection: 'graph-quality-v2',
    asOf: at,
    readOnly: true,
    nodes,
    groups: namedGroups(nodes),
    edges,
    stats: {
      ...graph.stats,
      edgeCount: edges.length,
      explicitEdges: edges.filter((edge) => edge.origin === 'explicit').length,
      inferredEdges: edges.filter((edge) => edge.origin !== 'explicit').length,
      typedRelations: counters.shown,
      typedRelationsConsidered: counters.considered,
      typedSuppressedFreshness: counters.suppressedFreshness,
      typedSuppressedOther: counters.suppressedOther,
      typedRelationsOmittedByBound: counters.truncated,
      similarityEnabled: includeSimilarity,
      repositoryNodesUnchecked: nodes.filter((node) => node.freshness.status === 'unchecked').length,
      repositoryNodesStale: nodes.filter((node) => node.freshness.status === 'stale').length,
    },
  };
}
