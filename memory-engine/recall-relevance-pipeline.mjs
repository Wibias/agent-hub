import { deriveRecallShadowStatus } from './recall-shadow-comparison.mjs';
import { selectRelevantRecallItems } from './recall-relevance-selector.mjs';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateReliance(reliance) {
  if (!reliance || typeof reliance !== 'object' || Array.isArray(reliance)) {
    throw new TypeError('reliance must be an object');
  }
  if (!Array.isArray(reliance.selected)) throw new TypeError('reliance.selected must be an array');
  if (!Array.isArray(reliance.blocked)) throw new TypeError('reliance.blocked must be an array');
  if (!Array.isArray(reliance.conflict_resolutions)) {
    throw new TypeError('reliance.conflict_resolutions must be an array');
  }
}

function validateFastPathResult(value, allowedIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('fast path result must be an object');
  }
  if (!['fast_v1', 'fast_v2', 'fallback'].includes(value.route)) {
    throw new TypeError('fast path route is unsupported');
  }
  if (!Array.isArray(value.selected_ids)) throw new TypeError('fast path selected_ids must be an array');
  const selectedIds = [];
  const seen = new Set();
  for (const id of value.selected_ids) {
    if (!nonEmptyString(id) || !allowedIds.has(id) || seen.has(id)) {
      throw new TypeError('fast path selected_ids must be unique supplied claim ids');
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
    duration_ms: Number.isFinite(value.duration_ms) && value.duration_ms >= 0
      ? Math.trunc(value.duration_ms)
      : 0,
    failed: value.failed === true,
  };
}



async function evaluateShadowFastPath({
  query,
  items,
  shadowFastPath,
  shadowFastPathContext,
  authoritativeSelectedIds,
  judgeCalled,
  judgeDurationMs,
  judgeAvailable,
  clockMs,
}) {
  const candidateCount = items.length;
  if (candidateCount === 0) {
    return {
      route: 'shadow',
      status: deriveRecallShadowStatus({
        candidateCount,
        fastResult: null,
        judgeSelectedIds: authoritativeSelectedIds ?? [],
        judgeAvailable,
      }),
      candidate_count: 0,
      selected_count: 0,
      judge_called: judgeCalled,
      local_duration_ms: 0,
      total_duration_ms: judgeDurationMs,
      duration_ms: 0,
      failed: false,
      policy_version: null,
    };
  }

  const allowedIds = new Set(items.map((item) => item?.claim?.id).filter(nonEmptyString));
  const startedAt = Number(clockMs());
  let fast;
  try {
    fast = validateFastPathResult(await shadowFastPath({
      query,
      items,
      ...(shadowFastPathContext ?? {}),
    }), allowedIds);
  } catch {
    const elapsed = Math.max(0, Number(clockMs()) - startedAt);
    const localDuration = Number.isFinite(elapsed) ? Math.trunc(elapsed) : 0;
    return {
      route: 'shadow',
      status: 'fast_path_failed',
      candidate_count: candidateCount,
      selected_count: 0,
      judge_called: judgeCalled,
      local_duration_ms: localDuration,
      total_duration_ms: localDuration + judgeDurationMs,
      duration_ms: localDuration,
      failed: true,
      policy_version: null,
    };
  }

  const localDuration = fast.duration_ms;
  const status = deriveRecallShadowStatus({
    candidateCount,
    fastResult: fast,
    judgeSelectedIds: authoritativeSelectedIds ?? [],
    judgeAvailable,
  });

  return {
    route: 'shadow',
    status,
    candidate_count: candidateCount,
    selected_count: fast.selected_ids.length,
    judge_called: judgeCalled,
    local_duration_ms: localDuration,
    total_duration_ms: localDuration + judgeDurationMs,
    duration_ms: localDuration,
    failed: fast.failed === true,
    policy_version: fast.policy_version ?? null,
  };
}

