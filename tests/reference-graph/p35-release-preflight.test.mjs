import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  P35ReleasePreflightError,
  evaluateP35ReleasePreflight,
} from '../../reference-graph/p35-release-preflight.mjs';

const lock = JSON.parse(readFileSync('reference-graph/p35-pr-stack-lock.json', 'utf8'));
const asOf = '2026-11-07T19:00:00.000Z';
const observedAt = '2026-11-07T18:59:00.000Z';
const target = 'vrznfnxzlxaavpqbzbzd';

function facts({ independentApprovals = false, targetListed = false, allMerged = false } = {}) {
  const prs = [...lock.independent_release_prs, ...lock.stacked_prs].map(p => ({
    number: p.number,
    head_sha: p.head_sha,
    base_branch: p.base_branch,
    base_sha: p.base_sha,
    author: 'Wibias',
    state: allMerged ? 'closed' : 'open',
    merged: allMerged,
    draft: false,
    unresolved_review_threads: 0,
    reviews: independentApprovals ? [{
      reviewer: 'independent-reviewer', state: 'APPROVED',
      commit_sha: p.head_sha, submitted_at: observedAt,
    }] : [],
    workflows: lock.expected_ci_workflow_names.map(name => ({
      name, head_sha: p.head_sha, conclusion: 'success',
    })),
  }));
  return {
    lock,
    asOf,
    githubSnapshot: {
      schema_version: 'reference-graph.p35-github-snapshot.v1',
      repository: 'Wibias/agent-hub',
      observed_at: observedAt,
      prs,
    },
    projectInventory: {
      schema_version: 'reference-graph.p35-project-inventory.v1',
      observed_at: observedAt,
      project_refs: targetListed ? [target] : ['qiaoerpncwbyglhyoftx'],
    },
  };
}

test('P35 current-like evidence: 13/13 CI on 10 PRs does not replace reviews, merges or target access', () => {
  const report = evaluateP35ReleasePreflight(facts());
  assert.equal(report.schema_version, 'reference-graph.p35-release-preflight.v1');
  assert.equal(report.pr_count, 10);
  assert.equal(report.workflow_checks, 130);
  assert.equal(report.ci_successful_prs, 10);
  assert.equal(report.independently_approved_prs, 0);
  assert.equal(report.unmerged_prs, 10);
  assert.equal(report.target_visible_in_supplied_inventory, false);
  assert.equal(report.review_gate_satisfied, false);
  assert.ok(report.blockers.includes('independent-reviews-missing'));
  assert.ok(report.blockers.includes('prs-unmerged'));
  assert.ok(report.blockers.includes('target-not-visible'));
  assert.ok(report.blockers.includes('live-profile-evidence-unverified'));
  assert.ok(report.blockers.includes('external-release-authorization-missing'));
  for (const flag of [
    'github_snapshot_independently_attested', 'target_access_authorized',
    'live_graph_parity_verified', 'deployment_authorized',
    'activation_authorized', 'repository_default_graph_enabled',
  ]) assert.equal(report[flag], false, flag);
  assert.doesNotMatch(JSON.stringify(report), /sb_secret_|search_text|service_role_key|author|reviewer/);
});

test('P35 independently approved current SHA completes only the code review gate, not release approval', () => {
  const input = facts({ independentApprovals: true, targetListed: true });
  const report = evaluateP35ReleasePreflight(input);
  assert.equal(report.ci_successful_prs, 10);
  assert.equal(report.independently_approved_prs, 10);
  assert.equal(report.review_gate_satisfied, true);
  assert.equal(report.unmerged_prs, 10);
  assert.equal(report.deployment_authorized, false);
  assert.equal(report.activation_authorized, false);
  assert.equal(report.target_visible_in_supplied_inventory, true);
  assert.ok(report.blockers.includes('prs-unmerged'));
  assert.ok(report.blockers.includes('live-profile-evidence-unverified'));
});

