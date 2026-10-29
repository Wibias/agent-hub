import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  persistLiveRecallShadowCalibration,
  recallShadowLiveTelemetryId,
} from '../../memory-engine/recall-shadow-live-calibration.mjs';

const PACKET_ID = 'a'.repeat(64);

function packet({
  route = 'fast_v1',
  selectedIds = ['raw-claim-a'],
  diagnostics = true,
  failed = false,
} = {}) {
  return {
    id: PACKET_ID,
    createdAt: '2026-10-23T00:00:00.000Z',
    scope: { projectId: 'project:test', branch: 'main' },
    candidates: [
      {
        claim: { id: 'raw-claim-a', value: 'SECRET A' },
        evidence: { content_redacted: 'SECRET EVIDENCE A' },
      },
      {
        claim: { id: 'raw-claim-b', value: 'SECRET B' },
        evidence: { content_redacted: 'SECRET EVIDENCE B' },
      },
    ],
    localFastPath: {
      route,
      decision: route === 'fallback' ? 'ambiguous' : 'positive',
      selected_ids: selectedIds,
      duration_ms: 7,
      failed,
      policy_version: 'recall-fast-path-v2',
      ...(diagnostics
        ? {
            diagnostics: {
              schema_version: 1,
              thresholds: {
                negative_threshold: 0.83,
                positive_threshold: 0.85,
                support_threshold: 0.86,
                single_margin_threshold: 0.03,
                lexical_k: 1,
                fused_k: 1,
                min_votes: 3,
              },
              candidates: [
                {
                  claim_id: 'raw-claim-a',
                  similarity: 0.9,
                  semantic_rank: 1,
                  lexical_rank: 1,
                  final_rank: 1,
                  rrf_score: 0.03,
                  budget_retained: true,
                  signal_votes: 3,
                },
                {
                  claim_id: 'raw-claim-b',
                  similarity: 0.8,
                  semantic_rank: 2,
                  lexical_rank: 2,
                  final_rank: 2,
                  rrf_score: 0.02,
                  budget_retained: true,
                  signal_votes: 0,
                },
              ],
              top_margin: 0.1,
            },
          }
        : {}),
    },
  };
}

function selector(selectedIds = ['raw-claim-a'], {
  judgeCalled = true,
  failed = false,
  durationMs = 13,
} = {}) {
  return {
    enabled: true,
    failed,
    selected_ids: selectedIds,
    telemetry: {
      route: 'judge',
      judge_called: judgeCalled,
      duration_ms: durationMs,
      candidate_count: 2,
      selected_count: selectedIds.length,
    },
  };
}

function stores() {
  const calibrationRows = [];
  const telemetryRows = [];
  return {
    calibrationRows,
    telemetryRows,
    calibrationStore: {
      record(record) {
        calibrationRows.push(structuredClone(record));
        return { status: 'recorded' };
      },
    },
    telemetryStore: {
      record(input) {
        telemetryRows.push(structuredClone(input));
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
    },
  };
}

test('live match persists content-free calibration plus the exact replay telemetry id', () => {
  const fixture = stores();
  const result = persistLiveRecallShadowCalibration({
    packet: packet(),
    selector: selector(),
    calibrationStore: fixture.calibrationStore,
    telemetryStore: fixture.telemetryStore,
    observedAt: '2026-10-23T00:00:01.000Z',
  });

  assert.equal(result.status, 'persisted');
  assert.equal(result.replay_status, 'fast_v1_match');
  assert.equal(
    result.telemetry_id,
    `shadow-replay:${PACKET_ID}`,
  );
  assert.equal(fixture.calibrationRows.length, 1);
  assert.equal(fixture.telemetryRows.length, 1);

  const persisted = JSON.stringify(fixture.calibrationRows[0]);
  assert.equal(persisted.includes('raw-claim-a'), false);
  assert.equal(persisted.includes('raw-claim-b'), false);
  assert.equal(persisted.includes('SECRET'), false);

  assert.deepEqual(
    {
      id: fixture.telemetryRows[0].id,
      route: fixture.telemetryRows[0].route,
      status: fixture.telemetryRows[0].status,
      localDurationMs: fixture.telemetryRows[0].localDurationMs,
      totalDurationMs: fixture.telemetryRows[0].totalDurationMs,
      candidateCount: fixture.telemetryRows[0].candidateCount,
      selectedCount: fixture.telemetryRows[0].selectedCount,
      judgeCalled: fixture.telemetryRows[0].judgeCalled,
    },
    {
      id: `shadow-replay:${PACKET_ID}`,
      route: 'shadow',
      status: 'fast_v1_match',
      localDurationMs: 7,
      totalDurationMs: 20,
      candidateCount: 2,
      selectedCount: 1,
      judgeCalled: true,
    },
  );
});

test('live mismatch and fallback reuse the normal Judge result without another evaluator', () => {
  {
    const fixture = stores();
    const result = persistLiveRecallShadowCalibration({
      packet: packet(),
      selector: selector(['raw-claim-b']),
      calibrationStore: fixture.calibrationStore,
      telemetryStore: fixture.telemetryStore,
      observedAt: '2026-10-23T00:00:02.000Z',
    });
    assert.equal(result.replay_status, 'fast_v1_mismatch');
    assert.equal(fixture.telemetryRows[0].status, 'fast_v1_mismatch');
  }

  {
    const fixture = stores();
    const result = persistLiveRecallShadowCalibration({
      packet: packet({ route: 'fallback', selectedIds: [] }),
      selector: selector(['raw-claim-a']),
      calibrationStore: fixture.calibrationStore,
      telemetryStore: fixture.telemetryStore,
      observedAt: '2026-10-23T00:00:03.000Z',
    });
    assert.equal(result.replay_status, 'fast_path_fallback');
    assert.equal(fixture.telemetryRows[0].selectedCount, 0);
  }
});

test('only successful exact-runtime Judge observations enter live calibration', () => {
  const cases = [
    {
      packet: packet(),
      selector: selector(['raw-claim-a'], { judgeCalled: false }),
      reason: 'judge_not_called',
    },
    {
      packet: packet(),
      selector: selector(['raw-claim-a'], { failed: true }),
      reason: 'judge_unavailable',
    },
    {
      packet: packet({ diagnostics: false }),
      selector: selector(),
      reason: 'legacy_without_exact_diagnostics',
    },
    {
      packet: packet({ failed: true, route: 'fallback', selectedIds: [] }),
      selector: selector(),
      reason: 'non_quality_status',
    },
  ];

  for (const entry of cases) {
    const fixture = stores();
    const result = persistLiveRecallShadowCalibration({
      ...entry,
      calibrationStore: fixture.calibrationStore,
      telemetryStore: fixture.telemetryStore,
      observedAt: '2026-10-23T00:00:04.000Z',
    });
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, entry.reason);
    assert.equal(fixture.calibrationRows.length, 0);
    assert.equal(fixture.telemetryRows.length, 0);
  }
});

