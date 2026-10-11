import { filterRecallRelianceForContext } from '../recall-relevance-pipeline.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function selectCodexAuthoritativeRecall({
  query,
  items,
  conflicts,
  evaluateReliance,
  relevanceJudge = null,
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

  const reliance = evaluateReliance({
    items,
    conflicts,
    use: 'answer',
  });

  return filterRecallRelianceForContext({
    query,
    reliance,
    judge: relevanceJudge,
    maxSelected,
  });
}
