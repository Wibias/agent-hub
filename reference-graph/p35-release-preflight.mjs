import { readFileSync } from 'node:fs';

const TARGET = JSON.parse(readFileSync(new URL('./target.json', import.meta.url), 'utf8'));
const HEX40 = /^[a-f0-9]{40}$/;
// Canonical GitHub account login: one to 39 ASCII alnum/hyphen characters,
// no leading/trailing hyphens, whitespace or case aliases.
const GITHUB_LOGIN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_EVIDENCE_AGE_MS = 15 * 60 * 1000;
const EXPECTED_SIDE = Object.freeze([223, 225]);
const EXPECTED_STACK = Object.freeze([226, 227, 228, 229, 230, 231, 232, 233]);
const EXPECTED_BASES = Object.freeze([
  'main',
  'feat/reference-graph-p27-standard-deep-baseline',
  'feat/reference-graph-p28-profile-candidate-contract',
  'feat/reference-graph-p29-standard-deep-offline-parity',
  'feat/reference-graph-p30-profile-transport-contract',
  'feat/reference-graph-p31-profile-projection',
  'feat/reference-graph-p32-postgrest-contract',
  'feat/reference-graph-p33-pinned-transport-parity',
]);
const EXPECTED_WORKFLOWS = Object.freeze([
  'Memory Graph D11 Read-only Operations',
  'Memory Graph D6 diagnostics',
  'Memory Graph D7 validation',
  'Memory Graph D8 Evidence Coverage Audit',
  'Memory Graph D9 Explicit Repository Capture',
  'Reference graph P16 governance',
  'Reference graph P17 governance',
  'Reference graph P18 governance',
  'Reference graph P19 governance',
  'Reference graph P20 governance',
  'Reference graph P21 governance',
  'Reference graph governance',
  'Release governance',
].sort());
const LOCK_FIELDS = Object.freeze([
  'schema_version', 'repository', 'target', 'expected_ci_workflow_names',
  'independent_release_prs', 'stacked_prs',
]);
const PR_PIN_FIELDS = Object.freeze([
  'number', 'head_sha', 'base_branch', 'base_sha',
]);
const PR_SNAPSHOT_FIELDS = Object.freeze([
  ...PR_PIN_FIELDS, 'author', 'state', 'merged', 'draft',
  'unresolved_review_threads', 'reviews', 'workflows',
]);
const REVIEW_FIELDS = Object.freeze([
  'reviewer', 'state', 'commit_sha', 'submitted_at',
]);
const WORKFLOW_FIELDS = Object.freeze(['name', 'head_sha', 'conclusion']);

export class P35ReleasePreflightError extends Error {
  constructor(category) {
    super('P35 release preflight rejected: ' + category);
    this.name = 'P35ReleasePreflightError';
    this.category = category;
  }
}

function fail(category) {
  throw new P35ReleasePreflightError(category);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
}

function instant(value) {
  if (typeof value !== 'string' || !UTC_MILLIS.test(value)) return false;
  const t = new Date(value);
  return Number.isFinite(t.getTime()) && t.toISOString() === value;
}

function requireSnapshotTime(value, asOf) {
  if (!instant(value)) fail('evidence-invalid');
  const difference = Date.parse(asOf) - Date.parse(value);
  if (difference < 0 || difference > MAX_EVIDENCE_AGE_MS) fail('evidence-stale');
}

function checkLock(lock) {
  if (!exactKeys(lock, LOCK_FIELDS)
    || lock.schema_version !== 'reference-graph.p35-pr-lock.v1'
    || lock.repository !== 'Wibias/agent-hub'
    || !exactKeys(lock.target, ['purpose', 'project_ref', 'project_name', 'region'])
    || JSON.stringify(lock.target) !== JSON.stringify(TARGET)
    || !Array.isArray(lock.expected_ci_workflow_names)
    || JSON.stringify([...lock.expected_ci_workflow_names].sort())
      !== JSON.stringify(EXPECTED_WORKFLOWS)
    || !Array.isArray(lock.independent_release_prs)
    || !Array.isArray(lock.stacked_prs)
    || lock.independent_release_prs.length !== 2
    || lock.stacked_prs.length !== 8) {
    fail('lock-invalid');
  }
  const all = [...lock.independent_release_prs, ...lock.stacked_prs];
  const ids = new Set();
  const shas = new Set();
  for (let i = 0; i < all.length; i++) {
    const row = all[i];
    const number = i < 2 ? EXPECTED_SIDE[i] : EXPECTED_STACK[i - 2];
    if (!exactKeys(row, PR_PIN_FIELDS)
      || row.number !== number
      || !HEX40.test(row.head_sha)
      || !HEX40.test(row.base_sha)
      || typeof row.base_branch !== 'string'
      || ids.has(row.number) || shas.has(row.head_sha)) {
      fail('lock-invalid');
    }
    ids.add(row.number);
    shas.add(row.head_sha);
    if (i < 3) {
      if (row.base_branch !== 'main') fail('lock-invalid');
    } else {
      const index = i - 2;
      if (row.base_branch !== EXPECTED_BASES[index]
        || row.base_sha !== lock.stacked_prs[index - 1].head_sha) {
        fail('lock-invalid');
      }
    }
  }
  if (all[0].base_sha !== all[2].base_sha
    || all[1].base_sha !== all[2].base_sha) {
    fail('lock-invalid');
  }
  return all;
}

