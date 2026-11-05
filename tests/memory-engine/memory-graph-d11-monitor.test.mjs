import assert from 'node:assert/strict';
import test from 'node:test';
import { assessD11Observation, validateD11Previous }
  from '../../memory-engine/memory-graph-d11-monitor.mjs';

const scope = { projectId: 'github.com/example/d11', branch: 'main' };
function audit({ primary = 1, active = 1, outcome = 'ready_for_d7_live', omitted = 0 } = {}) {
  return { mode: 'read_only_evidence_audit', scope, outcome, claims: {
    repositoryPrimaryInScope: primary,
    repositoryVisibleActiveWithCompleteEvidence: active, omittedAtGraphBound: omitted,
  }};
}
function live({ outcome = 'pass', repo = 1, fresh = 1,
  gitStatus = 'verified', stable = true, notes = [], p95Ms = 640 } = {}) {
  return { mode: 'live_read_only', scope, outcome, assessment: {
    repositoryNodes: repo, freshRepositoryNodes: fresh, gitStatus,
    gitStable: stable, notes, sampleCount: 5, p95Ms,
  }};
}

test('D11 accepts one verified fresh repository node without leaking payloads', () => {
  const a = audit(); const l = live();
  a.claims.content = 'PRIVATE_CLAIM_PAYLOAD'; l.assessment.repoRoot = 'C:\\PRIVATE_REPO';
  const result = assessD11Observation({ audit: a, live: l });
  assert.equal(result.outcome, 'pass');
  assert.equal(result.transition, 'first_observation');
  assert.equal(result.remediation, 'none');
  assert.equal(result.noCanonicalWrites, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|repoRoot|content/);
});

test('D11 fails closed if D8 contains no repository primary claim', () => {
  const r = assessD11Observation({ audit: audit({ primary: 0, active: 0, outcome: 'blocked' }),
    live: live({ outcome: 'blocked', repo: 0, fresh: 0 }) });
  assert.equal(r.outcome, 'blocked');
  assert.ok(r.reasonCodes.includes('no_repository_primary_claims'));
});

test('D11 does not invent freshness when D7 reports stale evidence', () => {
  const r = assessD11Observation({ audit: audit(), live: live({ outcome: 'blocked', fresh: 0,
    notes: ['repository_nodes_stale', 'd6_attention'] }) });
  assert.equal(r.outcome, 'blocked');
  assert.ok(r.reasonCodes.includes('stale_repository_evidence'));
  assert.match(r.remediation, /operator_approved_lifecycle_action/);
});

test('D11 blocks unchecked Git, truncated graph and implausible counts', () => {
  const r = assessD11Observation({ audit: audit({ omitted: 1 }),
    live: live({ outcome: 'blocked', gitStatus: 'unbound', stable: false,
      notes: ['repository_nodes_unchecked'] }) });
  assert.equal(r.outcome, 'blocked');
  assert.ok(r.reasonCodes.includes('unverified_git_context'));
  assert.ok(r.reasonCodes.includes('graph_truncated'));
  assert.ok(r.reasonCodes.includes('unchecked_repository_evidence'));
  assert.equal(assessD11Observation({ audit: audit(), live: live({ repo: 1, fresh: 2 }) }).outcome, 'fail');
});

test('D11 flags latency threshold failure without modifying canonical state', () => {
  const r = assessD11Observation({ audit: audit(), live: live({ p95Ms: 2600 }), maxP95Ms: 2000 });
  assert.equal(r.outcome, 'blocked');
  assert.ok(r.reasonCodes.includes('latency_threshold_exceeded'));
  assert.equal(r.remediation, 'investigate_read_only_latency');
});

test('D11 previous report reveals regression/recovery only for matching scope', () => {
  const good = assessD11Observation({ audit: audit(), live: live() });
  const bad = assessD11Observation({ audit: audit(), live: live({ outcome: 'blocked', fresh: 0,
    notes: ['repository_nodes_stale'] }), previous: good });
  assert.equal(bad.transition, 'regressed');
  const recovered = assessD11Observation({ audit: audit(), live: live(), previous: bad });
  assert.equal(recovered.transition, 'recovered');
  assert.equal(assessD11Observation({ audit: audit(), live: live(), previous: good }).transition, 'unchanged');
  assert.throws(() => validateD11Previous({ ...good, scope: { ...scope, branch: 'other' } }, scope), /scope/);
  assert.throws(() => validateD11Previous({ ...good, repository: { nodes: 1, fresh: 2 } }, scope), /counts/);
});

test('D11 rejects mismatched project or malformed data instead of claiming success', () => {
  assert.throws(() => assessD11Observation({ audit: audit(), live: {
    ...live(), scope: { projectId: 'github.com/other/d11', branch: 'main' },
  }}), /scoped reports/);
  assert.throws(() => assessD11Observation({ audit: {}, live: live() }), /scoped reports/);
  assert.equal(assessD11Observation({ audit: audit(), live: live({ outcome: 'fail', p95Ms: null }) }).outcome, 'fail');
});

test('D11 accepts a prior failed null-graph receipt and preserves fail-to-pass recovery', () => {
  const failed = assessD11Observation({ audit: audit(), live: live({
    outcome: 'fail', repo: null, fresh: null, p95Ms: null,
    notes: ['underlying_read_only_query_failed'],
  }) });
  assert.equal(failed.outcome, 'fail');
  assert.equal(failed.repository.nodes, null);
  assert.equal(failed.repository.fresh, null);
  assert.deepEqual(validateD11Previous(failed, scope), {
    outcome: 'fail', repositoryNodes: null, freshRepositoryNodes: null,
  });
  const recovered = assessD11Observation({ audit: audit(), live: live(), previous: failed });
  assert.equal(recovered.outcome, 'pass');
  assert.equal(recovered.transition, 'recovered');
  assert.throws(
    () => validateD11Previous({ ...failed, repository: { nodes: null, fresh: 0 } }, scope),
    /invalid counts/,
  );
  assert.throws(
    () => validateD11Previous({ ...failed, repository: { nodes: 'invalid', fresh: null } }, scope),
    /invalid counts/,
  );
  assert.throws(
    () => validateD11Previous({ ...failed, outcome: 'pass' }, scope),
    /invalid counts/,
  );
});

test('D11 fail classification ignores the 12-code display limit', () => {
  const badAudit = audit({ outcome: 'unexpected', primary: 0, active: 0, omitted: 1 });
  const badLive = live({
    outcome: 'unexpected', repo: 1, fresh: 0, p95Ms: 2501,
    gitStatus: 'unbound', stable: false,
    notes: ['repository_nodes_stale', 'repository_nodes_unchecked',
      'd6_attention', 'underlying_read_only_query_failed'],
  });
  const result = assessD11Observation({ audit: badAudit, live: badLive, maxP95Ms: 2000 });
  assert.equal(result.reasonCodes.length, 12);
  assert.ok(!result.reasonCodes.includes('invalid_d7_outcome'));
  assert.ok(!result.reasonCodes.includes('invalid_d8_outcome'));
  assert.equal(result.outcome, 'fail');
});
