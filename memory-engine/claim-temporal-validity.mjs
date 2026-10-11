function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseTimestamp(value, name) {
  if (value === null || value === undefined) return null;
  if (!nonEmptyString(value)) {
    throw new TypeError(name + ' must be null or a valid timestamp');
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(name + ' must be a valid timestamp');
  }
  return milliseconds;
}

function claimBound(claim, snake, camel) {
  if (Object.hasOwn(claim, snake)) return claim[snake];
  return claim[camel] ?? null;
}

export function evaluateClaimTemporalValidity(claim, {
  now = new Date().toISOString(),
} = {}) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
    throw new TypeError('claim must be an object');
  }
  const state = nonEmptyString(claim.state) ? claim.state : 'active';
  const nowMs = parseTimestamp(now, 'now');
  const validFromMs = parseTimestamp(
    claimBound(claim, 'valid_from', 'validFrom'),
    'valid_from',
  );
  const validUntilMs = parseTimestamp(
    claimBound(claim, 'valid_until', 'validUntil'),
    'valid_until',
  );

  if (
    validFromMs !== null
    && validUntilMs !== null
    && validUntilMs < validFromMs
  ) {
    throw new Error('valid_until cannot be before valid_from');
  }

  if (state !== 'active') {
    return {
      current: false,
      effective_state: state,
      reason: 'canonical_state_' + state,
    };
  }
  if (validFromMs !== null && nowMs < validFromMs) {
    return {
      current: false,
      effective_state: 'active',
      reason: 'not_yet_valid',
    };
  }
  if (validUntilMs !== null && nowMs >= validUntilMs) {
    return {
      current: false,
      effective_state: 'expired',
      reason: 'valid_until_reached',
    };
  }
  return {
    current: true,
    effective_state: 'active',
    reason: null,
  };
}

export function filterTemporallyCurrentRecall(result, {
  now = new Date().toISOString(),
} = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('result must be an object');
  }
  if (!Array.isArray(result.items) || !Array.isArray(result.conflicts)) {
    throw new TypeError('result must contain items and conflicts arrays');
  }

  const items = [];
  const excluded = [];
  const currentIds = new Set();
  for (const item of result.items) {
    if (!item?.claim || typeof item.claim !== 'object') continue;
    const temporal = evaluateClaimTemporalValidity(item.claim, { now });
    if (temporal.current) {
      items.push(item);
      if (nonEmptyString(item.claim.id)) currentIds.add(item.claim.id);
    } else {
      excluded.push({
        claim_id: item.claim.id ?? null,
        reason: temporal.reason,
        effective_state: temporal.effective_state,
      });
    }
  }

  const conflicts = result.conflicts.filter((conflict) => (
    currentIds.has(conflict?.claim_a)
    && currentIds.has(conflict?.claim_b)
  ));

  return { ...result, items, conflicts, excluded };
}