test('P35 rejects stale or mismatched review SHA, self-approvals, dismissals and requests for changes', () => {
  const variations = [
    [p => { p.reviews[0].commit_sha = '0'.repeat(40); }, 'independent-reviews-missing'],
    [p => { p.reviews[0].reviewer = 'Wibias'; }, 'independent-reviews-missing'],
    [p => { p.reviews[0].state = 'CHANGES_REQUESTED'; }, 'changes-requested'],
    [p => { p.reviews.push({
      reviewer: 'independent-reviewer', state: 'DISMISSED',
      commit_sha: p.head_sha, submitted_at: '2026-11-07T18:59:30.000Z',
    }); }, 'independent-reviews-missing'],
    [p => { p.unresolved_review_threads = 1; }, 'unresolved-review-threads'],
  ];
  for (const [change, expected] of variations) {
    const input = facts({ independentApprovals: true, targetListed: true });
    change(input.githubSnapshot.prs[0]);
    const report = evaluateP35ReleasePreflight(input);
    assert.equal(report.review_gate_satisfied, false);
    assert.ok(report.blockers.includes(expected), expected);
    assert.equal(report.deployment_authorized, false);
  }
});

test('P35 refuses any CI not successful on the pinned current SHA or unexpected PR/base drift', () => {
  const variations = [
    p => { p.workflows[0].conclusion = 'in_progress'; },
    p => { p.workflows[0].head_sha = '0'.repeat(40); },
    p => { p.workflows.pop(); },
    p => { p.head_sha = 'f'.repeat(40); },
    p => { p.base_sha = 'a'.repeat(40); },
    p => { p.base_branch = 'main'; },
    p => { p.draft = true; },
  ];
  for (const mutate of variations) {
    const input = facts({ independentApprovals: true });
    mutate(input.githubSnapshot.prs[3]);
    const report = evaluateP35ReleasePreflight(input);
    assert.equal(report.review_gate_satisfied, false);
    assert.ok(report.blockers.includes('github-commit-or-ci-drift')
      || report.blockers.includes('pr-not-reviewable'));
    assert.equal(report.activation_authorized, false);
  }
});

test('P35 prevents lock-chain edits, duplicated PRs and injected evidence', () => {
  const variants = [
    v => { v.lock.stacked_prs[1].base_sha = '0'.repeat(40); },
    v => { v.lock.stacked_prs[2].number = 227; },
    v => { v.lock.expected_ci_workflow_names.push('surprise'); },
    v => { v.githubSnapshot.prs.push(v.githubSnapshot.prs[0]); },
    v => { v.githubSnapshot.prs[0].secret = 'opaque'; },
    v => { v.projectInventory.project_refs.push('bad$$'); },
    v => { v.githubSnapshot.observed_at = '2026-11-06T18:59:00.000Z'; },
    v => { v.projectInventory.observed_at = '2026-11-08T18:59:00.000Z'; },
    v => { v.githubSnapshot.prs[0].reviews = [{ reviewer:'X', state:'APPROVED', commit_sha:'0'.repeat(40), submitted_at:'bad' }]; },
  ];
  for (const mutate of variants) {
    const input = structuredClone(facts({ independentApprovals: true }));
    mutate(input);
    assert.throws(() => evaluateP35ReleasePreflight(input),
      P35ReleasePreflightError);
  }
});

test('P35 evidence from all merged and approved PRs is never migration or activation permission', () => {
  const report = evaluateP35ReleasePreflight(
    facts({ independentApprovals: true, targetListed: true, allMerged: true }),
  );
  assert.equal(report.review_gate_satisfied, true);
  assert.equal(report.unmerged_prs, 0);
  assert.equal(report.target_visible_in_supplied_inventory, true);
  assert.equal(report.deployment_authorized, false);
  assert.equal(report.activation_authorized, false);
  assert.ok(report.blockers.includes('live-profile-evidence-unverified'));
  assert.ok(report.blockers.includes('external-release-authorization-missing'));
});

test('P35 does not import production router or Supabase write-capable code', () => {
  const src = readFileSync('reference-graph/p35-release-preflight.mjs', 'utf8');
  assert.doesNotMatch(src, /import.*p11-runtime-router|import.*p30-profile-transport|process\.env|fetch\(|writeFile|SUPABASE_SERVICE_ROLE_KEY|apply_migration|create_pull_request/);
  const router = readFileSync('reference-graph/p11-runtime-router.mjs', 'utf8');
  assert.doesNotMatch(router, /p35-release-preflight/);
});
