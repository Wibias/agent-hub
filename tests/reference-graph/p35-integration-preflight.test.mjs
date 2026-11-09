import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  evaluateP35IntegrationPreflight,
  p35IntegrationTreeDigest,
  P35IntegrationPreflightError,
} from '../../reference-graph/p35-integration-preflight.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LOCK_PATH = join(ROOT, 'reference-graph/p35-integration-274-lock.json');
const CLI = join(ROOT, 'reference-graph/cli/p35-integration-274-preflight.mjs');
const LOCK = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
const OBSERVED = '2026-11-09T06:05:00.000Z';

function git(...args) {
  return spawnSync('git', ['-C', ROOT, ...args], { maxBuffer: 64 * 1024 * 1024 });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function repositoryFromLock(overrides = {}) {
  return {
    headSha: LOCK.reviewed_head_sha,
    reviewedHeadPresent: true,
    reviewedHeadIsAncestor: true,
    postPinChangedPaths: [],
    historicalLockSha256: LOCK.historical_p35_lock.sha256,
    fileHashes: LOCK.reviewed_files,
    ...overrides,
  };
}

function evidence({
  author = 'integrator',
  reviews = [],
  workflows = null,
  headSha = LOCK.reviewed_head_sha,
  draft = false,
  threads = 0,
} = {}) {
  return {
    schema_version: 'reference-graph.p35-integration-github-snapshot.v1',
    repository: 'Wibias/agent-hub',
    observed_at: OBSERVED,
    pr: {
      number: 274,
      author,
      state: 'open',
      merged: false,
      draft,
      head_sha: headSha,
      base_sha: LOCK.base_sha,
      base_branch: 'main',
      unresolved_review_threads: threads,
      reviews,
      workflows: workflows ?? LOCK.expected_ci_workflow_names.map(name => ({
        name,
        head_sha: headSha,
        conclusion: 'success',
      })),
    },
  };
}

test('lock pins the consolidated integration tree and keeps documentation separate', () => {
  assert.equal(LOCK.integration_pr, 274);
  assert.equal(LOCK.reviewed_head_sha, '32e4a94718a7ab3ae55c81b653a63861d2bd2203');
  assert.equal(LOCK.base_sha, '3a0055651f98eda7e8cb242cf62ee1ecde427f15');
  assert.equal(LOCK.changed_file_count, 73);
  assert.equal(LOCK.reviewed_files.length + LOCK.documentation_files.length, 73);
  assert.equal(LOCK.reviewed_files.length, 72);
  assert.equal(p35IntegrationTreeDigest(LOCK.reviewed_files), LOCK.reviewed_tree_sha256);
  assert.equal(LOCK.documentation_files[0].path, 'reference-graph/P39.md');
  assert.equal(LOCK.documentation_files[0].sha256.length, 64);
});

test('committed reviewed files match every pinned hash', () => {
  for (const entry of LOCK.reviewed_files) {
    const blob = git('cat-file', 'blob', 'HEAD:' + entry.path);
    assert.equal(blob.status, 0, entry.path + ' must exist at HEAD');
    assert.equal(sha256(blob.stdout), entry.sha256, entry.path + ' drifted from the pin');
  }
  assert.equal(
    sha256(git('cat-file', 'blob', 'HEAD:' + LOCK.historical_p35_lock.path).stdout),
    LOCK.historical_p35_lock.sha256,
  );
});

test('a verified pin still reports no merge or activation authority', () => {
  const report = evaluateP35IntegrationPreflight({
    lock: LOCK,
    repository: repositoryFromLock(),
  });
  assert.equal(report.manifest_verified, true);
  assert.equal(report.pin_verified, true);
  assert.equal(report.review_gate_satisfied, false);
  assert.ok(report.blockers.includes('github-evidence-missing'));
  assert.equal(report.github_snapshot_independently_attested, false);
  assert.equal(report.code_merge_authorized, false);
  assert.equal(report.deployment_authorized, false);
  assert.equal(report.activation_authorized, false);
  assert.equal(report.repository_default_graph_enabled, false);
});

test('a fully approved synthetic head still cannot authorize merge or activation', () => {
  const report = evaluateP35IntegrationPreflight({
    lock: LOCK,
    repository: repositoryFromLock(),
    evidence: evidence({
      reviews: [{
        reviewer: 'independent-reviewer',
        state: 'APPROVED',
        commit_sha: LOCK.reviewed_head_sha,
        submitted_at: '2026-11-09T06:02:00.000Z',
      }],
    }),
    asOf: OBSERVED,
  });
  assert.equal(report.ci_exact_on_reviewed_head, true);
  assert.equal(report.independent_approvals, 1);
  assert.equal(report.review_gate_satisfied, true);
  assert.equal(report.code_merge_authorized, false);
  assert.equal(report.deployment_authorized, false);
  assert.equal(report.activation_authorized, false);
  assert.equal(report.repository_default_graph_enabled, false);
});

test('self approval and comments never satisfy the review gate', () => {
  const report = evaluateP35IntegrationPreflight({
    lock: LOCK,
    repository: repositoryFromLock(),
    evidence: evidence({
      author: 'integrator',
      reviews: [
        {
          reviewer: 'integrator',
          state: 'APPROVED',
          commit_sha: LOCK.reviewed_head_sha,
          submitted_at: '2026-11-09T06:01:00.000Z',
        },
        {
          reviewer: 'commenter',
          state: 'COMMENTED',
          commit_sha: LOCK.reviewed_head_sha,
          submitted_at: '2026-11-09T06:02:00.000Z',
        },
      ],
    }),
    asOf: OBSERVED,
  });
  assert.equal(report.independent_approvals, 0);
  assert.equal(report.review_gate_satisfied, false);
  assert.ok(report.blockers.includes('independent-reviews-missing'));
});

test('review threads, change requests and head drift block the gate', () => {
  const drift = evaluateP35IntegrationPreflight({
    lock: LOCK,
    repository: repositoryFromLock(),
    evidence: evidence({ headSha: '0'.repeat(40) }),
    asOf: OBSERVED,
  });
  assert.equal(drift.ci_exact_on_reviewed_head, false);
  assert.ok(drift.blockers.includes('ci-not-verified-on-reviewed-head'));
  assert.equal(drift.review_gate_satisfied, false);

  const changed = evaluateP35IntegrationPreflight({
    lock: LOCK,
    repository: repositoryFromLock(),
    evidence: evidence({
      reviews: [{
        reviewer: 'reviewer',
        state: 'CHANGES_REQUESTED',
        commit_sha: LOCK.reviewed_head_sha,
        submitted_at: '2026-11-09T06:02:00.000Z',
      }],
      threads: 2,
    }),
    asOf: OBSERVED,
  });
  assert.ok(changed.blockers.includes('changes-requested'));
  assert.ok(changed.blockers.includes('unresolved-review-threads'));
  assert.equal(changed.review_gate_satisfied, false);
});

test('post-pin edits outside the metadata set block the pin', () => {
  const report = evaluateP35IntegrationPreflight({
    lock: LOCK,
    repository: repositoryFromLock({
      postPinChangedPaths: ['reference-graph/p30-profile-transport.mjs'],
    }),
  });
  assert.equal(report.post_pin_scope_verified, false);
  assert.ok(report.blockers.includes('post-pin-non-metadata-change'));
  assert.equal(report.pin_verified, false);
});

test('metadata-only post-pin edits keep the pin valid', () => {
  const report = evaluateP35IntegrationPreflight({
    lock: LOCK,
    repository: repositoryFromLock({
      postPinChangedPaths: ['reference-graph/P39.md', 'reference-graph/P35-INTEGRATION-274.md'],
    }),
  });
  assert.equal(report.post_pin_scope_verified, true);
  assert.equal(report.pin_verified, true);
});

test('a tampered lock manifest is rejected', () => {
  const tampered = structuredClone(LOCK);
  tampered.reviewed_files[0].sha256 = '0'.repeat(64);
  assert.throws(
    () => evaluateP35IntegrationPreflight({ lock: tampered, repository: repositoryFromLock() }),
    error => error instanceof P35IntegrationPreflightError && error.category === 'lock-invalid',
  );
});

test('stale evidence is rejected', () => {
  assert.throws(
    () => evaluateP35IntegrationPreflight({
      lock: LOCK,
      repository: repositoryFromLock(),
      evidence: evidence(),
      asOf: '2026-11-09T06:30:00.000Z',
    }),
    error => error instanceof P35IntegrationPreflightError && error.category === 'evidence-stale',
  );
});

test('CLI exits 2 with false authority flags and never prints a success code', () => {
  const result = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.manifest_verified, true);
  assert.equal(report.code_merge_authorized, false);
  assert.equal(report.deployment_authorized, false);
  assert.equal(report.activation_authorized, false);
  assert.equal(report.repository_default_graph_enabled, false);
});

test('CLI accepts pinned evidence bytes and still exits 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p35-integration-'));
  const file = join(dir, 'evidence.json');
  const payload = evidence({
    reviews: [{
      reviewer: 'independent-reviewer',
      state: 'APPROVED',
      commit_sha: LOCK.reviewed_head_sha,
      submitted_at: '2026-11-09T06:02:00.000Z',
    }],
  });
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  writeFileSync(file, bytes);
  const result = spawnSync(process.execPath, [
    CLI, '--evidence', file, '--sha256', sha256(bytes), '--as-of', OBSERVED,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.review_gate_satisfied, true);
  assert.equal(report.code_merge_authorized, false);
  assert.equal(report.activation_authorized, false);
});
