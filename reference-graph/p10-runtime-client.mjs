const RUNTIME_PROJECTION = 'reference_graph_quick_runtime_projection_p10';
const RUNTIME_TIMEOUT_MESSAGE = 'P10 runtime projection timed out';
const CANDIDATE_COLUMNS = [
  'asset_id',
  'legacy_id',
  'product',
  'surface_family',
  'platform',
  'page_role',
  'motion',
  'source_family',
  'topology',
  'access_status',
  'evidence_class',
  'ordinary_or_failure_prone',
  'multi_state_flow',
  'tags',
  'search_text',
  'snapshot_date',
  'refreshed_at',
];

export class P10RuntimeTransportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'P10RuntimeTransportError';
  }
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new P10RuntimeTransportError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function requireTimeout(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new P10RuntimeTransportError('timeoutMs must be a positive integer');
  }
  return value;
}

function requireReferenceDate(value) {
  const date = requireNonEmptyString(value, 'expectedDate');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new P10RuntimeTransportError('expectedDate must use YYYY-MM-DD');
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new P10RuntimeTransportError('expectedDate must be a valid calendar date');
  }
  return date;
}

function normalizeCandidate(raw, index, expectedDate) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new P10RuntimeTransportError(`candidate ${index} must be an object`);
  }
  const assetId = requireNonEmptyString(raw.asset_id, `candidate ${index}.asset_id`);
  const legacyId = requireNonEmptyString(raw.legacy_id, `candidate ${index}.legacy_id`);
  const snapshotDate = requireNonEmptyString(raw.snapshot_date, `candidate ${index}.snapshot_date`);
  const refreshedAt = requireNonEmptyString(raw.refreshed_at, `candidate ${index}.refreshed_at`);
  if (snapshotDate !== expectedDate) {
    throw new P10RuntimeTransportError(
      `candidate ${index}.snapshot_date does not match expected snapshot`,
    );
  }
  if (!Array.isArray(raw.tags)) {
    throw new P10RuntimeTransportError(`candidate ${index}.tags must be an array`);
  }
  return {
    ...raw,
    asset_id: assetId,
    legacy_id: legacyId,
    tags: [...raw.tags],
    snapshot_date: snapshotDate,
    refreshed_at: refreshedAt,
  };
}

function validateCandidates(payload, expectedDate) {
  if (!Array.isArray(payload)) {
    throw new P10RuntimeTransportError('P10 runtime projection payload must be an array');
  }
  if (payload.length === 0) {
    throw new P10RuntimeTransportError('P10 runtime projection has no current snapshot rows');
  }

  const assetIds = new Set();
  const legacyIds = new Set();
  return payload.map((raw, index) => {
    const row = normalizeCandidate(raw, index, expectedDate);
    if (assetIds.has(row.asset_id)) {
      throw new P10RuntimeTransportError(`duplicate P10 runtime asset id: ${row.asset_id}`);
    }
    if (legacyIds.has(row.legacy_id)) {
      throw new P10RuntimeTransportError(`duplicate P10 runtime legacy id: ${row.legacy_id}`);
    }
    assetIds.add(row.asset_id);
    legacyIds.add(row.legacy_id);
    return row;
  });
}

async function fetchProjectionAttempt({ url, key, fetchImpl, timeoutMs, referenceDate }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { apikey: key },
      signal: controller.signal,
    });

    if (!response?.ok) {
      throw new P10RuntimeTransportError(
        `P10 runtime projection failed with HTTP ${response?.status ?? 'unknown'}`,
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new P10RuntimeTransportError('P10 runtime projection returned invalid JSON');
    }

    return validateCandidates(payload, referenceDate);
  } catch (error) {
    if (error instanceof P10RuntimeTransportError) throw error;
    if (controller.signal.aborted) {
      throw new P10RuntimeTransportError(RUNTIME_TIMEOUT_MESSAGE);
    }
    throw new P10RuntimeTransportError('P10 runtime projection request failed');
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchP10QuickCandidatePool({
  supabaseUrl,
  publishableKey,
  fetchImpl = fetch,
  timeoutMs = 1500,
  expectedDate = new Date().toISOString().slice(0, 10),
} = {}) {
  const baseUrl = requireNonEmptyString(supabaseUrl, 'supabaseUrl').replace(/\/+$/, '');
  const key = requireNonEmptyString(publishableKey, 'publishableKey');
  const referenceDate = requireReferenceDate(expectedDate);
  requireTimeout(timeoutMs);
  if (typeof fetchImpl !== 'function') {
    throw new P10RuntimeTransportError('fetchImpl must be a function');
  }

  const url = new URL(`${baseUrl}/rest/v1/${RUNTIME_PROJECTION}`);
  url.searchParams.set('select', CANDIDATE_COLUMNS.join(','));
  url.searchParams.set('snapshot_date', `eq.${referenceDate}`);
  url.searchParams.set('order', 'asset_id.asc');

  const startedAt = performance.now();
  let candidates;

  try {
    candidates = await fetchProjectionAttempt({
      url,
      key,
      fetchImpl,
      timeoutMs,
      referenceDate,
    });
  } catch (error) {
    if (!(error instanceof P10RuntimeTransportError) || error.message !== RUNTIME_TIMEOUT_MESSAGE) {
      throw error;
    }
    candidates = await fetchProjectionAttempt({
      url,
      key,
      fetchImpl,
      timeoutMs,
      referenceDate,
    });
  }

  return {
    candidates,
    transport: {
      status: 'available',
      latency_ms: Math.max(0, performance.now() - startedAt),
      candidate_count: candidates.length,
      snapshot_date: referenceDate,
      refreshed_at: candidates[0].refreshed_at,
    },
  };
}
