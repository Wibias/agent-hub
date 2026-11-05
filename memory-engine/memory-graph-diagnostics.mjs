/**
 * D6: offline, read-only Graph Quality v2 production diagnostics.
 * Never copy claim text, Evidence contents, paths, or raw errors into reports.
 */

const STATUS = ['fresh', 'stale', 'unchecked', 'not_repository'];
const MAX_SAMPLES = 20;

/** Parse bounded diagnostic options independently of the production runtime. */
export function parseGraphDiagnosticsArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('invalid arguments');
  const options = { dbPath: null, projectId: null, branch: null, roots: [], samples: 5, listScopes: false, help: false, maxP95Ms: null };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (name === '--help' || name === '--list-scopes') {
      if (seen.has(name)) throw new TypeError('duplicate option');
      seen.add(name);
      options[name === '--help' ? 'help' : 'listScopes'] = true;
      continue;
    }
    if (!['--db-path', '--project-id', '--branch', '--repo-root', '--samples', '--max-p95-ms'].includes(name)) {
      throw new TypeError('unknown option');
    }
    if (name !== '--repo-root' && seen.has(name)) throw new TypeError('duplicate option');
    seen.add(name);
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--') || value.includes('\0')) {
      throw new TypeError('missing or invalid option value');
    }
    if (name === '--db-path') options.dbPath = value;
    if (name === '--project-id') options.projectId = value.trim();
    if (name === '--branch') options.branch = value.trim();
    if (name === '--repo-root') options.roots.push(value);
    if (name === '--samples') options.samples = Number(value);
    if (name === '--max-p95-ms') options.maxP95Ms = Number(value);
  }
  if (!Number.isInteger(options.samples) || options.samples < 1 || options.samples > MAX_SAMPLES) {
    throw new RangeError('samples must be 1 to 20');
  }
  if (options.maxP95Ms !== null && (!Number.isFinite(options.maxP95Ms) || options.maxP95Ms <= 0 || options.maxP95Ms > 600_000)) {
    throw new RangeError('max-p95-ms must be between 0 and 600000');
  }
  if (options.roots.length > 16 || new Set(options.roots).size !== options.roots.length) {
    throw new RangeError('invalid or duplicate repository roots');
  }
  if (!options.help && !options.listScopes && (!options.projectId || !options.branch)) {
    throw new TypeError('project-id and branch are required');
  }
  if (options.listScopes && (options.projectId || options.branch || options.roots.length)) {
    throw new TypeError('list-scopes does not accept a scope or Git roots');
  }
  return options;
}

/** List scope identifiers and counts only; no stored memory content. */
export function listGraphDiagnosticScopes(canonical) {
  if (!canonical || !Array.isArray(canonical.projects) || !Array.isArray(canonical.claims)
      || !Array.isArray(canonical.evidence)) throw new TypeError('invalid canonical export');
  return canonical.projects.map((project) => {
    const id = project.project_id;
    const branches = new Map();
    for (const claim of canonical.claims) {
      if (claim.project_id !== id || typeof claim.branch_scope !== 'string') continue;
      const current = branches.get(claim.branch_scope) ?? { branch: claim.branch_scope, claims: 0 };
      current.claims++;
      branches.set(claim.branch_scope, current);
    }
    for (const evidence of canonical.evidence) {
      if (evidence.project_id === id && typeof evidence.branch === 'string' && !branches.has(evidence.branch)) {
        branches.set(evidence.branch, { branch: evidence.branch, claims: 0 });
      }
    }
    return { projectId: id, branches: [...branches.values()].sort((a, b) => a.branch.localeCompare(b.branch, 'en')) };
  }).sort((a, b) => a.projectId.localeCompare(b.projectId, 'en'));
}

/** Deterministic, conservative reason labels; never infer that a blob changed without proof. */
function classifyFreshness(node, scope) {
  const state = node?.freshness?.status;
  if (state === 'not_repository') return 'not_repository';
  if (state === 'fresh') return 'verified_blob_match';
  if (state === 'unchecked') {
    const value = scope?.status;
    return ['unconfigured', 'unbound', 'branch_mismatch', 'ambiguous'].includes(value)
      ? `git_${value}` : 'git_not_verified';
  }
  if (state === 'stale') {
    if (node?.lifecycleStatus !== 'current') return 'historical_or_inactive';
    if (typeof node?.provenance?.path !== 'string' || !node.provenance.path) return 'missing_evidence_path';
    if (typeof node?.provenance?.blobOid !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(node.provenance.blobOid)) {
      return 'missing_or_invalid_evidence_oid';
    }
    return 'blob_not_verified'; // changed, deleted, symlink, or Git read failure
  }
  return 'unknown';
}

