const RUNTIME_RPC = 'reference_graph_quick_candidate_pool_runtime_p9';

export class P9RuntimeTransportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'P9RuntimeTransportError';
  }
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new P9RuntimeTransportError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function requireTimeout(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new P9RuntimeTransportError('timeoutMs must be a positive integer');
  }
  return value;
}

function normalizeCandidate(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new P9RuntimeTransportError(`candidate ${index} must be an object`);
  }
  const assetId = requireNonEmptyString(raw.asset_id, `candidate ${index}.asset_id`);
  const legacyId = requireNonEmptyString(raw.legacy_id, `candidate ${index}.legacy_id`);
  if (!Array.isArray(raw.tags)) {
    throw new P9RuntimeTransportError(`candidate ${index}.tags must be an array`);
  }
  return {
    ...raw,
    asset_id: assetId,
    legacy_id: legacyId,
    tags: [...raw.tags],
  };
}

function validateCandidates(payload) {
  if (!Array.isArray(payload)) {
    throw new P9RuntimeTransportError('P9 runtime RPC payload must be an array');
  }

  const assetIds = new Set();
  const legacyIds = new Set();
  return payload.map((raw, index) => {
    const row = normalizeCandidate(raw, index);
    if (assetIds.has(row.asset_id)) {
      throw new P9RuntimeTransportError(`duplicate P9 runtime asset id: ${row.asset_id}`);
    }
    if (legacyIds.has(row.legacy_id)) {
      throw new P9RuntimeTransportError(`duplicate P9 runtime legacy id: ${row.legacy_id}`);
    }
    assetIds.add(row.asset_id);
    legacyIds.add(row.legacy_id);
    return row;
  });
}

export async function fetchP9QuickCandidatePool({
  supabaseUrl,
  publishableKey,
  fetchImpl = fetch,
  timeoutMs = 1500,
} = {}) {
  const baseUrl = requireNonEmptyString(supabaseUrl, 'supabaseUrl').replace(/\/+$/, '');
  const key = requireNonEmptyString(publishableKey, 'publishableKey');
  requireTimeout(timeoutMs);
  if (typeof fetchImpl !== 'function') {
    throw new P9RuntimeTransportError('fetchImpl must be a function');
  }

  const controller = new AbortController();
  const startedAt = performance.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(
      `${baseUrl}/rest/v1/rpc/${RUNTIME_RPC}`,
      {
        method: 'POST',
        headers: {
          apikey: key,
          'content-type': 'application/json',
        },
        body: '{}',
        signal: controller.signal,
      },
    );

    if (!response?.ok) {
      throw new P9RuntimeTransportError(
        `P9 runtime RPC failed with HTTP ${response?.status ?? 'unknown'}`,
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new P9RuntimeTransportError('P9 runtime RPC returned invalid JSON');
    }

    const candidates = validateCandidates(payload);
    return {
      candidates,
      transport: {
        status: 'available',
        latency_ms: Math.max(0, performance.now() - startedAt),
        candidate_count: candidates.length,
      },
    };
  } catch (error) {
    if (error instanceof P9RuntimeTransportError) throw error;
    if (controller.signal.aborted) {
      throw new P9RuntimeTransportError('P9 runtime RPC timed out');
    }
    throw new P9RuntimeTransportError('P9 runtime RPC request failed');
  } finally {
    clearTimeout(timeout);
  }
}
