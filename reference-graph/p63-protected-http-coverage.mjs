const SHA256 = /^[a-f0-9]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PERIOD_MS = 24 * 60 * 60 * 1000;
const SLOT_MS = 2 * 60 * 60 * 1000;
const EDGE_KEYS = [
  'window_utc', 'http_200', 'http_non_200', 'attempts',
];
const P61_KEYS = [
  'schema_version', 'project_ref', 'observed_at', 'completed_at',
  'source_witness_sha256', 'snapshot_date', 'refreshed_at',
  'candidate_count', 'http_get_requests', 'bounded_transport_elapsed_ms',
  'server_only_transport_verified', 'source_provenance_independently_attested',
  'twenty_four_hour_soak_complete', 'forty_eight_case_live_parity_attested',
  'production_rollback_rehearsed', 'activation_authorized',
  'repository_default_graph_enabled',
];

function reject() {
  throw new TypeError('P63 protected HTTP coverage BLOCKED');
}
function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function time(value) {
  return typeof value === 'string' && UTC.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}
function count(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
function validP61(p) {
  if (!exact(p, P61_KEYS)
    || p.schema_version !== 'reference-graph.p61-protected-readonly-observation.v1'
    || p.project_ref !== 'vrznfnxzlxaavpqbzbzd'
    || !time(p.observed_at) || !time(p.completed_at)
    || !time(p.refreshed_at)
    || p.snapshot_date !== p.observed_at.slice(0, 10)
    || !SHA256.test(p.source_witness_sha256)
    || !Number.isInteger(p.candidate_count)
    || p.candidate_count < 1 || p.candidate_count > 5000
    || !Number.isInteger(p.http_get_requests)
    || p.http_get_requests < 1 || p.http_get_requests > 10
    || !count(p.bounded_transport_elapsed_ms)
    || p.bounded_transport_elapsed_ms > 10000
    || p.server_only_transport_verified !== true
    || p.source_provenance_independently_attested !== false
    || p.twenty_four_hour_soak_complete !== false
    || p.forty_eight_case_live_parity_attested !== false
    || p.production_rollback_rehearsed !== false
    || p.activation_authorized !== false
    || p.repository_default_graph_enabled !== false) return false;

  const start = Date.parse(p.observed_at);
  const end = Date.parse(p.completed_at);
  return end >= start && end - start <= 10000
    && start - Date.parse(p.refreshed_at) <= 4 * 60 * 60 * 1000
    && Date.parse(p.refreshed_at) - start <= 60000;
}

/**
 * Offline reconciler of *supplied* aggregate HTTPS logs with independently
 * archived P61 reports. Synthesizes all 12 UTC two-hour slots, including
 * absent traffic. An HTTP 401 is never a successful privileged probe.
 *
 * This DOES NOT retrieve API logs or verify their source or completeness.
 * Absent independently signed, complete attempt journaling and trusted
 * gateway-log archive, even a claimed 12/12 result cannot authorize release.
 */
export function evaluateP63ProtectedCoverage({
  startedAt, endedAt, edgeRows, operatorObservations = [],
  asOf = new Date(),
} = {}) {
  if (!time(startedAt) || !time(endedAt)
    || !(asOf instanceof Date) || Number.isNaN(asOf.valueOf())
    || !Array.isArray(edgeRows) || !Array.isArray(operatorObservations)) reject();

  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (start % SLOT_MS !== 0 || end - start !== PERIOD_MS
    || end > asOf.valueOf() || edgeRows.length > 12
    || operatorObservations.length > 120) reject();

  const slots = Array.from({ length: 12 }, (_, i) => ({
    window_utc: new Date(start + i * SLOT_MS).toISOString(),
    http_200: 0,
    http_non_200: 0,
    attempts: 0,
    p61_validated_observations: 0,
  }));
  const indexed = new Map(slots.map((slot, i) => [slot.window_utc, i]));
  const seen = new Set();
  for (const item of edgeRows) {
    if (!exact(item, EDGE_KEYS) || !time(item.window_utc)
      || !count(item.http_200) || !count(item.http_non_200)
      || !count(item.attempts)
      || item.attempts !== item.http_200 + item.http_non_200
      || !indexed.has(item.window_utc) || seen.has(item.window_utc)) reject();
    seen.add(item.window_utc);
    const slot = slots[indexed.get(item.window_utc)];
    slot.http_200 = item.http_200;
    slot.http_non_200 = item.http_non_200;
    slot.attempts = item.attempts;
  }

  for (const item of operatorObservations) {
    if (!validP61(item)) reject();
    const started = Date.parse(item.observed_at);
    const completed = Date.parse(item.completed_at);
    if (started < start || completed >= end) reject();
    const index = Math.floor((started - start) / SLOT_MS);
    if (completed >= start + (index + 1) * SLOT_MS) reject();
    slots[index].p61_validated_observations++;
  }

  const slotsWithHttp200 = slots.filter(s => s.http_200 > 0).length;
  const slotsWithP61 = slots.filter(s => s.p61_validated_observations > 0).length;
  const slotsWithoutProtectedHttp200 = slots
    .filter(s => s.http_200 === 0).map(s => s.window_utc);
  const slotsWithoutP61 = slots
    .filter(s => s.p61_validated_observations === 0).map(s => s.window_utc);

  return {
    schema_version: 'reference-graph.p63-protected-http-coverage.v1',
    project_ref: 'vrznfnxzlxaavpqbzbzd',
    window_start_utc: startedAt,
    window_end_utc: endedAt,
    two_hour_windows_expected: 12,
    windows_with_protected_http_200: slotsWithHttp200,
    windows_with_p61_validated_observations: slotsWithP61,
    total_protected_http_200: slots.reduce((sum, s) => sum + s.http_200, 0),
    total_protected_non_200: slots.reduce((sum, s) => sum + s.http_non_200, 0),
    windows_without_protected_http_200: slotsWithoutProtectedHttp200,
    windows_without_p61_validated_observation: slotsWithoutP61,
    operator_claimed_full_window_coverage: slotsWithHttp200 === 12 && slotsWithP61 === 12,
    edge_logs_independently_authenticated: false,
    complete_attempt_journal_verified: false,
    p61_source_provenance_independently_attested: false,
    sustained_privileged_data_api_soak_verified: false,
    activation_authorized: false,
    repository_default_graph_enabled: false,
  };
}
