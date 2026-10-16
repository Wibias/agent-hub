import assert from 'node:assert/strict';
import test from 'node:test';
import { drainRecallShadowReplay } from '../../scripts/eval-recall-shadow-replay.mjs';

function packet() {
  return {
    id: 'b'.repeat(64),
    createdAt: '2026-10-17T00:00:00.000Z',
    scope: { projectId: 'project', branch: 'main' },
    candidates: [
      { claim: { id: 'raw-claim-a', value: 'SECRET' }, evidence: { content_redacted: 'SECRET' } },
      { claim: { id: 'raw-claim-b', value: 'OTHER' }, evidence: { content_redacted: 'OTHER' } },
    ],
    localFastPath: {
      route: 'fast_v1',
      selected_ids: ['raw-claim-a'],
      decision: 'positive',
      failed: false,
      policy_version: 'recall-fast-path-v2',
      duration_ms: 4,
      diagnostics: {
        schema_version: 1,
        thresholds: { negative_threshold: 0.83, positive_threshold: 0.85, support_threshold: 0.86, single_margin_threshold: 0.03, lexical_k: 1, fused_k: 1, min_votes: 3 },
        candidates: [
          { claim_id: 'raw-claim-a', similarity: 0.90, semantic_rank: 1, lexical_rank: 1, final_rank: 1, rrf_score: 0.03, budget_retained: true, signal_votes: 3 },
          { claim_id: 'raw-claim-b', similarity: 0.80, semantic_rank: 2, lexical_rank: 2, final_rank: 2, rrf_score: 0.02, budget_retained: true, signal_votes: 0 },
        ],
        top_margin: 0.10,
      },
    },
  };
}

function stores(calibrationRecord) {
  let claimed = false;
  let completed = false;
  const store = {
    claimNext() {
      if (claimed) return null;
      claimed = true;
      return { id: packet().id, packet: packet() };
    },
    complete() { completed = true; },
    moveToReview() { throw new Error('unexpected review'); },
    moveToFailed() { throw new Error('unexpected failed'); },
    releaseToPending() { throw new Error('unexpected release'); },
    counts() { return { pending: 0, processing: 0, failed: 0, review: 0 }; },
  };
  const telemetryStore = {
    get() { return null; },
    record(input) {
      return {
        id: input.id,
        project_id: input.projectId,
        branch: input.branch,
        observed_at: input.observedAt,
        route: input.route,
        status: input.status,
        local_duration_ms: input.localDurationMs,
        total_duration_ms: input.totalDurationMs,
        candidate_count: input.candidateCount,
        selected_count: input.selectedCount,
        judge_called: input.judgeCalled,
      };
    },
  };
  const calibrationStore = {
    record(record) {
      calibrationRecord.value = record;
      return { status: 'recorded' };
    },
  };
  return { store, telemetryStore, calibrationStore, completed: () => completed };
}

test('drain persists exact calibration before completing a judged match', async () => {
  const calibrationRecord = { value: null };
  const fixture = stores(calibrationRecord);
  const summary = await drainRecallShadowReplay({
    ...fixture,
    limit: 1,
    createJudgeRuntime: async () => ({ judge: async () => ({}), close: async () => {} }),
    evaluatePacket: async () => ({ status: 'fast_v1_match', judgeCalled: true, judgeSelectedIds: ['raw-claim-a'], totalDurationMs: 10 }),
    clock: () => '2026-10-17T00:01:00.000Z',
    clockMs: () => 1,
  });
  assert.equal(fixture.completed(), true);
  assert.equal(summary.calibrationRecorded, 1);
  assert.ok(calibrationRecord.value);
  const text = JSON.stringify(calibrationRecord.value);
  assert.equal(text.includes('raw-claim-a'), false);
  assert.equal(text.includes('SECRET'), false);
});

test('calibration write failure is surfaced but remains fail-open for replay lifecycle', async () => {
  const calibrationRecord = { value: null };
  const fixture = stores(calibrationRecord);
  fixture.calibrationStore.record = () => { throw new Error('disk unavailable'); };
  const summary = await drainRecallShadowReplay({
    ...fixture,
    limit: 1,
    createJudgeRuntime: async () => ({ judge: async () => ({}), close: async () => {} }),
    evaluatePacket: async () => ({ status: 'fast_v1_match', judgeCalled: true, judgeSelectedIds: ['raw-claim-a'], totalDurationMs: 10 }),
    clock: () => '2026-10-17T00:01:00.000Z',
    clockMs: () => 1,
  });
  assert.equal(fixture.completed(), true);
  assert.equal(summary.calibrationFailures, 1);
});
