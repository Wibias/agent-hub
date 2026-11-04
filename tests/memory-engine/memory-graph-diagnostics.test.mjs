import test from 'node:test';
import assert from 'node:assert/strict';

import {
  latencySummary,
  listGraphDiagnosticScopes,
  parseGraphDiagnosticsArgs,
  runGraphDiagnostics,
  summarizeGraphDiagnostics,
} from '../../memory-engine/memory-graph-diagnostics.mjs';

const SHA = 'a'.repeat(40);
const SCOPE = { status: 'verified', revisionSha: SHA, repoPath: 'C:\\private\\secret-repository' };
const makeNode = (id, status, options = {}) => ({
  id, value: 'SECRET CLAIM CONTENT',
  provenance: { path: 'private/token.js', blobOid: 'b'.repeat(40), ...options.provenance },
  lifecycleStatus: options.lifecycleStatus ?? 'current',
  freshness: { status },
});
const graph = (nodes) => ({ readOnly: true, projectId: 'project-x', branch: 'main',
  nodes, edges: [{ id: 'secret-edge' }], stats: { omittedClaims: 0, typedRelationsOmittedByBound: 0 } });

test('D6 CLI requires bounded explicit options and never permits arbitrary flags', () => {
  const args = parseGraphDiagnosticsArgs(['--project-id', 'project-x', '--branch', 'main',
    '--repo-root', 'C:\\trusted', '--samples', '3', '--max-p95-ms', '2500']);
  assert.equal(args.samples, 3);
  assert.equal(args.maxP95Ms, 2500);
  assert.deepEqual(args.roots, ['C:\\trusted']);
  assert.throws(() => parseGraphDiagnosticsArgs(['--project-id', 'x']), /required/);
  assert.throws(() => parseGraphDiagnosticsArgs(['--samples', '21', '--project-id', 'x', '--branch', 'main']), /1 to 20/);
  assert.throws(() => parseGraphDiagnosticsArgs(['--revisionSha', SHA]), /unknown option/);
  assert.throws(() => parseGraphDiagnosticsArgs(['--list-scopes', '--repo-root', 'C:\\repo']), /does not accept/);
  assert.throws(() => parseGraphDiagnosticsArgs(['--project-id', 'x', '--project-id', 'y', '--branch', 'main']), /duplicate/);
  assert.throws(() => parseGraphDiagnosticsArgs(['--project-id', 'x', '--branch', 'main', '--repo-root', 'a', '--repo-root', 'a']), /duplicate/);
});

test('D6 lists project/branch counts without values, Evidence or local paths', () => {
  const data = {
    projects: [{ project_id: 'x' }],
    claims: [{ project_id: 'x', branch_scope: 'main', value_text: 'SECRET' }],
    evidence: [{ project_id: 'x', branch: 'feature', path: 'private/token.txt', content: 'SECRET' }],
  };
  const scopes = listGraphDiagnosticScopes(data);
  assert.deepEqual(scopes, [{ projectId: 'x', branches: [
    { branch: 'feature', claims: 0 }, { branch: 'main', claims: 1 },
  ] }]);
  assert.doesNotMatch(JSON.stringify(scopes), /SECRET|private|token/);
});

test('D6 distinguishes observed Freshness statuses and conservative reasons', () => {
  const result = summarizeGraphDiagnostics(graph([
    makeNode('a', 'fresh'),
    makeNode('b', 'stale'),
    makeNode('c', 'stale', { lifecycleStatus: 'historical' }),
    makeNode('d', 'stale', { provenance: { path: null } }),
    makeNode('e', 'stale', { provenance: { blobOid: null } }),
    makeNode('f', 'unchecked'),
    makeNode('g', 'not_repository'),
  ]), { status: 'unconfigured' });
  assert.deepEqual(result.freshness, { fresh: 1, stale: 4, unchecked: 1, not_repository: 1 });
  assert.equal(result.reasons.blob_not_verified, 1);
  assert.equal(result.reasons.historical_or_inactive, 1);
  assert.equal(result.reasons.missing_evidence_path, 1);
  assert.equal(result.reasons.missing_or_invalid_evidence_oid, 1);
  assert.equal(result.reasons.git_unconfigured, 1);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|private|token|a{40}|b{40}/);
});