/** Aggregate browser-safe graph counters without returning any individual node. */
export function summarizeGraphDiagnostics(graph, scope) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.readOnly !== true) {
    throw new TypeError('invalid read-only graph');
  }
  const freshness = Object.fromEntries(STATUS.map((value) => [value, 0]));
  const reasons = {};
  for (const node of graph.nodes) {
    const status = node?.freshness?.status;
    if (!Object.hasOwn(freshness, status)) throw new TypeError('unexpected graph freshness status');
    freshness[status]++;
    const reason = classifyFreshness(node, scope);
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  const repoNodes = freshness.fresh + freshness.stale + freshness.unchecked;
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    repositoryNodes: repoNodes,
    freshness,
    reasons: Object.fromEntries(Object.entries(reasons).sort(([a], [b]) => a.localeCompare(b, 'en'))),
    limits: {
      nodesOmitted: Number.isSafeInteger(graph.stats?.omittedClaims) ? graph.stats.omittedClaims : null,
      typedRelationsOmitted: Number.isSafeInteger(graph.stats?.typedRelationsOmittedByBound)
        ? graph.stats.typedRelationsOmittedByBound : null,
    },
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/** Produce p50 and nearest-rank p95 from bounded finite duration samples. */
export function latencySummary(samples) {
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > MAX_SAMPLES
      || samples.some((v) => !Number.isFinite(v) || v < 0)) throw new TypeError('invalid timings');
  const sorted = [...samples].sort((a, b) => a - b);
  const nearest = (p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return { samples: sorted.length, minMs: round(sorted[0]), p50Ms: round(nearest(0.5)),
    p95Ms: round(nearest(0.95)), maxMs: round(sorted.at(-1)) };
}

/**
 * Run a bounded live read-only smoke/benchmark. queryGraph must resolve fresh
 * server-side Git context each time; no mutation callback is accepted.
 */
export async function runGraphDiagnostics({
  projectId, branch, rootsConfigured = 0, samples = 5, maxP95Ms = null,
  queryGraph, now = () => performance.now(), generatedAt = () => new Date().toISOString(),
} = {}) {
  if (typeof projectId !== 'string' || !projectId.trim() || typeof branch !== 'string' || !branch.trim()) {
    throw new TypeError('projectId and branch are required');
  }
  if (!Number.isInteger(samples) || samples < 1 || samples > MAX_SAMPLES) throw new RangeError('samples must be 1 to 20');
  if (!Number.isInteger(rootsConfigured) || rootsConfigured < 0 || rootsConfigured > 16) throw new RangeError('invalid roots count');
  if (maxP95Ms !== null && (!Number.isFinite(maxP95Ms) || maxP95Ms <= 0)) throw new RangeError('invalid latency threshold');
  if (typeof queryGraph !== 'function' || typeof now !== 'function') throw new TypeError('queryGraph and now are required');
  const durations = [];
  const contexts = [];
  let graphSummary = null;
  let staleSeen = false;
  let failed = false;
  for (let i = 0; i < samples; i++) {
    const start = now();
    try {
      const result = await queryGraph();
      if (result?.graph?.projectId !== projectId || result?.graph?.branch !== branch) {
        throw new Error('invalid graph scope');
      }
      const scope = result?.scope;
      if (!scope || typeof scope.status !== 'string') throw new TypeError('invalid Git context');
      const summary = summarizeGraphDiagnostics(result.graph, scope);
      // Include a revision fingerprint for instability detection, never a path.
      contexts.push({ status: scope.status,
        revision: scope.status === 'verified' && /^[a-f0-9]{40}$/i.test(scope.revisionSha ?? '')
          ? scope.revisionSha.toLowerCase() : null });
      graphSummary = summary;
      staleSeen ||= summary.freshness.stale > 0;
    } catch {
      failed = true;
      break; // Do not leak raw SQL/Git errors, which may contain private paths.
    }
    const duration = now() - start;
    if (!Number.isFinite(duration) || duration < 0) { failed = true; break; }
    durations.push(duration);
  }
  const stable = contexts.every((item) => item.status === contexts[0]?.status
    && item.revision === contexts[0]?.revision);
  const git = failed ? { status: 'unknown', revision: null }
    : (contexts.at(-1) ?? { status: 'unknown', revision: null });
  const timing = !failed && durations.length ? latencySummary(durations) : null;
  // Compare the raw nearest-rank p95; rounding is presentation-only.
  const rawP95Ms = timing
    ? [...durations].sort((a, b) => a - b)[Math.ceil(0.95 * durations.length) - 1]
    : null;
  const notes = [];
  if (failed) notes.push('read_only_graph_query_failed');
  if (!failed && !stable) notes.push('git_context_changed_during_sampling');
  if (!failed && graphSummary?.nodes === 0) notes.push('empty_graph_scope');
  if (!failed && graphSummary?.repositoryNodes && git.status !== 'verified') notes.push('repository_freshness_unverified');
  if (!failed && staleSeen) notes.push('repository_nodes_not_fresh');
  if (!failed && graphSummary?.limits.nodesOmitted > 0) notes.push('graph_node_limit_reached');
  if (!failed && graphSummary?.limits.typedRelationsOmitted > 0) notes.push('graph_relation_limit_reached');
  if (maxP95Ms !== null && rawP95Ms !== null && rawP95Ms > maxP95Ms) notes.push('latency_threshold_exceeded');
  const outcome = failed ? 'fail'
    : !stable || notes.includes('repository_freshness_unverified') ? 'blocked'
      : notes.length ? 'attention' : 'pass';
  return {
    schemaVersion: 1,
    generatedAt: generatedAt(),
    mode: 'read_only',
    outcome,
    scope: { projectId, branch },
    git: { status: git.status, revisionPrefix: git.revision ? git.revision.slice(0, 12) : null,
      rootsConfigured, stable },
    graph: failed ? null : graphSummary,
    performance: timing,
    maxP95Ms,
    notes,
  };
}
