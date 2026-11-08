import { P39_P38_ALERT_SCHEMA } from './p39-p38-monitor.mjs';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const POSTGREST_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/;
const CONTENT_RANGE = /^(\d+)-(\d+)\/(\d+)$/;
const EXPECTED_VERSION = 'reference-graph.profile-runtime.p30.v1';
const EXPECTED_COUNT = 275;
const WARN_AGE_MS = 2 * 60 * 60 * 1000 + 15 * 60 * 1000;
const CRITICAL_AGE_MS = 4 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 60 * 1000;
const STALE_SNAPSHOT_MS = 10 * 60 * 1000;

export const P39_P38_PUBLIC_HEALTH_SCHEMA = 'reference-graph.p39-p38-public-health.v1';

export class P39PublicHealthError extends Error {
  constructor(category) {
    super('P39 public P38 health failed: ' + category);
    this.name = 'P39PublicHealthError';
    this.category = category;
  }
}

function reject(category) {
  throw new P39PublicHealthError(category);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validInstant(value) {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function validDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizePostgrestInstant(value) {
  if (typeof value !== 'string' || !POSTGREST_UTC.test(value)) reject('snapshot-invalid');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())
    || parsed.toISOString().slice(0, 19) !== value.slice(0, 19)) reject('snapshot-invalid');
  return parsed.toISOString();
}

function isPublishableKey(key) {
  if (typeof key !== 'string' || !key.trim()) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      && payload.role === 'anon';
  } catch {
    return false;
  }
}

export async function collectP38PublicHealth({
  supabaseUrl,
  publishableKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 1500,
  now = new Date(),
} = {}) {
  if (typeof supabaseUrl !== 'string' || typeof fetchImpl !== 'function'
    || !(now instanceof Date) || Number.isNaN(now.valueOf())
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000
    || !isPublishableKey(publishableKey)) reject('invalid-input');
  let base;
  try { base = new URL(supabaseUrl); } catch { reject('invalid-input'); }
  if (base.protocol !== 'https:' || base.username || base.password
    || base.pathname !== '/' || base.search || base.hash) reject('invalid-input');

  const url = new URL('rest/v1/reference_graph_profile_public_p30_v1', base);
  url.searchParams.set('select', 'projection_version,snapshot_date,refreshed_at');
  url.searchParams.set('order', 'refreshed_at.asc');
  url.searchParams.set('limit', '1000');

  const controller = new AbortController();
  const key = publishableKey;
  let timer;
  const deadline = new Promise((_resolve, failure) => {
    timer = setTimeout(() => {
      controller.abort();
      failure(new P39PublicHealthError('timeout'));
    }, timeoutMs);
  });
  const started = performance.now();
  const attempt = (async () => {
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: { apikey: key, Prefer: 'count=exact' },
        signal: controller.signal,
      });
    } catch {
      reject(controller.signal.aborted ? 'timeout' : 'network');
    }
    if (controller.signal.aborted) reject('timeout');
    if (!response?.ok) reject('http');
    const contentRange = response?.headers?.get?.('content-range');
    const range = typeof contentRange === 'string' ? CONTENT_RANGE.exec(contentRange) : null;
    if (!range) reject('content-range-invalid');
    let rows;
    try { rows = await response.json(); } catch { reject('invalid-json'); }
    if (controller.signal.aborted) reject('timeout');
    if (!Array.isArray(rows) || rows.length === 0) reject('empty');
    const refreshed = [];
    const dates = [];
    const versions = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)
        || typeof row.projection_version !== 'string'
        || typeof row.snapshot_date !== 'string'
        || typeof row.refreshed_at !== 'string') reject('snapshot-invalid');
      versions.push(row.projection_version);
      dates.push(row.snapshot_date);
      refreshed.push(normalizePostgrestInstant(row.refreshed_at));
    }
    return {
      schema_version: P39_P38_PUBLIC_HEALTH_SCHEMA,
      observed_at: now.toISOString(),
      api: {
        visible_rows: rows.length,
        content_range_total: Number(range[3]),
        latency_ms: Number((performance.now() - started).toFixed(2)),
      },
      projection: {
        projection_version: [...new Set(versions)].length === 1 ? versions[0] : 'mixed',
        row_count: rows.length,
        snapshot_date: [...new Set(dates)].length === 1 ? dates[0] : 'mixed',
        refreshed_at: [...new Set(refreshed)].length === 1 ? refreshed[0] : null,
        distinct_refreshed_at: new Set(refreshed).size,
      },
    };
  })();
  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function message(code) {
  return {
    'public-count-mismatch': 'Public freshness view does not contain exactly 275 rows',
    'public-content-range-mismatch': 'Public Data API exact count is not 275',
    'public-version-mismatch': 'Public projection version is not the reviewed version',
    'public-refresh-mixed': 'Public freshness view contains mixed refresh instants',
    'public-snapshot-date-mismatch': 'Public projection date does not match the current UTC date',
    'public-snapshot-date-rollover': 'Public projection still has the previous UTC date during rollover grace',
    'public-refresh-future': 'Public projection refresh timestamp is in the future',
    'public-projection-stale-4h': 'Public projection is older than four hours',
    'public-projection-stale-2h15m': 'Public projection is older than 2h15m',
    'public-api-latency-over-budget': 'Public Data API latency exceeds 1500 ms',
    'public-snapshot-stale': 'Public monitor snapshot is older than ten minutes',
  }[code] || code;
}