export async function filterRecallRelianceForContext({
  query,
  reliance,
  judge = null,
  fastPath = null,
  fastPathContext = null,
  shadowFastPath = null,
  shadowFastPathContext = null,
  maxSelected = 8,
  clockMs = Date.now,
}) {
  if (!nonEmptyString(query)) throw new TypeError('query must be a non-empty string');
  validateReliance(reliance);
  if (judge !== null && typeof judge !== 'function') throw new TypeError('judge must be a function or null');
  if (fastPath !== null && typeof fastPath !== 'function') throw new TypeError('fastPath must be a function or null');
  if (fastPathContext !== null && (typeof fastPathContext !== 'object' || Array.isArray(fastPathContext))) {
    throw new TypeError('fastPathContext must be an object or null');
  }
  if (shadowFastPath !== null && typeof shadowFastPath !== 'function') {
    throw new TypeError('shadowFastPath must be a function or null');
  }
  if (shadowFastPathContext !== null && (typeof shadowFastPathContext !== 'object' || Array.isArray(shadowFastPathContext))) {
    throw new TypeError('shadowFastPathContext must be an object or null');
  }
  if (fastPath !== null && shadowFastPath !== null) {
    throw new TypeError('fastPath and shadowFastPath are mutually exclusive');
  }
  if (typeof clockMs !== 'function') throw new TypeError('clockMs must be a function');

  if (judge === null && fastPath === null && shadowFastPath === null) {
    return {
      ...reliance,
      selector: {
        enabled: false, failed: false, fallback_reason: null,
        selected_ids: reliance.selected.map((item) => item?.claim?.id).filter(nonEmptyString),
        telemetry: {
          policy_version: null,
          candidate_count: reliance.selected.length,
          selected_count: reliance.selected.length,
          judge_called: false,
          duration_ms: 0,
          failed: false,
        },
      },
    };
  }

  let fast = null;
  if (fastPath !== null) {
    const allowedIds = new Set(reliance.selected.map((item) => item?.claim?.id).filter(nonEmptyString));
    try {
      fast = validateFastPathResult(await fastPath({
        query,
        items: reliance.selected,
        ...(fastPathContext ?? {}),
      }), allowedIds);
    } catch (error) {
      fast = {
        route: 'fallback', selected_ids: [], duration_ms: 0, failed: true,
        error: error instanceof Error ? error.message : String(error),
        decision: 'fast_path_failed', policy_version: null,
      };
    }

    if (fast.route === 'fast_v1' || fast.route === 'fast_v2') {
      const selected = new Set(fast.selected_ids);
      const selectedItems = reliance.selected.filter((item) => selected.has(item.claim.id));
      return {
        ...reliance,
        selected: selectedItems,
        selector: {
          enabled: true, failed: fast.failed, fallback_reason: null,
          selected_ids: selectedItems.map((item) => item.claim.id),
          judgment: null,
          error: fast.error ?? null,
          telemetry: {
            policy_version: fast.policy_version ?? null,
            route: fast.route,
            candidate_count: reliance.selected.length,
            selected_count: selectedItems.length,
            judge_called: false,
            local_duration_ms: fast.duration_ms,
            total_duration_ms: fast.duration_ms,
            duration_ms: fast.duration_ms,
            failed: fast.failed,
          },
        },
      };
    }
  }

  if (judge === null) {
    const selectedIds = reliance.selected.map((item) => item?.claim?.id).filter(nonEmptyString);
    const selector = {
      enabled: fastPath !== null,
      failed: fast?.failed ?? false,
      fallback_reason: fastPath !== null ? 'judge_unavailable' : null,
      selected_ids: selectedIds,
      judgment: null,
      error: fast?.error ?? null,
      telemetry: fastPath === null
        ? {
            policy_version: null, candidate_count: reliance.selected.length,
            selected_count: reliance.selected.length, judge_called: false,
            duration_ms: 0, failed: false,
          }
        : {
            policy_version: fast?.policy_version ?? null, route: 'legacy',
            candidate_count: reliance.selected.length, selected_count: reliance.selected.length,
            judge_called: false, local_duration_ms: fast?.duration_ms ?? 0,
            total_duration_ms: fast?.duration_ms ?? 0, duration_ms: fast?.duration_ms ?? 0,
            failed: fast?.failed ?? false,
          },
    };

    if (shadowFastPath !== null) {
      selector.shadow_telemetry = await evaluateShadowFastPath({
        query,
        items: reliance.selected,
        shadowFastPath,
        shadowFastPathContext,
        authoritativeSelectedIds: null,
        judgeCalled: false,
        judgeDurationMs: 0,
        judgeAvailable: false,
        clockMs,
      });
    }

    return { ...reliance, selector };
  }

  const selection = await selectRelevantRecallItems({ query, items: reliance.selected, judge, maxSelected, clockMs });

  if (fastPath === null) {
    const selector = {
      enabled: true, failed: selection.failed, fallback_reason: selection.fallback_reason,
      selected_ids: selection.selected_ids, judgment: selection.judgment,
      error: selection.error ?? null, telemetry: {
        ...selection.telemetry,
        route: 'judge',
        local_duration_ms: 0,
        total_duration_ms: selection.telemetry.duration_ms,
      },
    };

    if (shadowFastPath !== null) {
      selector.shadow_telemetry = await evaluateShadowFastPath({
        query,
        items: reliance.selected,
        shadowFastPath,
        shadowFastPathContext,
        authoritativeSelectedIds: selection.selected_ids,
        judgeCalled: selection.telemetry.judge_called === true,
        judgeDurationMs: selection.telemetry.duration_ms,
        judgeAvailable: selection.failed !== true,
        clockMs,
      });
    }

    return {
      ...reliance,
      selected: selection.items,
      selector,
    };
  }

  const localDuration = fast?.duration_ms ?? 0;
  return {
    ...reliance,
    selected: selection.items,
    selector: {
      enabled: true, failed: selection.failed, fallback_reason: selection.fallback_reason,
      selected_ids: selection.selected_ids, judgment: selection.judgment,
      error: selection.error ?? null,
      telemetry: {
        ...selection.telemetry,
        route: 'judge', fast_policy_version: fast?.policy_version ?? null,
        local_duration_ms: localDuration,
        total_duration_ms: localDuration + selection.telemetry.duration_ms,
      },
    },
  };
}
