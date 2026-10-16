import { homedir } from 'node:os';
import {
  dirname,
  join,
  posix,
  resolve,
  win32,
} from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  RECALL_RELEVANCE_POLICY_VERSION,
} from '../memory-engine/recall-relevance-selector.mjs';
import {
  RecallSelectorTelemetryStore,
} from '../memory-engine/recall-selector-telemetry-store.mjs';
import {
  evaluateRecallShadowReplayPacket,
} from '../memory-engine/recall-shadow-replay-evaluator.mjs';
import {
  RecallShadowReplayStore,
} from '../memory-engine/recall-shadow-replay-store.mjs';
import {
  buildRecallShadowCalibrationRecord,
  RecallShadowCalibrationStore,
} from '../memory-engine/recall-shadow-calibration-store.mjs';
import {
  createIsolatedCodexJsonJudge,
} from './codex-isolated-memory-judge.mjs';

const DEFAULT_LIMIT = 20;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const SHADOW_STATUSES = new Set([
  'no_candidates',
  'fast_v1_match',
  'fast_v1_mismatch',
  'fast_v2_match',
  'fast_v2_mismatch',
  'fast_path_fallback',
  'fast_path_failed',
  'judge_unavailable',
]);

const COMPLETE_STATUSES = new Set([
  'no_candidates',
  'fast_v1_match',
  'fast_v2_match',
  'fast_path_fallback',
]);

const REVIEW_STATUSES = new Set([
  'fast_v1_mismatch',
  'fast_v2_mismatch',
]);

