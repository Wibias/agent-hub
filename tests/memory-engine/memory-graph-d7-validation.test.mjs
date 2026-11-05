import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessD7LiveCoverage, assessD7ScaleProfile, assessD7FreshnessTransitions,
} from '../../memory-engine/memory-graph-d7-validation.mjs';

const report = (n = 100, omitted = 0, d6outcome = 'pass') => ({
  outcome: d6outcome,
  graph: { nodes: n, repositoryNodes: 1,
    freshness: { fresh: 1, stale: 0, unchecked: 0 },
    limits: { nodesOmitted: omitted, typedRelationsOmitted: 0 } },
  git: { status: 'verified', stable: true },
  performance: { samples: 3, p50Ms: 25, p95Ms: 29, maxMs: 30 },
});

test('D7 live coverage does not treat a graph with zero repository nodes as validated', () => {
  const value = report(13);
  value.graph.repositoryNodes = 0;
  value.graph.freshness.fresh = 0;
  const assessment = assessD7LiveCoverage(value);
  assert.equal(assessment.status, 'blocked');
  assert.ok(assessment.notes.includes('no_repository_claims_in_scope'));
});

test('D7 live assessment blocks untrusted context, stale or unchecked repository claims', () => {
  assert.equal(assessD7LiveCoverage(report()).status, 'pass');
  const unstable = report(); unstable.git.stable = false;
  assert.equal(assessD7LiveCoverage(unstable).status, 'blocked');
  const stale = report(); stale.graph.freshness.stale = 1;
  assert.ok(assessD7LiveCoverage(stale).notes.includes('repository_nodes_stale'));
  const missing = report(); missing.graph.freshness.unchecked = 1;
  assert.ok(assessD7LiveCoverage(missing).notes.includes('repository_nodes_unchecked'));
  const failed = report(); failed.outcome = 'fail';
  assert.equal(assessD7LiveCoverage(failed).status, 'fail');
  const failedQuery = { outcome: 'fail', graph: null,
    git: { status: 'unknown', stable: true }, performance: null };
  assert.deepEqual(assessD7LiveCoverage(failedQuery), {
    status: 'fail', notes: ['underlying_read_only_query_failed'],
    sampleCount: null, repositoryNodes: null, freshRepositoryNodes: null,
    gitStatus: 'unknown', gitStable: true, p95Ms: null,
  });
  assert.throws(() => assessD7LiveCoverage({ ...failedQuery, outcome: 'pass' }), TypeError);
  assert.throws(() => assessD7LiveCoverage({ ...failedQuery, graph: undefined }), TypeError);
});

test('D7 scale projection checks 100, 250, 500 and 501 with explicit truncation', () => {
  for (const size of [100, 250, 500]) {
    assert.equal(assessD7ScaleProfile(report(size), size).status, 'pass');
  }
  assert.equal(assessD7ScaleProfile(report(500, 1, 'attention'), 501).status, 'pass');
  assert.equal(assessD7ScaleProfile(report(499), 500).status, 'fail');
  assert.equal(assessD7ScaleProfile(report(500, 0, 'pass'), 501).status, 'fail');
  assert.throws(() => assessD7ScaleProfile(report(), 600), RangeError);
});

test('D7 state machine rejects any accidental freshness or typed-edge escalation', () => {
  const node = (status) => ({ provenance: { authorityClass: 'repo_trusted' }, freshness: { status } });
  const phase = (status, typed, git) => ({
    scope: { status: git }, graph: { nodes: [node(status)],
      edges: Array.from({ length: typed }, () => ({ source: 'typed_relation' })) },
  });
  const phases = {
    initial: phase('fresh', 1, 'verified'),
    changedCommit: phase('stale', 0, 'verified'),
    wrongBranch: phase('unchecked', 0, 'branch_mismatch'),
    noRoot: phase('unchecked', 0, 'unconfigured'),
  };
  assert.equal(assessD7FreshnessTransitions(phases).status, 'pass');
  phases.changedCommit.graph.nodes[0].freshness.status = 'fresh';
  assert.equal(assessD7FreshnessTransitions(phases).status, 'fail');
  phases.changedCommit.graph.nodes[0].freshness.status = 'stale';
  phases.changedCommit.graph.edges = [{ source: 'typed_relation' }];
  assert.equal(assessD7FreshnessTransitions(phases).status, 'fail');
  phases.changedCommit.graph.edges = [];
  phases.initial.graph.edges = [];
  assert.equal(assessD7FreshnessTransitions(phases).status, 'fail');
});

test('D7 reports expose only aggregate labels and no Evidence content or paths', () => {
  const p = report(); p.graph.claim = { value: 'SECRET CONTENT', path: 'C:\\secret\\path' };
  const output = assessD7LiveCoverage(p);
  assert.doesNotMatch(JSON.stringify(output), /SECRET|\\secret|claim/);
});
