/**
 * D7: bounded, public-safe evaluation of the existing D6 read-only diagnostics.
 * No MemoryEngine, Git, or filesystem operations are performed here.
 */
const PROFILE_SIZES = Object.freeze([100, 250, 500, 501]);
const VALID_FRESHNESS = new Set(['fresh', 'stale', 'unchecked']);

/** Explain whether a live D6 report actually exercised repository freshness. */
export function assessD7LiveCoverage(report) {
  if (!report || typeof report !== 'object' || !report.git
      || typeof report.git.status !== 'string' || typeof report.git.stable !== 'boolean') {
    throw new TypeError('D6 diagnostic report required');
  }
  // D6 returns a null graph when the read-only query fails. Preserve its
  // sanitized failure outcome instead of throwing a second exception.
  if (report.outcome === 'fail' && report.graph === null) {
    return {
      status: 'fail', notes: ['underlying_read_only_query_failed'],
      sampleCount: null, repositoryNodes: null, freshRepositoryNodes: null,
      gitStatus: report.git.status, gitStable: report.git.stable, p95Ms: null,
    };
  }
  if (!report.graph || typeof report.graph !== 'object') {
    throw new TypeError('D6 diagnostic report required');
  }
  const notes = [];
  if (report.outcome === 'fail') notes.push('underlying_read_only_query_failed');
  if (report.git.status !== 'verified' || report.git.stable !== true) {
    notes.push('trusted_git_context_required');
  }
  if (!Number.isInteger(report.graph.repositoryNodes) || report.graph.repositoryNodes < 1) {
    notes.push('no_repository_claims_in_scope');
  } else if (!Number.isInteger(report.graph.freshness?.fresh) || report.graph.freshness.fresh < 1) {
    notes.push('no_verified_fresh_repository_claim');
  }
  if (report.graph.freshness?.stale > 0) notes.push('repository_nodes_stale');
  if (report.graph.freshness?.unchecked > 0) notes.push('repository_nodes_unchecked');
  if (report.graph.limits?.nodesOmitted > 0) notes.push('graph_truncated');
  if (report.graph.limits?.typedRelationsOmitted > 0) notes.push('typed_relations_truncated');
  if (report.outcome === 'attention') notes.push('d6_attention');
  if (report.outcome === 'blocked') notes.push('d6_blocked');
  return {
    status: report.outcome === 'fail' ? 'fail' : notes.length ? 'blocked' : 'pass',
    notes,
    sampleCount: report.performance?.samples ?? null,
    repositoryNodes: report.graph.repositoryNodes,
    freshRepositoryNodes: report.graph.freshness?.fresh ?? null,
    gitStatus: report.git.status,
    gitStable: report.git.stable,
    p95Ms: report.performance?.p95Ms ?? null,
  };
}

/** Validate a measured synthetic profile against the graph's 500-node bound. */
export function assessD7ScaleProfile(report, requestedClaims) {
  if (!PROFILE_SIZES.includes(requestedClaims)) throw new RangeError('unsupported D7 fixture size');
  if (!report || typeof report !== 'object') throw new TypeError('D6 report required');
  const expectedNodes = Math.min(500, requestedClaims);
  const expectedOmitted = requestedClaims - expectedNodes;
  const graph = report.graph;
  const success = report.outcome === (expectedOmitted > 0 ? 'attention' : 'pass')
    && graph?.nodes === expectedNodes
    && graph?.limits?.nodesOmitted === expectedOmitted
    && graph?.repositoryNodes === 1
    && graph?.freshness?.fresh === 1
    && graph?.freshness?.unchecked === 0
    && graph?.freshness?.stale === 0
    && report.git?.status === 'verified'
    && report.git?.stable === true
    && Number.isFinite(report.performance?.p95Ms)
    && report.performance.p95Ms >= 0;
  return {
    claims: requestedClaims,
    status: success ? 'pass' : 'fail',
    graphNodes: graph?.nodes ?? null,
    omittedClaims: graph?.limits?.nodesOmitted ?? null,
    sampleCount: report.performance?.samples ?? null,
    p50Ms: report.performance?.p50Ms ?? null,
    p95Ms: report.performance?.p95Ms ?? null,
    maxMs: report.performance?.maxMs ?? null,
  };
}

/** Validate fail-closed transitions for the *same* canonical repository Evidence. */
export function assessD7FreshnessTransitions(phases) {
  const names = ['initial', 'changedCommit', 'wrongBranch', 'noRoot'];
  if (!phases || names.some((name) => !phases[name])) throw new TypeError('four phase observations required');
  const status = (name) => phases[name].graph?.nodes?.find((node) => node.provenance?.authorityClass === 'repo_trusted')?.freshness?.status;
  const getTyped = (name) => phases[name].graph?.edges?.filter((e) => e.source === 'typed_relation').length;
  const result = {
    initial: status('initial') ?? null,
    changedCommit: status('changedCommit') ?? null,
    wrongBranch: status('wrongBranch') ?? null,
    noRoot: status('noRoot') ?? null,
    typedEdgesBefore: getTyped('initial') ?? null,
    typedEdgesAfter: getTyped('changedCommit') ?? null,
    gitAfterBranchSwitch: phases.wrongBranch.scope?.status ?? null,
    gitWithoutRoot: phases.noRoot.scope?.status ?? null,
  };
  const pass = result.initial === 'fresh'
    && result.changedCommit === 'stale'
    && result.wrongBranch === 'unchecked'
    && result.noRoot === 'unchecked'
    && result.typedEdgesBefore === 1
    && result.typedEdgesAfter === 0
    && result.gitAfterBranchSwitch === 'branch_mismatch'
    && result.gitWithoutRoot === 'unconfigured';
  return { status: pass ? 'pass' : 'fail', ...result };
}
