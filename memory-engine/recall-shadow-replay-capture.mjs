import {
  createRecallShadowReplayPacket,
} from './recall-shadow-replay-packet.mjs';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateObservedFastPathResult(value, allowedIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('fast path result must be an object');
  }
  if (!['fast_v1', 'fast_v2', 'fallback'].includes(value.route)) {
    throw new TypeError('fast path route is unsupported');
  }
  if (!Array.isArray(value.selected_ids)) {
    throw new TypeError('fast path selected_ids must be an array');
  }

  const selectedIds = [];
  const seen = new Set();
  for (const id of value.selected_ids) {
    if (!nonEmptyString(id) || !allowedIds.has(id) || seen.has(id)) {
      throw new TypeError(
        'fast path selected_ids must be unique supplied claim ids',
      );
    }
    seen.add(id);
    selectedIds.push(id);
  }

  if (value.route === 'fallback' && selectedIds.length > 0) {
    throw new TypeError('fast path fallback must not select claims');
  }

  return {
    ...value,
    selected_ids: selectedIds,
    duration_ms:
      Number.isFinite(value.duration_ms) && value.duration_ms >= 0
        ? Math.trunc(value.duration_ms)
        : 0,
    failed: value.failed === true,
  };
}

export async function observeRecallFastPath({
  query,
  items,
  fastPath,
  fastPathContext = null,
  clockMs = Date.now,
} = {}) {
  if (!nonEmptyString(query)) {
    throw new TypeError('query must be a non-empty string');
  }
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  if (fastPath !== null && typeof fastPath !== 'function') {
    throw new TypeError('fastPath must be a function or null');
  }
  if (
    fastPathContext !== null
    && (
      typeof fastPathContext !== 'object'
      || Array.isArray(fastPathContext)
    )
  ) {
    throw new TypeError('fastPathContext must be an object or null');
  }
  if (typeof clockMs !== 'function') {
    throw new TypeError('clockMs must be a function');
  }

  if (items.length === 0) return null;

  const allowedIds = new Set();
  for (const item of items) {
    const id = item?.claim?.id;
    if (!nonEmptyString(id) || allowedIds.has(id)) {
      throw new TypeError(
        'items must contain unique non-empty claim ids',
      );
    }
    allowedIds.add(id);
  }

  const startedAt = Number(clockMs());

  try {
    if (fastPath === null) {
      throw new Error('local Fast Path is unavailable');
    }

    return validateObservedFastPathResult(
      await fastPath({
        query,
        items,
        ...(fastPathContext ?? {}),
      }),
      allowedIds,
    );
  } catch (error) {
    const elapsed = Math.max(
      0,
      Number(clockMs()) - startedAt,
    );

    return {
      route: 'fallback',
      selected_ids: [],
      duration_ms: Number.isFinite(elapsed)
        ? Math.trunc(elapsed)
        : 0,
      failed: true,
      error: error instanceof Error
        ? error.message
        : String(error),
      decision: 'fast_path_failed',
      policy_version: null,
    };
  }
}

export function captureRecallShadowReplayPacket({
  store,
  projectId,
  branch,
  sessionId,
  turnId,
  query,
  candidates,
  fastResult,
  retrievalTelemetry = null,
  maxSelected = 8,
  createdAt,
} = {}) {
  if (!store || typeof store.capture !== 'function') {
    throw new TypeError('store must expose capture()');
  }

  const packet = createRecallShadowReplayPacket({
    projectId,
    branch,
    sessionId,
    turnId,
    query,
    candidates,
    fastResult,
    retrievalTelemetry,
    maxSelected,
    createdAt,
  });

  return {
    packet,
    capture: store.capture(packet),
  };
}