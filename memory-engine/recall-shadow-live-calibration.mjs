import { deriveRecallShadowStatus } from './recall-shadow-comparison.mjs';
import {
  buildRecallShadowCalibrationRecord,
} from './recall-shadow-calibration-store.mjs';

function nonNegativeMs(value) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function selectorIds(selector) {
  if (!Array.isArray(selector?.selected_ids)) {
    throw new TypeError('selector.selected_ids must be an array');
  }
  return [...selector.selected_ids];
}

export function recallShadowLiveTelemetryId(packetId) {
  if (
    typeof packetId !== 'string'
    || !/^[a-f0-9]{64}$/.test(packetId)
  ) {
    throw new TypeError('packetId must be a lowercase SHA-256 hex string');
  }
  return `shadow-replay:${packetId}`;
}

function telemetryCompatible(row, intended) {
  return (
    row?.id === intended.id
    && row?.project_id === intended.projectId
    && row?.branch === intended.branch
    && row?.route === intended.route
    && row?.status === intended.status
    && row?.local_duration_ms === intended.localDurationMs
    && row?.candidate_count === intended.candidateCount
    && row?.selected_count === intended.selectedCount
    && row?.judge_called === intended.judgeCalled
  );
}

export function persistLiveRecallShadowCalibration({
  packet,
  selector,
  calibrationStore,
  telemetryStore = null,
  observedAt = new Date().toISOString(),
} = {}) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
    throw new TypeError('packet must be an object');
  }
  if (
    !calibrationStore
    || typeof calibrationStore !== 'object'
    || typeof calibrationStore.record !== 'function'
  ) {
    throw new TypeError('calibrationStore must expose record()');
  }
  if (
    telemetryStore !== null
    && (
      typeof telemetryStore !== 'object'
      || typeof telemetryStore.record !== 'function'
    )
  ) {
    throw new TypeError('telemetryStore must expose record() or be null');
  }
  if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))) {
    throw new TypeError('observedAt must be a valid timestamp string');
  }

  const judgeCalled = selector?.telemetry?.judge_called === true;
  if (!judgeCalled) {
    return { status: 'skipped', reason: 'judge_not_called' };
  }
  if (selector?.failed === true) {
    return { status: 'skipped', reason: 'judge_unavailable' };
  }

  const judgeSelectedIds = selectorIds(selector);
  const localFastPath = packet.localFastPath;
  const replayStatus = deriveRecallShadowStatus({
    candidateCount: Array.isArray(packet.candidates) ? packet.candidates.length : 0,
    fastResult: localFastPath,
    judgeSelectedIds,
    judgeAvailable: true,
  });

  const built = buildRecallShadowCalibrationRecord({
    packet,
    result: {
      status: replayStatus,
      judgeCalled: true,
      judgeSelectedIds,
    },
  });
  if (built.status !== 'ready') {
    return {
      status: 'skipped',
      reason: built.reason ?? 'calibration_record_not_ready',
      replay_status: replayStatus,
    };
  }

  const calibration = calibrationStore.record(built.record);
  if (telemetryStore === null) {
    return {
      status: 'calibrated_only',
      reason: 'telemetry_store_unavailable',
      replay_status: replayStatus,
      calibration_status: calibration?.status ?? null,
    };
  }

  const localDurationMs = nonNegativeMs(localFastPath?.duration_ms);
  const judgeDurationMs = nonNegativeMs(selector?.telemetry?.duration_ms);
  const telemetryInput = {
    id: recallShadowLiveTelemetryId(packet.id),
    projectId: packet.scope?.projectId,
    branch: packet.scope?.branch,
    observedAt: new Date(observedAt).toISOString(),
    route: 'shadow',
    status: replayStatus,
    localDurationMs,
    totalDurationMs: localDurationMs + judgeDurationMs,
    candidateCount: Array.isArray(packet.candidates) ? packet.candidates.length : 0,
    selectedCount: Array.isArray(localFastPath?.selected_ids)
      ? localFastPath.selected_ids.length
      : 0,
    judgeCalled: true,
  };

  const recorded = telemetryStore.record(telemetryInput);
  if (!telemetryCompatible(recorded, telemetryInput)) {
    return {
      status: 'telemetry_conflict',
      reason: 'existing_shadow_telemetry_is_incompatible',
      replay_status: replayStatus,
      calibration_status: calibration?.status ?? null,
    };
  }

  return {
    status: 'persisted',
    reason: null,
    replay_status: replayStatus,
    calibration_status: calibration?.status ?? null,
    telemetry_id: telemetryInput.id,
  };
}