const FAILED_STATUSES = new Set([
  'fast_path_failed',
  'judge_unavailable',
]);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value, name) {
  if (!/^[0-9]+$/.test(String(value ?? ''))) {
    throw new TypeError(`${name} must be a positive integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }

  return parsed;
}

function nonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return value;
}

function normalizeTimestamp(value) {
  if (!nonEmpty(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError('clock must return a valid timestamp string');
  }
  return new Date(value).toISOString();
}

export function parseRecallShadowReplayCliArgs(argv = []) {
  if (!Array.isArray(argv)) {
    throw new TypeError('argv must be an array');
  }

  let limit = DEFAULT_LIMIT;
  let limitExplicit = false;
  let recoverStaleProcessingMinutes = null;
  let cleanupFailedOlderThanDays = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (
      argument === '--limit'
      || argument === '--recover-stale-processing-minutes'
      || argument === '--cleanup-failed-older-than-days'
    ) {
      const rawValue = argv[index + 1];
      if (rawValue === undefined || String(rawValue).startsWith('--')) {
        throw new TypeError(`${argument} requires a value`);
      }

      const parsed = positiveInteger(rawValue, argument);
      index += 1;

      if (argument === '--limit') {
        limit = parsed;
        limitExplicit = true;
      } else if (argument === '--recover-stale-processing-minutes') {
        recoverStaleProcessingMinutes = parsed;
      } else {
        cleanupFailedOlderThanDays = parsed;
      }

      continue;
    }

    throw new TypeError(`unknown argument: ${argument}`);
  }

  const maintenanceRequested = (
    recoverStaleProcessingMinutes !== null
    || cleanupFailedOlderThanDays !== null
  );

  return {
    limit,
    limitExplicit,
    recoverStaleProcessingMinutes,
    cleanupFailedOlderThanDays,
    evaluate: !maintenanceRequested || limitExplicit,
  };
}

export function defaultRecallShadowReplayDbPath({
  env = process.env,
  platform = process.platform,
  homeDir = homedir(),
} = {}) {
  if (nonEmpty(env.AGENT_HUB_MEMORY_DB)) {
    return env.AGENT_HUB_MEMORY_DB.trim();
  }

  if (platform === 'win32') {
    const localAppData = nonEmpty(env.LOCALAPPDATA)
      ? env.LOCALAPPDATA.trim()
      : win32.join(homeDir, 'AppData', 'Local');

    return win32.join(
      localAppData,
      'agent-hub',
      'memory.sqlite3',
    );
  }

  const stateHome = nonEmpty(env.XDG_STATE_HOME)
    ? env.XDG_STATE_HOME.trim()
    : join(homeDir, '.local', 'state');

  return posix.join(stateHome, 'agent-hub', 'memory.sqlite3');
}

export function recallShadowReplayTelemetryId(packetId) {
  if (
    typeof packetId !== 'string'
    || !/^[a-f0-9]{64}$/.test(packetId)
  ) {
    throw new TypeError(
      'packetId must be a lowercase SHA-256 hex string',
    );
  }

  return `shadow-replay:${packetId}`;
}

function localSelectedCount(packet) {
  return packet.localFastPath?.selected_ids?.length ?? 0;
}

function localDurationMs(packet) {
  return packet.localFastPath?.duration_ms ?? 0;
}

function compatibleStatuses(packet) {
  if (packet.candidates.length === 0) {
    return new Set(['no_candidates']);
  }

  if (packet.localFastPath?.failed === true) {
    return new Set(['fast_path_failed']);
  }

  if (packet.localFastPath?.route === 'fallback') {
    return new Set([
      'fast_path_fallback',
      'judge_unavailable',
    ]);
  }

  if (packet.localFastPath?.route === 'fast_v1') {
    return new Set([
      'fast_v1_match',
      'fast_v1_mismatch',
      'judge_unavailable',
    ]);
  }

  if (packet.localFastPath?.route === 'fast_v2') {
    return new Set([
      'fast_v2_match',
      'fast_v2_mismatch',
      'judge_unavailable',
    ]);
  }

  return new Set();
}

function expectedJudgeCalled(status) {
  if (status === 'judge_unavailable') return null;
  if (
    status === 'no_candidates'
    || status === 'fast_path_failed'
  ) {
    return false;
  }
  return true;
}

function existingTelemetryCompatible({
  packet,
  telemetryId,
  row,
}) {
  if (!row) return false;

  const expectedJudge = expectedJudgeCalled(row.status);

  return (
    row.id === telemetryId
    && row.route === 'shadow'
    && compatibleStatuses(packet).has(row.status)
    && row.project_id === packet.scope.projectId
    && row.branch === packet.scope.branch
    && row.candidate_count === packet.candidates.length
    && row.local_duration_ms === localDurationMs(packet)
    && row.selected_count === localSelectedCount(packet)
    && (
      expectedJudge === null
      || row.judge_called === expectedJudge
    )
  );
}

function telemetryMatchesIntended(row, intended) {
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

function telemetryInput({
  packet,
  result,
  telemetryId,
  observedAt,
}) {
  if (!SHADOW_STATUSES.has(result.status)) {
    throw new TypeError(
      `unsupported replay terminal status: ${result.status}`,
    );
  }

  return {
    id: telemetryId,
    projectId: packet.scope.projectId,
    branch: packet.scope.branch,
    observedAt,
    route: 'shadow',
    status: result.status,
    localDurationMs: nonNegativeInteger(
      localDurationMs(packet),
      'localDurationMs',
    ),
    totalDurationMs: nonNegativeInteger(
      Math.trunc(result.totalDurationMs ?? 0),
      'totalDurationMs',
    ),
    candidateCount: packet.candidates.length,
    selectedCount: localSelectedCount(packet),
    judgeCalled: result.judgeCalled === true,
  };
}

function emptySummary(limit) {
  return {
    type: 'agent_hub_recall_shadow_replay_drain',
    schemaVersion: 1,
    limit,
    claimed: 0,
    evaluated: 0,
    alreadyRecorded: 0,
    completed: 0,
    review: 0,
    failed: 0,
    malformed: 0,
    judgeUnavailable: 0,
    telemetryConflicts: 0,
    telemetryFailures: 0,
    calibrationRecorded: 0,
    calibrationExisting: 0,
    calibrationSkippedLegacy: 0,
    calibrationSkipped: 0,
    calibrationConflicts: 0,
    calibrationFailures: 0,
    evaluationFailures: 0,
    transitionFailures: 0,
    released: 0,
    processingRetained: 0,
  };
}

function transitionMetadata({
  status,
  telemetryId,
  observedAt = null,
  judgeSelectedIds = null,
  resumed = false,
  reason = null,
  existing = null,
}) {
  return {
    status,
    telemetry_id: telemetryId,
    observed_at: observedAt,
    judge_selected_ids:
      Array.isArray(judgeSelectedIds)
        ? [...judgeSelectedIds]
        : null,
    resumed,
    reason,
    existing_telemetry: existing,
  };
}

function releaseAfterOperationalFailure({
  store,
  packetId,
  summary,
}) {
  try {
    store.releaseToPending(packetId);
    summary.released += 1;
  } catch {
    summary.processingRetained += 1;
  }
}

function applyTerminalTransition({
  store,
  packetId,
  status,
  metadata,
  summary,
}) {
  try {
    if (COMPLETE_STATUSES.has(status)) {
      store.complete(packetId);
      summary.completed += 1;
      return true;
    }

    if (REVIEW_STATUSES.has(status)) {
      store.moveToReview(packetId, metadata);
      summary.review += 1;
      return true;
    }

    if (FAILED_STATUSES.has(status)) {
      store.moveToFailed(packetId, metadata);
      summary.failed += 1;
      if (status === 'judge_unavailable') {
        summary.judgeUnavailable += 1;
      }
      return true;
    }

    throw new TypeError(
      `unsupported terminal transition status: ${status}`,
    );
  } catch {
    summary.transitionFailures += 1;
    releaseAfterOperationalFailure({
      store,
      packetId,
      summary,
    });
    return false;
  }
}

function moveConflictToDiagnosis({
  store,
  packet,
  telemetryId,
  existing,
  summary,
}) {
  summary.telemetryConflicts += 1;

  try {
    store.moveToFailed(packet.id, {
      status: 'telemetry_conflict',
      telemetry_id: telemetryId,
      existing_telemetry: existing,
      packet_scope: {
        project_id: packet.scope.projectId,
        branch: packet.scope.branch,
      },
      candidate_count: packet.candidates.length,
      local_duration_ms: localDurationMs(packet),
      selected_count: localSelectedCount(packet),
    });
    summary.failed += 1;
  } catch {
    summary.transitionFailures += 1;
    releaseAfterOperationalFailure({
      store,
      packetId: packet.id,
      summary,
    });
  }
}

async function defaultCreateReplayJudgeRuntime({
  env = process.env,
} = {}) {
  return createIsolatedCodexJsonJudge({
    workspaceLabel: 'recall-shadow-replay',
    policyVersion: RECALL_RELEVANCE_POLICY_VERSION,
    env,
  });
}

function judgeFunction(runtime) {
  if (!runtime || typeof runtime.judge !== 'function') {
    return null;
  }

  return async ({ prompt }) => runtime.judge(prompt);
}

function persistCalibrationObservation({
  calibrationStore,
  packet,
  result,
  summary,
}) {
  if (calibrationStore === null) return;

  let built;
  try {
    built = buildRecallShadowCalibrationRecord({ packet, result });
  } catch {
    summary.calibrationFailures += 1;
    return;
  }

  if (built.status !== 'ready') {
    if (built.reason === 'legacy_without_exact_diagnostics') {
      summary.calibrationSkippedLegacy += 1;
    } else {
      summary.calibrationSkipped += 1;
    }
    return;
  }

  try {
    const outcome = calibrationStore.record(built.record);
    if (outcome?.status === 'existing') summary.calibrationExisting += 1;
    else summary.calibrationRecorded += 1;
  } catch (error) {
    if (error?.code === 'RECALL_SHADOW_CALIBRATION_CONFLICT') {
      summary.calibrationConflicts += 1;
    } else {
      summary.calibrationFailures += 1;
    }
  }
}

export async function drainRecallShadowReplay({
  store,
  telemetryStore,
  calibrationStore = null,
  limit = DEFAULT_LIMIT,
  createJudgeRuntime = defaultCreateReplayJudgeRuntime,
  evaluatePacket = evaluateRecallShadowReplayPacket,
  env = process.env,
  clock = () => new Date().toISOString(),
  clockMs = Date.now,
} = {}) {
  if (!store || typeof store.claimNext !== 'function') {
    throw new TypeError('store must expose replay-store methods');
  }
  if (
    !telemetryStore
    || typeof telemetryStore.get !== 'function'
    || typeof telemetryStore.record !== 'function'
  ) {
    throw new TypeError(
      'telemetryStore must expose get() and record()',
    );
  }
  if (calibrationStore !== null && typeof calibrationStore.record !== 'function') {
    throw new TypeError('calibrationStore must expose record() or be null');
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('limit must be a positive integer');
  }
  if (typeof createJudgeRuntime !== 'function') {
    throw new TypeError('createJudgeRuntime must be a function');
  }
  if (typeof evaluatePacket !== 'function') {
    throw new TypeError('evaluatePacket must be a function');
  }
  if (typeof clock !== 'function') {
    throw new TypeError('clock must be a function');
  }
  if (typeof clockMs !== 'function') {
    throw new TypeError('clockMs must be a function');
  }

  const summary = emptySummary(limit);

  while (summary.claimed < limit) {
    const claim = store.claimNext();
    if (claim === null) break;

    summary.claimed += 1;

    if (claim.packet === null) {
      summary.malformed += 1;

      try {
        store.moveToFailed(claim.id, {
          status: 'malformed_packet',
          error: claim.error ?? 'packet validation failed',
        });
        summary.failed += 1;
      } catch {
        summary.transitionFailures += 1;
        releaseAfterOperationalFailure({
          store,
          packetId: claim.id,
          summary,
        });
      }

      continue;
    }

    const packet = claim.packet;
    const telemetryId =
      recallShadowReplayTelemetryId(packet.id);

    let existing = null;
    try {
      existing = telemetryStore.get(telemetryId);
    } catch {
      summary.telemetryFailures += 1;
      releaseAfterOperationalFailure({
        store,
        packetId: packet.id,
        summary,
      });
      continue;
    }

    if (existing !== null) {
      if (!existingTelemetryCompatible({
        packet,
        telemetryId,
        row: existing,
      })) {
        moveConflictToDiagnosis({
          store,
          packet,
          telemetryId,
          existing,
          summary,
        });
        continue;
      }

      summary.alreadyRecorded += 1;
      applyTerminalTransition({
        store,
        packetId: packet.id,
        status: existing.status,
        metadata: transitionMetadata({
          status: existing.status,
          telemetryId,
          observedAt: existing.observed_at,
          resumed: true,
        }),
        summary,
      });
      continue;
    }

    let runtime = null;
    let judgeSetupError = null;

    if (
      packet.candidates.length > 0
      && packet.localFastPath?.failed !== true
    ) {
      try {
        runtime = await createJudgeRuntime({ env });
      } catch (error) {
        judgeSetupError = error instanceof Error
          ? error.message
          : String(error);
        runtime = null;
      }
    }

    let result = null;
    try {
      result = await evaluatePacket({
        packet,
        judge: judgeFunction(runtime),
        clockMs,
      });
      summary.evaluated += 1;
    } catch {
      summary.evaluationFailures += 1;
      releaseAfterOperationalFailure({
        store,
        packetId: packet.id,
        summary,
      });
      if (runtime && typeof runtime.close === 'function') {
        try {
          await runtime.close();
        } catch {}
      }
      continue;
    }

    if (runtime && typeof runtime.close === 'function') {
      try {
        await runtime.close();
      } catch {
        // Isolated workspace cleanup must not alter a terminal evaluation.
      }
    }

    const observedAt = normalizeTimestamp(clock());
    persistCalibrationObservation({
      calibrationStore,
      packet,
      result,
      summary,
    });
    const intended = telemetryInput({
      packet,
      result,
      telemetryId,
      observedAt,
    });

    let recorded = null;
    try {
      recorded = telemetryStore.record(intended);
    } catch {
      summary.telemetryFailures += 1;
      releaseAfterOperationalFailure({
        store,
        packetId: packet.id,
        summary,
      });
      continue;
    }

    if (!telemetryMatchesIntended(recorded, intended)) {
      moveConflictToDiagnosis({
        store,
        packet,
        telemetryId,
        existing: recorded,
        summary,
      });
      continue;
    }

    applyTerminalTransition({
      store,
      packetId: packet.id,
      status: result.status,
      metadata: transitionMetadata({
        status: result.status,
        telemetryId,
        observedAt,
        judgeSelectedIds: result.judgeSelectedIds,
        reason: judgeSetupError,
      }),
      summary,
    });
  }

  return {
    ...summary,
    counts: store.counts(),
  };
}

export async function runRecallShadowReplayCli({
  argv = process.argv.slice(2),
  env = process.env,
  platform = process.platform,
  homeDir = homedir(),
  dbPath = null,
  rootDir = null,
  createStore = (options) =>
    new RecallShadowReplayStore(options),
  createTelemetryStore = (options) =>
    new RecallSelectorTelemetryStore(options),
  createCalibrationStore = (options) =>
    new RecallShadowCalibrationStore(options),
  createJudgeRuntime = defaultCreateReplayJudgeRuntime,
  evaluatePacket = evaluateRecallShadowReplayPacket,
  clock = () => new Date().toISOString(),
  clockMs = Date.now,
} = {}) {
  const options = parseRecallShadowReplayCliArgs(argv);
  const resolvedDbPath = dbPath
    ?? defaultRecallShadowReplayDbPath({
      env,
      platform,
      homeDir,
    });
  const resolvedRoot = rootDir
    ?? join(dirname(resolvedDbPath), 'shadow-replay');

  const store = createStore({
    rootDir: resolvedRoot,
  });

  const maintenance = {
    recovered: 0,
    recoverySkipped: 0,
    cleanedFailed: 0,
    cleanupSkipped: 0,
  };

  if (options.recoverStaleProcessingMinutes !== null) {
    const recovered = store.recoverStaleProcessing({
      olderThanMs:
        options.recoverStaleProcessingMinutes * MINUTE_MS,
    });
    maintenance.recovered = recovered.recovered;
    maintenance.recoverySkipped = recovered.skipped;
  }

  if (options.cleanupFailedOlderThanDays !== null) {
    const cleaned = store.cleanupFailed({
      olderThanMs:
        options.cleanupFailedOlderThanDays * DAY_MS,
    });
    maintenance.cleanedFailed = cleaned.deleted;
    maintenance.cleanupSkipped = cleaned.skipped;
  }

  if (!options.evaluate) {
    return {
      type: 'agent_hub_recall_shadow_replay_cli',
      schemaVersion: 1,
      mode: 'maintenance',
      ...maintenance,
      evaluated: 0,
      counts: store.counts(),
    };
  }

  const telemetryStore = createTelemetryStore({
    dbPath: resolvedDbPath,
  });
  const calibrationStore = createCalibrationStore({
    rootDir: resolvedRoot,
  });

  try {
    const drained = await drainRecallShadowReplay({
      store,
      telemetryStore,
      calibrationStore,
      limit: options.limit,
      createJudgeRuntime,
      evaluatePacket,
      env,
      clock,
      clockMs,
    });

    return {
      type: 'agent_hub_recall_shadow_replay_cli',
      schemaVersion: 1,
      mode:
        (
          options.recoverStaleProcessingMinutes !== null
          || options.cleanupFailedOlderThanDays !== null
        )
          ? 'maintenance+drain'
          : 'drain',
      ...maintenance,
      ...drained,
    };
  } finally {
    try {
      telemetryStore.close();
    } catch {}
  }
}

function operationalFailureCount(summary) {
  return (
    (summary.telemetryConflicts ?? 0)
    + (summary.telemetryFailures ?? 0)
    + (summary.evaluationFailures ?? 0)
    + (summary.transitionFailures ?? 0)
  );
}

async function main() {
  const summary = await runRecallShadowReplayCli();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (operationalFailureCount(summary) > 0) {
    process.exitCode = 2;
  }
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}