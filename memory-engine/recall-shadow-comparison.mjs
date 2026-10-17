function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeUniqueIds(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`);
  }

  const seen = new Set();
  const ids = [];

  for (const id of value) {
    if (!nonEmptyString(id)) {
      throw new TypeError(`${name} must contain non-empty string IDs`);
    }
    if (seen.has(id)) {
      throw new TypeError(`${name} IDs must be unique`);
    }
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

export function selectedIdSetsEqual(leftIds, rightIds) {
  const left = normalizeUniqueIds(leftIds, 'leftIds');
  const right = normalizeUniqueIds(rightIds, 'rightIds');

  if (left.length !== right.length) return false;

  const expected = new Set(left);
  return right.every((id) => expected.has(id));
}

export function deriveRecallShadowStatus({
  candidateCount,
  fastResult,
  judgeSelectedIds = [],
  judgeAvailable = true,
} = {}) {
  if (!Number.isInteger(candidateCount) || candidateCount < 0) {
    throw new RangeError('candidateCount must be a non-negative integer');
  }

  if (candidateCount === 0) {
    return 'no_candidates';
  }

  if (!fastResult || typeof fastResult !== 'object' || Array.isArray(fastResult)) {
    throw new TypeError('fastResult must be an object when candidates exist');
  }

  if (!['fast_v1', 'fast_v2', 'fallback'].includes(fastResult.route)) {
    throw new TypeError('fastResult route is unsupported');
  }

  normalizeUniqueIds(fastResult.selected_ids, 'fastResult.selected_ids');

  // Preserve the current synchronous Shadow precedence exactly.
  if (judgeAvailable !== true) {
    return 'judge_unavailable';
  }

  if (fastResult.failed === true) {
    return 'fast_path_failed';
  }

  if (fastResult.route === 'fallback') {
    if (fastResult.selected_ids.length !== 0) {
      throw new TypeError('fast path fallback must not select IDs');
    }
    return 'fast_path_fallback';
  }

  return selectedIdSetsEqual(fastResult.selected_ids, judgeSelectedIds)
    ? `${fastResult.route}_match`
    : `${fastResult.route}_mismatch`;
}