function add(findings, code, severity) {
  if (!findings.some(item => item.code === code)) {
    findings.push({ code, severity, message: message(code) });
  }
}

export function evaluateP38PublicHealth(snapshot, { now = new Date(), expectedCount = EXPECTED_COUNT } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) reject('invalid-now');
  if (!exactKeys(snapshot, ['schema_version', 'observed_at', 'api', 'projection'])
    || snapshot.schema_version !== P39_P38_PUBLIC_HEALTH_SCHEMA
    || !validInstant(snapshot.observed_at)
    || !exactKeys(snapshot.api, ['visible_rows', 'content_range_total', 'latency_ms'])
    || !Number.isInteger(snapshot.api.visible_rows) || snapshot.api.visible_rows < 0
    || !Number.isInteger(snapshot.api.content_range_total) || snapshot.api.content_range_total < 0
    || typeof snapshot.api.latency_ms !== 'number' || !Number.isFinite(snapshot.api.latency_ms)
    || snapshot.api.latency_ms < 0
    || !exactKeys(snapshot.projection, [
      'projection_version', 'row_count', 'snapshot_date', 'refreshed_at',
      'distinct_refreshed_at',
    ])
    || !Number.isInteger(snapshot.projection.row_count) || snapshot.projection.row_count < 0
    || !Number.isInteger(snapshot.projection.distinct_refreshed_at)
    || snapshot.projection.distinct_refreshed_at < 0
    || typeof snapshot.projection.projection_version !== 'string'
    || typeof snapshot.projection.snapshot_date !== 'string'
    || (snapshot.projection.refreshed_at !== null && !validInstant(snapshot.projection.refreshed_at))) {
    reject('snapshot-shape');
  }
  const observedAt = Date.parse(snapshot.observed_at);
  const observed = new Date(observedAt);
  const findings = [];
  if (snapshot.projection.row_count !== expectedCount
    || snapshot.api.visible_rows !== expectedCount) {
    add(findings, 'public-count-mismatch', 'critical');
  }
  if (snapshot.api.content_range_total !== expectedCount) {
    add(findings, 'public-content-range-mismatch', 'critical');
  }
  if (snapshot.projection.projection_version !== EXPECTED_VERSION) {
    add(findings, 'public-version-mismatch', 'critical');
  }
  if (snapshot.projection.distinct_refreshed_at !== 1 || snapshot.projection.refreshed_at === null) {
    add(findings, 'public-refresh-mixed', 'critical');
  }
  const utcDate = snapshot.observed_at.slice(0, 10);
  if (!validDate(snapshot.projection.snapshot_date) || snapshot.projection.snapshot_date !== utcDate) {
    const minutesAfterMidnight = observed.getUTCHours() * 60 + observed.getUTCMinutes();
    add(findings, minutesAfterMidnight <= 10
      ? 'public-snapshot-date-rollover' : 'public-snapshot-date-mismatch',
    minutesAfterMidnight <= 10 ? 'warn' : 'critical');
  }
  if (snapshot.projection.refreshed_at !== null) {
    const age = observedAt - Date.parse(snapshot.projection.refreshed_at);
    if (age < -FUTURE_SKEW_MS) add(findings, 'public-refresh-future', 'critical');
    else if (age > CRITICAL_AGE_MS) add(findings, 'public-projection-stale-4h', 'critical');
    else if (age > WARN_AGE_MS) add(findings, 'public-projection-stale-2h15m', 'warn');
  }
  if (snapshot.api.latency_ms > 1500) add(findings, 'public-api-latency-over-budget', 'warn');
  if (now.valueOf() - observedAt > STALE_SNAPSHOT_MS || observedAt - now.valueOf() > FUTURE_SKEW_MS) {
    add(findings, 'public-snapshot-stale', 'critical');
  }
  const severity = findings.some(item => item.severity === 'critical')
    ? 'critical' : findings.length > 0 ? 'warn' : 'ok';
  return {
    schema_version: P39_P38_ALERT_SCHEMA,
    scope: 'public-freshness-only',
    observed_at: snapshot.observed_at,
    checked_at: now.toISOString(),
    severity,
    healthy: severity === 'ok',
    codes: findings.map(item => item.code),
    findings,
    source_hash_verified: false,
    cron_history_verified: false,
    auto_remediation: false,
    activation_performed: false,
  };
}

export function publicP38FailureReport(category, { now = new Date() } = {}) {
  const observedAt = now.toISOString();
  const code = 'public-api-' + String(category || 'unknown');
  return {
    schema_version: P39_P38_ALERT_SCHEMA,
    scope: 'public-freshness-only',
    observed_at: observedAt,
    checked_at: observedAt,
    severity: 'critical',
    healthy: false,
    codes: [code],
    findings: [{ code, severity: 'critical', message: 'Public P38 freshness probe failed' }],
    source_hash_verified: false,
    cron_history_verified: false,
    auto_remediation: false,
    activation_performed: false,
  };
}
