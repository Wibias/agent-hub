import { createHash } from 'node:crypto';

/**
 * P35 integration-head preflight for a single consolidated Graph PR.
 *
 * This gate is deliberately separate from the historical p35-release-preflight
 * evaluator, whose lock covers only the P27-P34 stack plus the P26 side PRs at
 * 2026-11-07 commit pins. That lock cannot describe PR #274, and its scope must
 * not be relabeled as approval of the consolidated head.
 *
 * The gate verifies content pins, not authority. It never returns an
 * authorizing state: code merge, deployment, activation and repository-default
 * routing each stay false regardless of how much evidence is supplied.
 */
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const GITHUB_LOGIN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const MAX_EVIDENCE_AGE_MS = 15 * 60 * 1000;

export class P35IntegrationPreflightError extends Error {
  constructor(category) {
    super('P35 integration preflight rejected: ' + category);
    this.name = 'P35IntegrationPreflightError';
    this.category = category;
  }
}

function fail(category) {
  throw new P35IntegrationPreflightError(category);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
}

function instant(value) {
  if (typeof value !== 'string' || !UTC_MILLIS.test(value)) return false;
  const t = new Date(value);
  return Number.isFinite(t.getTime()) && t.toISOString() === value;
}

/**
 * Canonical manifest digest: sorted "path\nsha256" lines, newline terminated.
 * Sorting makes the digest independent of git output order.
 */
export function p35IntegrationTreeDigest(files) {
  const lines = [...files]
    .map(entry => [entry.path, entry.sha256])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([path, sha256]) => path + '\n' + sha256);
  return createHash('sha256').update(lines.join('\n') + '\n').digest('hex');
}

function checkLock(lock) {
  if (!exactKeys(lock, [
    'schema_version', 'repository', 'integration_pr', 'reviewed_head_sha',
    'base_branch', 'base_sha', 'changed_file_count', 'reviewed_tree_sha256',
    'historical_p35_lock', 'superseded_pr_numbers',
    'expected_ci_workflow_names', 'metadata_only_paths', 'reviewed_files',
    'documentation_files',
  ])
    || lock.schema_version !== 'reference-graph.p35-integration-lock.v1'
    || lock.repository !== 'Wibias/agent-hub'
    || lock.integration_pr !== 274
    || !HEX40.test(lock.reviewed_head_sha)
    || lock.base_branch !== 'main'
    || !HEX40.test(lock.base_sha)
    || lock.reviewed_head_sha === lock.base_sha
    || !Number.isInteger(lock.changed_file_count)
    || lock.changed_file_count < 1
    || !HEX64.test(lock.reviewed_tree_sha256)
    || !exactKeys(lock.historical_p35_lock, ['path', 'sha256', 'scope'])
    || lock.historical_p35_lock.path !== 'reference-graph/p35-pr-stack-lock.json'
    || !HEX64.test(lock.historical_p35_lock.sha256)
    || lock.historical_p35_lock.scope !== 'historical-p27-p34-stack-only'
    || !Array.isArray(lock.superseded_pr_numbers)
    || lock.superseded_pr_numbers.length !== 19
    || lock.superseded_pr_numbers.some(n => !Number.isInteger(n) || n < 1)
    || new Set(lock.superseded_pr_numbers).size !== lock.superseded_pr_numbers.length
    || !Array.isArray(lock.expected_ci_workflow_names)
    || lock.expected_ci_workflow_names.length !== 13
    || lock.expected_ci_workflow_names.some(n => typeof n !== 'string' || !n.trim())
    || new Set(lock.expected_ci_workflow_names).size !== 13
    || !Array.isArray(lock.metadata_only_paths)
    || lock.metadata_only_paths.some(p => typeof p !== 'string' || !p.trim())
    || new Set(lock.metadata_only_paths).size !== lock.metadata_only_paths.length
    || !Array.isArray(lock.reviewed_files)
    || !Array.isArray(lock.documentation_files)
    || lock.documentation_files.length !== 1
    || lock.reviewed_files.length + lock.documentation_files.length
      !== lock.changed_file_count
    || [...lock.reviewed_files, ...lock.documentation_files]
      .some(entry => !exactKeys(entry, ['path', 'sha256'])
        || typeof entry.path !== 'string' || !entry.path.trim()
        || !HEX64.test(entry.sha256))
    || new Set([...lock.reviewed_files, ...lock.documentation_files]
      .map(entry => entry.path)).size !== lock.changed_file_count) {
    fail('lock-invalid');
  }
  if (p35IntegrationTreeDigest(lock.reviewed_files) !== lock.reviewed_tree_sha256) {
    fail('lock-invalid');
  }
  const metadata = new Set(lock.metadata_only_paths);
  if (lock.reviewed_files.some(entry => metadata.has(entry.path))) {
    fail('lock-invalid');
  }
  // Documentation is tracked separately so a factual correction does not
  // silently change the reviewed runtime surface, but it must also be
  // permitted to change after the pin.
  if (lock.documentation_files.some(entry => !metadata.has(entry.path))) {
    fail('lock-invalid');
  }
  return lock;
}

