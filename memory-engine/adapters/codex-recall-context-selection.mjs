import { filterRecallRelianceForContext } from '../recall-relevance-pipeline.mjs';
import { observeRecallFastPath } from '../recall-shadow-replay-capture.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function selectCodexAuthoritativeRecall({
  query,
  items,
  conflicts,
  evaluateReliance,
  relevanceJudge = null,
  recallFastPath = null,
  recallFastPathShadow = null,
  recallFastPathObserver = null,
  onRecallFastPathObservation = null,
  fastPathContext = null,
  maxSelected = 8,
} = {}) {
  if (!nonEmpty(query)) throw new TypeError('query must be a non-empty string');
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  if (!Array.isArray(conflicts)) throw new TypeError('conflicts must be an array');
  if (typeof evaluateReliance !== 'function') {
    throw new TypeError('evaluateReliance must be a function');
  }
  if (relevanceJudge !== null && typeof relevanceJudge !== 'function') {
    throw new TypeError('relevanceJudge must be a function or null');
  }
  if (recallFastPath !== null && typeof recallFastPath !== 'function') {
    throw new TypeError('recallFastPath must be a function or null');
  }
  if (recallFastPathShadow !== null && typeof recallFastPathShadow !== 'function') {
    throw new TypeError('recallFastPathShadow must be a function or null');
  }
  if (recallFastPathObserver !== null && typeof recallFastPathObserver !== 'function') {
    throw new TypeError('recallFastPathObserver must be a function or null');
  }
  if (
    onRecallFastPathObservation !== null
    && typeof onRecallFastPathObservation !== 'function'
  ) {
    throw new TypeError('onRecallFastPathObservation must be a function or null');
  }
  if (
    recallFastPathObserver !== null
    && (recallFastPath !== null || recallFastPathShadow !== null)
  ) {
    throw new TypeError(
      'recallFastPathObserver is mutually exclusive with authoritative and synchronous Shadow Fast Path',
    );
  }

  const reliance = evaluateReliance({
    items,
    conflicts,
    use: 'answer',
  });

  if (recallFastPathObserver !== null) {
    const fastResult = await observeRecallFastPath({
      query,
      items: reliance.selected,
      fastPath: recallFastPathObserver,
      fastPathContext,
    });

    if (onRecallFastPathObservation !== null) {
      try {
        await onRecallFastPathObservation({
          candidates: reliance.selected,
          fastResult,
        });
      } catch {
        // Replay capture is observational and must never affect authority.
      }
    }
  }

  return filterRecallRelianceForContext({
    query,
    reliance,
    judge: relevanceJudge,
    fastPath: recallFastPath,
    fastPathContext,
    shadowFastPath: recallFastPathShadow,
    shadowFastPathContext: fastPathContext,
    maxSelected,
  });
}
