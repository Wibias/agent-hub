const DEFAULT_RRF_K = 60;

function assertIdList(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  for (const id of value) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError(`${name} entries must be non-empty strings`);
    }
  }
}

export function reciprocalRankFuse({
  lexicalIds,
  semanticIds,
  createdAtById,
  k = DEFAULT_RRF_K,
}) {
  assertIdList(lexicalIds, 'lexicalIds');
  assertIdList(semanticIds, 'semanticIds');
  if (!(createdAtById instanceof Map)) {
    throw new TypeError('createdAtById must be a Map');
  }
  if (!Number.isFinite(k) || k <= 0) {
    throw new RangeError('k must be greater than zero');
  }

  const scores = new Map();

  const addRanks = (ids) => {
    const seen = new Set();
    let rank = 0;
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      rank += 1;
      scores.set(id, (scores.get(id) ?? 0) + (1 / (k + rank)));
    }
  };

  addRanks(lexicalIds);
  addRanks(semanticIds);

  return [...scores.keys()].sort((left, right) => {
    const scoreDifference = scores.get(right) - scores.get(left);
    if (scoreDifference !== 0) return scoreDifference;

    const leftCreatedAt = createdAtById.get(left) ?? '';
    const rightCreatedAt = createdAtById.get(right) ?? '';
    const createdAtDifference = rightCreatedAt.localeCompare(leftCreatedAt);
    if (createdAtDifference !== 0) return createdAtDifference;

    return left.localeCompare(right);
  });
}

function validateBudget(maxItems, maxSerializedBytes) {
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 10) {
    throw new RangeError('maxItems must be an integer between 1 and 10');
  }
  if (
    !Number.isInteger(maxSerializedBytes)
    || maxSerializedBytes < 1
    || maxSerializedBytes > 16_384
  ) {
    throw new RangeError(
      'maxSerializedBytes must be an integer between 1 and 16384',
    );
  }
}

function connectedConflicts(conflicts, retainedIds) {
  return conflicts.filter(
    (conflict) => (
      retainedIds.has(conflict.claim_a)
      || retainedIds.has(conflict.claim_b)
    ),
  );
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function enforceRecallBudget(result, {
  maxItems = 10,
  maxSerializedBytes = 16_384,
} = {}) {
  validateBudget(maxItems, maxSerializedBytes);
  if (!result || typeof result !== 'object') {
    throw new TypeError('result must be an object');
  }
  if (!Array.isArray(result.items) || !Array.isArray(result.conflicts)) {
    throw new TypeError('result must contain items and conflicts arrays');
  }

  const items = result.items.slice(0, maxItems);

  const build = () => {
    const retainedIds = new Set(items.map((item) => item?.claim?.id));
    return {
      items: [...items],
      conflicts: connectedConflicts(result.conflicts, retainedIds),
    };
  };

  let bounded = build();
  while (items.length > 0 && serializedBytes(bounded) > maxSerializedBytes) {
    items.pop();
    bounded = build();
  }

  if (serializedBytes(bounded) > maxSerializedBytes) {
    throw new RangeError(
      'maxSerializedBytes is too small to serialize an empty recall result',
    );
  }

  return bounded;
}