function latestReviews(pr) {
  const author = String(pr.author).toLowerCase();
  const byReviewer = new Map();
  for (const review of [...pr.reviews].sort((a, b) =>
    a.submitted_at.localeCompare(b.submitted_at))) {
    const reviewer = review.reviewer.toLowerCase();
    // A comment is not a disposition change; self-review never counts.
    if (reviewer === author || review.state === 'COMMENTED') continue;
    byReviewer.set(reviewer, review);
  }
  return [...byReviewer.values()];
}

function validateEvidence(evidence, lock, asOf) {
  if (!exactKeys(evidence,
    ['schema_version', 'repository', 'observed_at', 'pr'])
    || evidence.schema_version
      !== 'reference-graph.p35-integration-github-snapshot.v1'
    || evidence.repository !== 'Wibias/agent-hub'
    || !instant(evidence.observed_at)
    || !instant(asOf)) {
    fail('evidence-invalid');
  }
  const age = Date.parse(asOf) - Date.parse(evidence.observed_at);
  if (age < 0 || age > MAX_EVIDENCE_AGE_MS) fail('evidence-stale');

  const pr = evidence.pr;
  if (!exactKeys(pr, [
    'number', 'author', 'state', 'merged', 'draft', 'head_sha', 'base_sha',
    'base_branch', 'unresolved_review_threads', 'reviews', 'workflows',
  ])
    || pr.number !== lock.integration_pr
    || typeof pr.author !== 'string' || !GITHUB_LOGIN.test(pr.author)
    || !['open', 'closed'].includes(pr.state)
    || typeof pr.merged !== 'boolean'
    || typeof pr.draft !== 'boolean'
    || !HEX40.test(pr.head_sha)
    || !HEX40.test(pr.base_sha)
    || pr.base_branch !== lock.base_branch
    || !Number.isInteger(pr.unresolved_review_threads)
    || pr.unresolved_review_threads < 0
    || !Array.isArray(pr.reviews) || pr.reviews.length > 1000
    || !Array.isArray(pr.workflows) || pr.workflows.length > 100) {
    fail('evidence-invalid');
  }
  for (const review of pr.reviews) {
    if (!exactKeys(review, ['reviewer', 'state', 'commit_sha', 'submitted_at'])
      || typeof review.reviewer !== 'string'
      || !GITHUB_LOGIN.test(review.reviewer)
      || !['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED']
        .includes(review.state)
      || !HEX40.test(review.commit_sha)
      || !instant(review.submitted_at)
      || Date.parse(review.submitted_at) > Date.parse(evidence.observed_at)) {
      fail('evidence-invalid');
    }
  }
  for (const flow of pr.workflows) {
    if (!exactKeys(flow, ['name', 'head_sha', 'conclusion'])
      || typeof flow.name !== 'string' || !flow.name.trim()
      || !HEX40.test(flow.head_sha)
      || typeof flow.conclusion !== 'string') {
      fail('evidence-invalid');
    }
  }
  return pr;
}

/**
 * @param {object} input
 * @param {object} input.lock parsed integration lock
 * @param {{headSha:string, reviewedHeadPresent:boolean, reviewedHeadIsAncestor:boolean|null,
 *          postPinChangedPaths:string[]|null, historicalLockSha256:string,
 *          fileHashes:{path:string, sha256:string}[]}} input.repository
 * @param {object|null} input.evidence optional GitHub snapshot
 * @param {string|null} input.asOf explicit UTC clock for evidence freshness
 */
