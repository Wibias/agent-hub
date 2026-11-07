import { auditP28ProfileCandidateContract } from './p28-profile-candidate-contract.mjs';

/**
 * P30 is an opt-in, read-only, unconnected transport prototype for an
 * NOT-YET-DEPLOYED versioned projection. Never import into P11 routing.
 * A successful fetch is not live parity, pattern parity, or authorization.
 */
const PROJECTION = 'reference_graph_profile_runtime_projection_p30_v1';
const VERSION = 'reference-graph.profile-runtime.p30.v1';
const CANDIDATE_KEYS = Object.freeze([
  'asset_id', 'legacy_id', 'search_text', 'product', 'surface_family',
  'platform', 'page_role', 'motion', 'source_family', 'topology',
  'access_status', 'evidence_class', 'ordinary_or_failure_prone',
  'multi_state_flow', 'tags', 'primary_stratum',
]);
const ROW_KEYS = Object.freeze([
  ...CANDIDATE_KEYS, 'projection_version', 'snapshot_date', 'refreshed_at',
]);
const MAX_CANDIDATES = 5000;
const MAX_FRESHNESS_MS = 4 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 60 * 1000;
const HEX64 = /^[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class P30ProfileTransportError extends Error {
  constructor(category) {
    super('P30 profile transport failed: ' + category);
    this.name = 'P30ProfileTransportError';
    this.category = category;
  }
}

function reject(category) {
  throw new P30ProfileTransportError(category);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validTimestamp(value) {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function isPublishableKey(key) {
  if (typeof key !== 'string' || !key.trim()) return false;
  if (/^sb_publishable_[a-zA-Z0-9_-]+$/.test(key)) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && typeof payload === 'object'
      && !Array.isArray(payload) && payload.role === 'anon';
  } catch {
    return false;
  }
}

function requireInput({
  supabaseUrl,
  publishableKey,
  expectedDate,
  asOf,
  expectedCandidateCount,
  expectedCandidateIdSetSha256,
  fetchImpl,
  timeoutMs,
}) {
  if (typeof supabaseUrl !== 'string') reject('invalid-input');
  let base;
  try { base = new URL(supabaseUrl); } catch { reject('invalid-input'); }
  if (base.protocol !== 'https:'
    || base.username || base.password
    || base.pathname !== '/'
    || base.search || base.hash) reject('invalid-input');
  if (!isPublishableKey(publishableKey)) reject('unsafe-credential');
  if (!validDate(expectedDate) || !validTimestamp(asOf)
    || asOf.slice(0, 10) !== expectedDate) reject('invalid-input');
  if (!Number.isInteger(expectedCandidateCount)
    || expectedCandidateCount < 1 || expectedCandidateCount > MAX_CANDIDATES
    || !HEX64.test(expectedCandidateIdSetSha256)
    || typeof fetchImpl !== 'function'
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 1 || timeoutMs > 10000) reject('invalid-input');
  return base;
}

function normalizeRows(payload, { expectedDate, asOf, expectedCandidateCount, expectedCandidateIdSetSha256 }) {
  if (!Array.isArray(payload) || payload.length === 0
    || payload.length > MAX_CANDIDATES) reject('candidate-invalid');

  const expectedKeys = [...ROW_KEYS].sort();
  const candidates = [];
  let previousAsset = null;
  let firstRefreshedAt = null;
  for (const raw of payload) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(expectedKeys)) {
      reject('candidate-invalid');
    }
    if (raw.projection_version !== VERSION) reject('projection-version-mismatch');
    if (raw.snapshot_date !== expectedDate) reject('snapshot-invalid');
    if (!validTimestamp(raw.refreshed_at)) reject('snapshot-invalid');
    if (firstRefreshedAt !== null && raw.refreshed_at !== firstRefreshedAt) {
      reject('snapshot-invalid');
    }
    firstRefreshedAt = raw.refreshed_at;

    const { projection_version, snapshot_date, refreshed_at, ...candidate } = raw;
    if (typeof candidate.asset_id !== 'string'
      || (previousAsset !== null && candidate.asset_id <= previousAsset)) {
      reject('candidate-invalid');
    }
    previousAsset = candidate.asset_id;
    candidates.push(candidate);
  }

  const contract = auditP28ProfileCandidateContract({ candidates });
  if (!contract.metadata_contract_complete) reject('candidate-invalid');

  const age = Date.parse(asOf) - Date.parse(firstRefreshedAt);
  if (age < -FUTURE_SKEW_MS) reject('snapshot-invalid');
  if (age > MAX_FRESHNESS_MS) reject('snapshot-stale');
  if (payload.length !== expectedCandidateCount) reject('candidate-count-mismatch');
  if (contract.candidate_id_set_sha256 !== expectedCandidateIdSetSha256) {
    reject('fingerprint-mismatch');
  }

  return {
    candidates,
    transport: {
      schema_version: 'reference-graph.p30-profile-transport.v1',
      projection_version: VERSION,
      snapshot_date: expectedDate,
      refreshed_at: firstRefreshedAt,
      freshness_age_ms: Math.max(0, age),
      candidate_count: candidates.length,
      candidate_id_set_sha256: contract.candidate_id_set_sha256,
      live_graph_parity_verified: false,
      pattern_parity_verified: false,
      repository_default_graph_enabled: false,
      activation_performed: false,
    },
  };
}

/**
 * Explicit standalone transport. Pins MUST be supplied by a trusted source,
 * not copied from the response or generated by the caller from response rows.
 * The versioned P30 projection is not yet provisioned in Supabase.
 */
export async function fetchP30ProfileCandidateSnapshot({
  supabaseUrl,
  publishableKey,
  expectedDate,
  asOf,
  expectedCandidateCount,
  expectedCandidateIdSetSha256,
  fetchImpl = globalThis.fetch,
  timeoutMs = 1500,
} = {}) {
  const base = requireInput({
    supabaseUrl, publishableKey, expectedDate, asOf,
    expectedCandidateCount, expectedCandidateIdSetSha256,
    fetchImpl, timeoutMs,
  });
  const url = new URL('rest/v1/' + PROJECTION, base);
  url.searchParams.set('select', ROW_KEYS.join(','));
  url.searchParams.set('snapshot_date', 'eq.' + expectedDate);
  url.searchParams.set('order', 'asset_id.asc');

  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_resolve, failure) => {
    timer = setTimeout(() => {
      controller.abort();
      failure(new P30ProfileTransportError('timeout'));
    }, timeoutMs);
  });
  const attempt = (async () => {
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: { apikey: publishableKey },
        signal: controller.signal,
      });
    } catch {
      reject(controller.signal.aborted ? 'timeout' : 'network');
    }
    if (!response?.ok) reject('http');
    let payload;
    try {
      payload = await response.json();
    } catch {
      reject(controller.signal.aborted ? 'timeout' : 'invalid-json');
    }
    return normalizeRows(payload, {
      expectedDate, asOf, expectedCandidateCount, expectedCandidateIdSetSha256,
    });
  })();
  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
