import {
  deriveRecallShadowStatus,
} from './recall-shadow-comparison.mjs';
import {
  selectRelevantRecallItems,
} from './recall-relevance-selector.mjs';
import {
  validateRecallShadowReplayPacket,
} from './recall-shadow-replay-packet.mjs';

function elapsedMs(startedAt, finishedAt) {
  const elapsed = Number(finishedAt) - Number(startedAt);
  return Number.isFinite(elapsed)
    ? Math.max(0, elapsed)
    : 0;
}

function resultShape({
  status,
  judgeCalled,
  judgeSelectedIds,
  candidateCount,
  localDurationMs,
  totalDurationMs,
}) {
  return {
    status,
    judgeCalled,
    judgeSelectedIds,
    candidateCount,
    selectedCount: judgeSelectedIds.length,
    localDurationMs,
    totalDurationMs,
  };
}

export async function evaluateRecallShadowReplayPacket({
  packet,
  judge,
  clockMs = Date.now,
} = {}) {
  if (typeof clockMs !== 'function') {
    throw new TypeError('clockMs must be a function');
  }

  const frozen = validateRecallShadowReplayPacket(packet);
  const candidateCount = frozen.candidates.length;
  const localDurationMs = frozen.localFastPath?.duration_ms ?? 0;
  const startedAt = clockMs();

  if (candidateCount === 0) {
    return resultShape({
      status: deriveRecallShadowStatus({
        candidateCount: 0,
        fastResult: null,
        judgeSelectedIds: [],
        judgeAvailable: false,
      }),
      judgeCalled: false,
      judgeSelectedIds: [],
      candidateCount,
      localDurationMs,
      totalDurationMs: elapsedMs(startedAt, clockMs()),
    });
  }

  if (frozen.localFastPath?.failed === true) {
    return resultShape({
      status: deriveRecallShadowStatus({
        candidateCount,
        fastResult: frozen.localFastPath,
        judgeSelectedIds: [],
        judgeAvailable: true,
      }),
      judgeCalled: false,
      judgeSelectedIds: [],
      candidateCount,
      localDurationMs,
      totalDurationMs: elapsedMs(startedAt, clockMs()),
    });
  }

  if (typeof judge !== 'function') {
    return resultShape({
      status: deriveRecallShadowStatus({
        candidateCount,
        fastResult: frozen.localFastPath,
        judgeSelectedIds: [],
        judgeAvailable: false,
      }),
      judgeCalled: false,
      judgeSelectedIds: [],
      candidateCount,
      localDurationMs,
      totalDurationMs: elapsedMs(startedAt, clockMs()),
    });
  }

  const selection = await selectRelevantRecallItems({
    query: frozen.query,
    items: frozen.candidates,
    judge,
    maxSelected: frozen.selectorContract.maxSelected,
    clockMs,
  });

  const judgeAvailable = selection.failed !== true;
  const judgeSelectedIds = judgeAvailable
    ? selection.selected_ids
    : [];

  return resultShape({
    status: deriveRecallShadowStatus({
      candidateCount,
      fastResult: frozen.localFastPath,
      judgeSelectedIds,
      judgeAvailable,
    }),
    judgeCalled: selection.telemetry?.judge_called === true,
    judgeSelectedIds,
    candidateCount,
    localDurationMs,
    totalDurationMs: elapsedMs(startedAt, clockMs()),
  });
}