function validateGitHub(snapshot, asOf, expectedPins, expectedWorkflows) {
  if (!exactKeys(snapshot,
    ['schema_version', 'repository', 'observed_at', 'prs'])
    || snapshot.schema_version !== 'reference-graph.p35-github-snapshot.v1'
    || snapshot.repository !== 'Wibias/agent-hub'
    || !Array.isArray(snapshot.prs)
    || snapshot.prs.length !== expectedPins.length) {
    fail('evidence-invalid');
  }
  requireSnapshotTime(snapshot.observed_at, asOf);
  const observed = Date.parse(snapshot.observed_at);
  const seen = new Set();

  for (const row of snapshot.prs) {
    if (!exactKeys(row, PR_SNAPSHOT_FIELDS)
      || !Number.isInteger(row.number)
      || seen.has(row.number)
      || !expectedPins.some(pin => pin.number === row.number)
      || typeof row.author !== 'string' || !GITHUB_LOGIN.test(row.author)
      || !HEX40.test(row.head_sha)
      || !HEX40.test(row.base_sha)
      || typeof row.base_branch !== 'string'
      || !['open', 'closed'].includes(row.state)
      || typeof row.merged !== 'boolean'
      || typeof row.draft !== 'boolean'
      || !Number.isInteger(row.unresolved_review_threads)
      || row.unresolved_review_threads < 0
      || !Array.isArray(row.reviews)
      || !Array.isArray(row.workflows)) {
      fail('evidence-invalid');
    }
    seen.add(row.number);

    const reviewSeen = new Set();
    for (const review of row.reviews) {
      if (!exactKeys(review, REVIEW_FIELDS)
        || typeof review.reviewer !== 'string' || !GITHUB_LOGIN.test(review.reviewer)
        || !['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'].includes(review.state)
        || !HEX40.test(review.commit_sha)
        || !instant(review.submitted_at)
        || Date.parse(review.submitted_at) > observed
        || reviewSeen.has(review.reviewer.toLowerCase() + ':' + review.submitted_at)) {
        fail('evidence-invalid');
      }
      reviewSeen.add(review.reviewer.toLowerCase() + ':' + review.submitted_at);
    }
    const workflowSeen = new Set();
    for (const flow of row.workflows) {
      if (!exactKeys(flow, WORKFLOW_FIELDS)
        || typeof flow.name !== 'string' || !flow.name.trim()
        || !HEX40.test(flow.head_sha)
        || typeof flow.conclusion !== 'string'
        || workflowSeen.has(flow.name)) {
        fail('evidence-invalid');
      }
      workflowSeen.add(flow.name);
    }
    // Missing or renamed required workflows are blockers, not proof.
    if (row.workflows.length > 100 || row.reviews.length > 1000) {
      fail('evidence-invalid');
    }
  }
  for (const expected of expectedPins) {
    if (!seen.has(expected.number)) fail('evidence-invalid');
  }
  if (new Set(expectedWorkflows).size !== expectedWorkflows.length) {
    fail('lock-invalid');
  }
}

function validateProjects(inventory, asOf) {
  if (!exactKeys(inventory,
    ['schema_version', 'observed_at', 'project_refs'])
    || inventory.schema_version !== 'reference-graph.p35-project-inventory.v1'
    || !Array.isArray(inventory.project_refs)
    || inventory.project_refs.length > 100
    || inventory.project_refs.some(ref =>
      typeof ref !== 'string' || !PROJECT_REF.test(ref))
    || new Set(inventory.project_refs).size !== inventory.project_refs.length) {
    fail('evidence-invalid');
  }
  requireSnapshotTime(inventory.observed_at, asOf);
}

