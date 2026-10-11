import { selectRelevantRecallItems } from './recall-relevance-selector.mjs';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateReliance(reliance) {
  if (!reliance || typeof reliance !== 'object' || Array.isArray(reliance)) {
    throw new TypeError('reliance must be an object');
  }
  if (!Array.isArray(reliance.selected)) {
    throw new TypeError('reliance.selected must be an array');
  }
  if (!Array.isArray(reliance.blocked)) {
    throw new TypeError('reliance.blocked must be an array');
  }
  if (!Array.isArray(reliance.conflict_resolutions)) {
    throw new TypeError('reliance.conflict_resolutions must be an array');
  }
}

export async function filterRecallRelianceForContext({
  query,
  reliance,
  judge = null,
  maxSelected = 8,
  clockMs = Date.now,
}) {
  if (!nonEmptyString(query)) {
    throw new TypeError('query must be a non-empty string');
  }
  validateReliance(reliance);
  if (judge !== null && typeof judge !== 'function') {
    throw new TypeError('judge must be a function or null');
  }
  if (typeof clockMs !== 'function') {
    throw new TypeError('clockMs must be a function');
  }

  if (judge === null) {
    return {
      ...reliance,
      selector: {
        enabled: false,
        failed: false,
        fallback_reason: null,
        selected_ids: reliance.selected
          .map((item) => item?.claim?.id)
          .filter(nonEmptyString),
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

  const selection = await selectRelevantRecallItems({
    query,
    items: reliance.selected,
    judge,
    maxSelected,
    clockMs,
  });

  return {
    ...reliance,
    selected: selection.items,
    selector: {
      enabled: true,
      failed: selection.failed,
      fallback_reason: selection.fallback_reason,
      selected_ids: selection.selected_ids,
      judgment: selection.judgment,
      error: selection.error ?? null,
      telemetry: selection.telemetry,
    },
  };
}