test('D6 percentile computation is deterministic and rejects invalid timings', () => {
  assert.deepEqual(latencySummary([4.111, 2, 10, 5, 6]), {
    samples: 5, minMs: 2, p50Ms: 5, p95Ms: 10, maxMs: 10,
  });
  assert.deepEqual(latencySummary([3]), { samples: 1, minMs: 3, p50Ms: 3, p95Ms: 3, maxMs: 3 });
  assert.throws(() => latencySummary([-1]));
  assert.throws(() => latencySummary([Infinity]));
});

test('D6 live smoke report is path-free, read-only, bounded and marks stale evidence for review', async () => {
  const times = [0, 20, 40, 80];
  let calls = 0;
  const report = await runGraphDiagnostics({
    projectId: 'project-x', branch: 'main', rootsConfigured: 1, samples: 2,
    now: () => times.shift(), generatedAt: () => '2026-11-05T00:00:00Z',
    queryGraph: async () => { calls++; return { scope: SCOPE, graph: graph([
      makeNode('first', 'fresh'), makeNode('second', 'stale'),
    ]) }; },
  });
  assert.equal(calls, 2);
  assert.equal(report.outcome, 'attention');
  assert.equal(report.git.revisionPrefix, SHA.slice(0, 12));
  assert.equal(report.git.stable, true);
  assert.equal(report.performance.p95Ms, 40);
  assert.deepEqual(report.notes, ['repository_nodes_not_fresh']);
  assert.doesNotMatch(JSON.stringify(report), /private|secret|token|SECRET|repository\\/i);
});

test('D6 unconfigured Git roots block repository validation instead of claiming success', async () => {
  const report = await runGraphDiagnostics({
    projectId: 'project-x', branch: 'main', rootsConfigured: 0, samples: 1,
    queryGraph: async () => ({ scope: { status: 'unconfigured', revisionSha: null },
      graph: graph([makeNode('repo', 'unchecked')]) }),
  });
  assert.equal(report.outcome, 'blocked');
  assert.equal(report.git.status, 'unconfigured');
  assert.equal(report.graph.reasons.git_unconfigured, 1);
  assert.deepEqual(report.notes, ['repository_freshness_unverified']);
});

test('D6 detects changing Git context between repeated measurements', async () => {
  let counter = 0;
  const report = await runGraphDiagnostics({
    projectId: 'project-x', branch: 'main', rootsConfigured: 1, samples: 2,
    queryGraph: async () => ({
      scope: counter++ === 0 ? SCOPE : { status: 'branch_mismatch', revisionSha: null },
      graph: graph([makeNode('repo', 'unchecked')]),
    }),
  });
  assert.equal(report.outcome, 'blocked');
  assert.equal(report.git.stable, false);
  assert.ok(report.notes.includes('git_context_changed_during_sampling'));
});

test('D6 fails without leaking exceptions, SQL, Git paths or partial claim contents', async () => {
  const report = await runGraphDiagnostics({
    projectId: 'project-x', branch: 'main', rootsConfigured: 1, samples: 1,
    queryGraph: async () => { throw new Error('SECRET at C:\\private\\tokens\\memory.sqlite3'); },
  });
  assert.equal(report.outcome, 'fail');
  assert.deepEqual(report.notes, ['read_only_graph_query_failed']);
  assert.equal(report.performance, null);
  assert.doesNotMatch(JSON.stringify(report), /SECRET|private|tokens|sqlite3/);
});

test('D6 rejects graph with mismatched scope and invalid read-only contract', async () => {
  for (const g of [{ ...graph([]), projectId: 'other' }, { ...graph([]), readOnly: false }]) {
    const report = await runGraphDiagnostics({
      projectId: 'project-x', branch: 'main', samples: 1,
      queryGraph: async () => ({ scope: SCOPE, graph: g }),
    });
    assert.equal(report.outcome, 'fail');
  }
});