function latestReviews(pr) {
  const byReviewer = new Map();
  const authorLogin = pr.author.toLowerCase();
  for (const review of [...pr.reviews].sort((a, b) =>
    a.submitted_at.localeCompare(b.submitted_at))) {
    // GitHub logins are case-insensitive. COMMENTED is not a change in
    // review disposition and must never clear an outstanding request for
    // changes, dismiss an approval, or count as approval itself.
    const reviewerLogin = review.reviewer.toLowerCase();
    if (reviewerLogin === authorLogin || review.state === 'COMMENTED') {
      continue;
    }
    // Only later APPROVED, CHANGES_REQUESTED or DISMISSED states supersede
    // the prior controlling disposition of the same independent reviewer.
    byReviewer.set(reviewerLogin, review);
  }
  return [...byReviewer.values()];
}

/**
 * P35 only assesses a reproducible, externally collected snapshot.
 * No source authenticity is implied by parsing a supplied JSON document.
 * It NEVER approves migrations, new profile routing or repository defaults.
 * Exact live reviews and CI must be independently checked at execution time.
 */
export function evaluateP35ReleasePreflight({
  lock,
  githubSnapshot,
  projectInventory,
  asOf,
} = {}) {
  if (!instant(asOf)) fail('evidence-invalid');
  const pins = checkLock(lock);
  validateGitHub(githubSnapshot, asOf, pins, lock.expected_ci_workflow_names);
  validateProjects(projectInventory, asOf);

  const expectedNames = new Set(lock.expected_ci_workflow_names);
  const snapshotById = new Map(githubSnapshot.prs.map(pr => [pr.number, pr]));
  let ciSuccessful = 0;
  let independentlyApproved = 0;
  let unmerged = 0;
  let unresolvedThreads = 0;
  let invalidHeadOrCi = 0;
  let unreviewable = 0;
  let changeRequests = 0;
  const blocked = [];

  for (const pin of pins) {
    const pr = snapshotById.get(pin.number);
    const matchingPin = pr.head_sha === pin.head_sha
      && pr.base_sha === pin.base_sha
      && pr.base_branch === pin.base_branch;
    const ciExact = pr.workflows.length === expectedNames.size
      && pr.workflows.every(w => expectedNames.has(w.name)
        && w.head_sha === pr.head_sha
        && w.conclusion === 'success');
    if (matchingPin && ciExact) ciSuccessful++;
    else invalidHeadOrCi++;

    const reviewable = (pr.state === 'open' && pr.merged === false && pr.draft === false)
      || (pr.state === 'closed' && pr.merged === true && pr.draft === false);
    if (!reviewable) unreviewable++;
    if (!pr.merged) unmerged++;
    unresolvedThreads += pr.unresolved_review_threads;

    const latest = latestReviews(pr);
    const blockedByChanges = latest.some(v => v.state === 'CHANGES_REQUESTED');
    if (blockedByChanges) changeRequests++;
    const approved = latest.some(v => v.state === 'APPROVED'
      && v.commit_sha === pr.head_sha);
    if (approved && !blockedByChanges) independentlyApproved++;

    if (!matchingPin || !ciExact || !reviewable
      || !approved || blockedByChanges || pr.unresolved_review_threads !== 0) {
      blocked.push(pin.number);
    }
  }

  const targetVisible = projectInventory.project_refs.includes(TARGET.project_ref);
  const reviewGateSatisfied = invalidHeadOrCi === 0
    && unreviewable === 0
    && changeRequests === 0
    && independentlyApproved === pins.length
    && unresolvedThreads === 0;
  const reasons = new Set([
    'github-snapshot-not-independent-attestation',
    'live-profile-evidence-unverified',
    'external-release-authorization-missing',
  ]);
  if (invalidHeadOrCi > 0) reasons.add('github-commit-or-ci-drift');
  if (unreviewable > 0) reasons.add('pr-not-reviewable');
  if (changeRequests > 0) reasons.add('changes-requested');
  if (independentlyApproved < pins.length) reasons.add('independent-reviews-missing');
  if (unresolvedThreads > 0) reasons.add('unresolved-review-threads');
  if (unmerged > 0) reasons.add('prs-unmerged');
  if (!targetVisible) reasons.add('target-not-visible');

  return {
    schema_version: 'reference-graph.p35-release-preflight.v1',
    as_of: asOf,
    pr_count: pins.length,
    workflow_checks: pins.length * expectedNames.size,
    ci_successful_prs: ciSuccessful,
    independently_approved_prs: independentlyApproved,
    unmerged_prs: unmerged,
    unresolved_review_threads: unresolvedThreads,
    blocked_pr_numbers: blocked,
    target_visible_in_supplied_inventory: targetVisible,
    review_gate_satisfied: reviewGateSatisfied,
    blockers: [...reasons].sort(),
    github_snapshot_independently_attested: false,
    target_access_authorized: false,
    live_graph_parity_verified: false,
    deployment_authorized: false,
    activation_authorized: false,
    repository_default_graph_enabled: false,
  };
}