export function evaluateP35IntegrationPreflight({
  lock,
  repository,
  evidence = null,
  asOf = null,
} = {}) {
  const pinned = checkLock(lock);
  if (!repository || typeof repository !== 'object') fail('repository-invalid');
  if (!HEX40.test(repository.headSha)
    || typeof repository.reviewedHeadPresent !== 'boolean'
    || typeof repository.historicalLockSha256 !== 'string'
    || !Array.isArray(repository.fileHashes)) {
    fail('repository-invalid');
  }

  const blockers = new Set();

  const manifestVerified = repository.fileHashes.length === pinned.reviewed_files.length
    && p35IntegrationTreeDigest(repository.fileHashes) === pinned.reviewed_tree_sha256;
  if (!manifestVerified) blockers.add('reviewed-manifest-mismatch');

  const historicalLockMatches =
    repository.historicalLockSha256 === pinned.historical_p35_lock.sha256;
  if (!historicalLockMatches) blockers.add('historical-lock-digest-mismatch');

  const metadata = new Set(pinned.metadata_only_paths);
  let postPinScopeVerified = null;
  let postPinChangedPaths = null;
  if (repository.reviewedHeadPresent
    && typeof repository.reviewedHeadIsAncestor === 'boolean'
    && Array.isArray(repository.postPinChangedPaths)) {
    postPinChangedPaths = [...repository.postPinChangedPaths].sort();
    if (!repository.reviewedHeadIsAncestor) {
      postPinScopeVerified = false;
      blockers.add('reviewed-head-not-ancestor');
    } else if (postPinChangedPaths.some(path => !metadata.has(path))) {
      postPinScopeVerified = false;
      blockers.add('post-pin-non-metadata-change');
    } else {
      postPinScopeVerified = true;
    }
  } else {
    // A shallow CI checkout cannot prove ancestry. Report the gap rather than
    // inferring success from an unavailable history.
    blockers.add('pin-history-unavailable');
  }

  let ciExact = null;
  let independentApprovals = null;
  let changesRequested = null;
  let unresolvedThreads = null;
  let reviewGateSatisfied = false;

  if (evidence === null) {
    blockers.add('github-evidence-missing');
  } else {
    const pr = validateEvidence(evidence, pinned, asOf);
    const expected = new Set(pinned.expected_ci_workflow_names);
    const seen = new Set(pr.workflows.map(flow => flow.name));
    ciExact = pr.head_sha === pinned.reviewed_head_sha
      && pr.base_sha === pinned.base_sha
      && pr.workflows.length === expected.size
      && [...seen].every(name => expected.has(name))
      && pr.workflows.every(flow => expected.has(flow.name)
        && flow.head_sha === pinned.reviewed_head_sha
        && flow.conclusion === 'success');
    if (!ciExact) blockers.add('ci-not-verified-on-reviewed-head');

    const latest = latestReviews(pr);
    changesRequested = latest.some(review => review.state === 'CHANGES_REQUESTED');
    if (changesRequested) blockers.add('changes-requested');
    independentApprovals = latest.filter(review => review.state === 'APPROVED'
      && review.commit_sha === pinned.reviewed_head_sha).length;
    if (independentApprovals < 1) blockers.add('independent-reviews-missing');
    unresolvedThreads = pr.unresolved_review_threads;
    if (unresolvedThreads !== 0) blockers.add('unresolved-review-threads');

    const reviewable = (pr.state === 'open' && !pr.merged && !pr.draft)
      || (pr.state === 'closed' && pr.merged && !pr.draft);
    if (!reviewable) blockers.add('pr-not-reviewable');

    reviewGateSatisfied = ciExact
      && independentApprovals >= 1
      && !changesRequested
      && unresolvedThreads === 0
      && reviewable;
  }

  const pinVerified = manifestVerified
    && historicalLockMatches
    && postPinScopeVerified === true;

  blockers.add('deployment-activation-authority-not-derivable-from-this-gate');

  return {
    schema_version: 'reference-graph.p35-integration-preflight.v1',
    integration_pr: pinned.integration_pr,
    reviewed_head_sha: pinned.reviewed_head_sha,
    base_sha: pinned.base_sha,
    reviewed_file_count: pinned.changed_file_count,
    reviewed_tree_sha256: pinned.reviewed_tree_sha256,
    manifest_verified: manifestVerified,
    historical_lock_sha256_matches: historicalLockMatches,
    reviewed_head_present_locally: repository.reviewedHeadPresent,
    post_pin_changed_paths: postPinChangedPaths,
    post_pin_scope_verified: postPinScopeVerified,
    evidence_supplied: evidence !== null,
    ci_exact_on_reviewed_head: ciExact,
    independent_approvals: independentApprovals,
    changes_requested: changesRequested,
    unresolved_review_threads: unresolvedThreads,
    review_gate_satisfied: reviewGateSatisfied,
    pin_verified: pinVerified,
    blockers: [...blockers].sort(),
    github_snapshot_independently_attested: false,
    code_merge_authorized: false,
    deployment_authorized: false,
    activation_authorized: false,
    repository_default_graph_enabled: false,
  };
}
