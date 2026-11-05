/**
 * D11 read-only operational monitor. Consume D8 and D7 sanitized reports only.
 * No MemoryEngine, Git, file system, or lifecycle mutators are exposed.
 */
const VALID_STATES = new Set(['pass', 'blocked', 'fail']);
const MAX_REASON_CODES = 12;

/** Accept only finite, non-negative integers representable without precision loss. */
function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Identify explicit project and branch scopes before comparing monitor receipts. */
function validScope(scope) {
  return scope && typeof scope.projectId === 'string' && scope.projectId.trim()
    && typeof scope.branch === 'string' && scope.branch.trim();
}

/** Read only the allowlisted scalar fields of a previous D11 receipt. */
export function validateD11Previous(previous, scope) {
  if (previous == null) return null;
  if (!previous || previous.schemaVersion !== 1 || previous.mode !== 'd11_read_only_monitor'
    || !VALID_STATES.has(previous.outcome) || !validScope(previous.scope)
    || previous.scope.projectId !== scope.projectId || previous.scope.branch !== scope.branch) {
    throw new TypeError('previous report must match current D11 scope');
  }
  const repo = safeCount(previous.repository?.nodes);
  const fresh = safeCount(previous.repository?.fresh);
  // A failed read-only query can legitimately produce two unknown counts.
  // Treat only exact null/null on a fail receipt as an accepted unknown pair.
  if (previous.outcome === 'fail' && previous.repository?.nodes === null
    && previous.repository?.fresh === null) {
    return { outcome: 'fail', repositoryNodes: null, freshRepositoryNodes: null };
  }
  if (repo === null || fresh === null || fresh > repo) {
    throw new TypeError('previous report contains invalid counts');
  }
  return { outcome: previous.outcome, repositoryNodes: repo, freshRepositoryNodes: fresh };
}

/**
 * Never infer freshness from D8 metadata alone. D7 must verify every visible
 * repository node, and both reports must refer to exactly the same scope.
 */
export function assessD11Observation({ audit, live, previous = null, maxP95Ms = 2000 } = {}) {
  if (!audit || audit.mode !== 'read_only_evidence_audit' || !validScope(audit.scope)
    || !live || live.mode !== 'live_read_only' || !validScope(live.scope)
    || audit.scope.projectId !== live.scope.projectId
    || audit.scope.branch !== live.scope.branch) {
    throw new TypeError('D8 and D7 scoped reports required');
  }
  if (!Number.isFinite(maxP95Ms) || maxP95Ms <= 0 || maxP95Ms > 600000) {
    throw new RangeError('invalid monitoring latency threshold');
  }
  const scope = { projectId: audit.scope.projectId, branch: audit.scope.branch };
  const previousSummary = validateD11Previous(previous, scope);
  const a = audit.claims ?? {};
  const l = live.assessment ?? {};
  const repo = safeCount(l.repositoryNodes);
  const fresh = safeCount(l.freshRepositoryNodes);
  const activeReady = safeCount(a.repositoryVisibleActiveWithCompleteEvidence);
  const primary = safeCount(a.repositoryPrimaryInScope);
  const omitted = safeCount(a.omittedAtGraphBound);
  const samples = safeCount(l.sampleCount);
  const p95Ms = Number.isFinite(l.p95Ms) && l.p95Ms >= 0 ? l.p95Ms : null;
  const reasons = [];

  if (audit.outcome !== 'ready_for_d7_live') reasons.push('d8_coverage_blocked');
  if (repo === null || fresh === null || fresh > repo || activeReady === null || primary === null
    || omitted === null || samples === null || p95Ms === null) reasons.push('invalid_diagnostic_counts');
  if (primary === 0) reasons.push('no_repository_primary_claims');
  if (repo === 0 || fresh === 0) reasons.push('no_verified_fresh_repository_claim');
  if (p95Ms !== null && p95Ms > maxP95Ms) reasons.push('latency_threshold_exceeded');
  if (activeReady === 0) reasons.push('no_active_complete_repository_claims');
  if (omitted > 0) reasons.push('graph_truncated');
  if (l.gitStatus !== 'verified' || l.gitStable !== true) reasons.push('unverified_git_context');
  if (repo !== null && fresh !== null && repo !== fresh) reasons.push('repository_nodes_not_all_fresh');
  if (live.outcome === 'blocked') reasons.push('d7_blocked');
  if (live.outcome === 'fail') reasons.push('d7_failed');
  const safeNotes = new Set(Array.isArray(l.notes) ? l.notes : []);
  if (safeNotes.has('repository_nodes_stale')) reasons.push('stale_repository_evidence');
  if (safeNotes.has('repository_nodes_unchecked')) reasons.push('unchecked_repository_evidence');
  if (safeNotes.has('d6_attention')) reasons.push('diagnostic_attention');
  if (safeNotes.has('graph_truncated') || safeNotes.has('typed_relations_truncated')) reasons.push('graph_truncated');
  if (safeNotes.has('underlying_read_only_query_failed')) reasons.push('read_only_query_failed');
  if (!['pass', 'blocked', 'fail'].includes(live.outcome)) reasons.push('invalid_d7_outcome');
  if (!['ready_for_d7_live', 'blocked'].includes(audit.outcome)) reasons.push('invalid_d8_outcome');
  // The receipt is bounded, but severity must consider every reason.
  const distinctReasons = [...new Set(reasons)];
  const codes = distinctReasons.slice(0, MAX_REASON_CODES);
  const outcome = live.outcome === 'fail' || distinctReasons.includes('invalid_diagnostic_counts')
    || distinctReasons.includes('invalid_d7_outcome') || distinctReasons.includes('invalid_d8_outcome')
    ? 'fail' : codes.length ? 'blocked' : 'pass';

  const previousOutcome = previousSummary?.outcome ?? null;
  const transition = previousOutcome === null ? 'first_observation'
    : previousOutcome === outcome ? 'unchanged'
      : previousOutcome === 'pass' ? 'regressed'
        : outcome === 'pass' ? 'recovered' : 'changed_nonpass';
  const remediation = codes.includes('stale_repository_evidence')
    ? 'review_stale_evidence_then_operator_approved_lifecycle_action'
    : codes.includes('unchecked_repository_evidence') || codes.includes('unverified_git_context')
      ? 'review_checkout_identity_branch_and_git_permissions'
      : codes.includes('graph_truncated') ? 'review_scope_and_graph_capacity'
        : codes.includes('d7_failed') || codes.includes('read_only_query_failed')
          ? 'investigate_read_only_diagnostics'
          : codes.includes('latency_threshold_exceeded') ? 'investigate_read_only_latency'
          : codes.includes('no_repository_primary_claims') || codes.includes('d8_coverage_blocked')
            ? 'review_repository_evidence_capture'
            : codes.length ? 'review_diagnostic_findings' : 'none';
  return {
    schemaVersion: 1, mode: 'd11_read_only_monitor', outcome,
    scope, transition, previousOutcome,
    repository: { nodes: repo, fresh, activeWithCompleteEvidence: activeReady,
      primaryClaims: primary },
    git: { verifiedAndStable: l.gitStatus === 'verified' && l.gitStable === true },
    sampleCount: samples, p95Ms, maxP95Ms, reasonCodes: codes, remediation,
    noCanonicalWrites: true,
  };
}
