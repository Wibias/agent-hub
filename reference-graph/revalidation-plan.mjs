import { isFresh } from '../knowledge/design-references/scripts/lib.mjs';

function requireRecords(records) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  const seen = new Set();
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError('records must contain objects');
    }
    const id = String(record.id ?? '').trim();
    if (!id) throw new TypeError('record.id must be non-empty');
    if (seen.has(id)) throw new Error(`duplicate record id: ${id}`);
    seen.add(id);
  }
  return records;
}

function requireNow(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError('currentNow must be a valid Date');
  }
  return value;
}

function requireWaveSize(value) {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new RangeError('waveSize must be an integer between 1 and 100');
  }
  return value;
}

function targetOrder(left, right) {
  const staleState = Number(right.reviewStatus === 'stale') - Number(left.reviewStatus === 'stale');
  if (staleState !== 0) return staleState;
  const verified = String(left.lastVerifiedAt ?? '').localeCompare(String(right.lastVerifiedAt ?? ''));
  if (verified !== 0) return verified;
  const ttl = Number(left.ttlDays) - Number(right.ttlDays);
  if (ttl !== 0) return ttl;
  return String(left.id).localeCompare(String(right.id));
}

function normalizeCompletedIds(values) {
  if (!Array.isArray(values)) throw new TypeError('completedIds must be an array');
  const ids = values.map((value) => String(value ?? '').trim());
  if (ids.some((id) => !id)) throw new TypeError('completedIds must contain non-empty ids');
  if (new Set(ids).size !== ids.length) throw new Error('completedIds must not contain duplicates');
  return ids;
}

function chunk(values, size) {
  const waves = [];
  for (let offset = 0; offset < values.length; offset += size) {
    waves.push(values.slice(offset, offset + size));
  }
  return waves;
}

export function planP4RevalidationQueue({
  records,
  currentNow,
  completedIds = [],
  waveSize = 50,
} = {}) {
  const rows = requireRecords(records);
  const now = requireNow(currentNow);
  const size = requireWaveSize(waveSize);
  const completedInput = normalizeCompletedIds(completedIds);

  const targetRows = [];
  const alreadyFresh = [];
  const excluded = [];

  for (const record of rows) {
    const id = String(record.id).trim();
    if (record.reviewStatus === 'archived') {
      excluded.push({ id, reason: 'archived' });
      continue;
    }
    if (!['reviewed', 'stale'].includes(record.reviewStatus)) {
      excluded.push({ id, reason: `review-status:${record.reviewStatus ?? 'missing'}` });
      continue;
    }

    const staleByStatus = record.reviewStatus === 'stale';
    const staleByPolicy = !isFresh(record, now);
    if (staleByStatus || staleByPolicy) {
      targetRows.push(record);
      continue;
    }
    alreadyFresh.push(id);
  }

  targetRows.sort(targetOrder);
  alreadyFresh.sort((left, right) => left.localeCompare(right));
  excluded.sort((left, right) => left.id.localeCompare(right.id));

  const targetIds = targetRows.map((record) => String(record.id).trim());
  const targetSet = new Set(targetIds);
  for (const id of completedInput) {
    if (!targetSet.has(id)) {
      throw new Error(`completed id is not in the frozen revalidation target: ${id}`);
    }
  }

  const completedSet = new Set(completedInput);
  const completed = targetIds.filter((id) => completedSet.has(id));
  const pending = targetIds.filter((id) => !completedSet.has(id));

  return {
    target_ids: targetIds,
    already_fresh_ids: alreadyFresh,
    pending_ids: pending,
    completed_ids: completed,
    excluded_ids: excluded,
    waves: chunk(pending, size),
    complete: pending.length === 0,
  };
}