test('telemetry collision is detected after the durable calibration write', () => {
  const calibrationRows = [];
  const result = persistLiveRecallShadowCalibration({
    packet: packet(),
    selector: selector(),
    calibrationStore: {
      record(record) {
        calibrationRows.push(record);
        return { status: 'recorded' };
      },
    },
    telemetryStore: {
      record(input) {
        return {
          id: input.id,
          project_id: input.projectId,
          branch: input.branch,
          route: 'shadow',
          status: 'fast_v1_mismatch',
          local_duration_ms: input.localDurationMs,
          candidate_count: input.candidateCount,
          selected_count: input.selectedCount,
          judge_called: true,
        };
      },
    },
    observedAt: '2026-10-23T00:00:05.000Z',
  });

  assert.equal(result.status, 'telemetry_conflict');
  assert.equal(calibrationRows.length, 1);
});

test('wiring keeps normal Judge authority and lets the existing drain dedupe before Judge creation', async () => {
  const hooks = [
    await readFile(
      new URL('../../memory-engine/adapters/codex-hooks.mjs', import.meta.url),
      'utf8',
    ),
    await readFile(
      new URL('../../memory-engine/adapters/codex-hooks-core.mjs', import.meta.url),
      'utf8',
    ),
  ].join('\n');
  const cli = [
    await readFile(
      new URL('../../memory-engine/adapters/codex-hook-cli.mjs', import.meta.url),
      'utf8',
    ),
    await readFile(
      new URL('../../memory-engine/adapters/codex-hook-cli-core.mjs', import.meta.url),
      'utf8',
    ),
  ].join('\n');
  const drain = await readFile(
    new URL('../../scripts/eval-recall-shadow-replay.mjs', import.meta.url),
    'utf8',
  );

  assert.match(hooks, /persistLiveRecallShadowCalibration/);
  assert.match(hooks, /recallShadowReplayPacket = captured\.packet/);
  assert.match(hooks, /selector: reliance\.selector/);
  assert.match(cli, /RecallShadowCalibrationStore/);
  assert.match(cli, /RecallSelectorTelemetryStore/);
  assert.match(cli, /recallShadowCalibrationStore/);
  assert.match(cli, /recallShadowTelemetryStore/);

  const existingIndex = drain.indexOf('if (existing !== null)');
  const judgeIndex = drain.indexOf('runtime = await createJudgeRuntime');
  assert.ok(existingIndex >= 0);
  assert.ok(judgeIndex > existingIndex);
});

test('telemetry id contract exactly matches replay drain identity', () => {
  assert.equal(
    recallShadowLiveTelemetryId(PACKET_ID),
    `shadow-replay:${PACKET_ID}`,
  );
});
