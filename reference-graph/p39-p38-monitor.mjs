const HEX64 = /^[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SNAPSHOT_KEYS = [
  'schema_version', 'observed_at', 'job', 'last_run', 'last_success',
  'cycles', 'projection', 'source', 'api',
];
const WARN_AGE_MS = 2 * 60 * 60 * 1000 + 15 * 60 * 1000;
const CRITICAL_AGE_MS = 4 * 60 * 60 * 1000;
const STALE_SNAPSHOT_MS = 10 * 60 * 1000;
const FUTURE_SKEW_MS = 60 * 1000;
const REPEAT_WARN_MS = 60 * 60 * 1000;
const REPEAT_CRITICAL_MS = 30 * 60 * 1000;
const HEALTHY_PROBE_SEPARATION_MS = 5 * 60 * 1000;
const SOAK_CYCLE_MS = 2 * 60 * 60 * 1000;
const SOAK_WINDOW_MS = 24 * 60 * 60 * 1000;
const SOAK_MAX_GAP_MS = WARN_AGE_MS;

export const P39_P38_HEALTH_SCHEMA = 'reference-graph.p39-p38-health.v2';
export const P39_P38_ALERT_SCHEMA = 'reference-graph.p39-p38-alert-plan.v2';
export const P39_P38_STATE_SCHEMA = 'reference-graph.p39-p38-alert-state.v2';
export const P39_P38_SOAK = Object.freeze({
  required_cycles: 12,
  cycle_ms: SOAK_CYCLE_MS,
  window_ms: SOAK_WINDOW_MS,
  max_gap_ms: SOAK_MAX_GAP_MS,
});
export const P39_P38_SCHEDULE = '0,5 */2 * * *';
export const P39_P38_COMMAND =
  'select public.reference_graph_refresh_profile_runtime_projection_p31();';

export class P39P38MonitorError extends Error {
  constructor(category) {
    super('P39 P38 monitor rejected: ' + category);
    this.name = 'P39P38MonitorError';
    this.category = category;
  }
}

function reject(category) {
  throw new P39P38MonitorError(category);
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

function requireInteger(value, name, min = 0) {
  if (!Number.isInteger(value) || value < min) reject('invalid-' + name);
  return value;
}

function validateSnapshot(value) {
  if (!exactKeys(value, SNAPSHOT_KEYS) || value.schema_version !== P39_P38_HEALTH_SCHEMA) {
    reject('snapshot-shape');
  }
  if (!validInstant(value.observed_at)) reject('observed-at');
  if (!exactKeys(value.job, ['present', 'active', 'schedule', 'command'])
    || typeof value.job.present !== 'boolean'
    || typeof value.job.active !== 'boolean'
    || typeof value.job.schedule !== 'string'
    || typeof value.job.command !== 'string') {
    reject('job-shape');
  }
  if (value.last_run !== null) {
    if (!exactKeys(value.last_run, ['status', 'start_time', 'end_time'])
      || !['succeeded', 'failed'].includes(value.last_run.status)
      || !validInstant(value.last_run.start_time)
      || (value.last_run.end_time !== null && !validInstant(value.last_run.end_time))) {
      reject('last-run-shape');
    }
  }
  if (value.last_success !== null
    && (!exactKeys(value.last_success, ['start_time'])
      || !validInstant(value.last_success.start_time))) {
    reject('last-success-shape');
  }
  if (!exactKeys(value.cycles, ['consecutive_failed', 'last_cycle_start', 'last_cycle_status'])
    || !Number.isInteger(value.cycles.consecutive_failed)
    || value.cycles.consecutive_failed < 0
    || !['succeeded', 'failed', 'unknown'].includes(value.cycles.last_cycle_status)
    || (value.cycles.last_cycle_start !== null && !validInstant(value.cycles.last_cycle_start))) {
    reject('cycles-shape');
  }
  if (!exactKeys(value.projection, [
    'row_count', 'snapshot_date', 'refreshed_at', 'distinct_refreshed_at',
    'candidate_id_set_sha256',
  ])
    || !validDate(value.projection.snapshot_date)
    || !validInstant(value.projection.refreshed_at)
    || typeof value.projection.candidate_id_set_sha256 !== 'string'
    || !HEX64.test(value.projection.candidate_id_set_sha256)) {
    reject('projection-shape');
  }
  requireInteger(value.projection.row_count, 'projection-row-count');
  requireInteger(value.projection.distinct_refreshed_at, 'projection-refresh-count', 1);
  if (!exactKeys(value.source, ['row_count', 'candidate_id_set_sha256'])
    || !Number.isInteger(value.source.row_count) || value.source.row_count < 0
    || typeof value.source.candidate_id_set_sha256 !== 'string'
    || !HEX64.test(value.source.candidate_id_set_sha256)) {
    reject('source-shape');
  }
  if (!exactKeys(value.api, ['visible_rows', 'content_range_total', 'latency_ms'])
    || !Number.isInteger(value.api.visible_rows) || value.api.visible_rows < 0
    || !Number.isInteger(value.api.content_range_total) || value.api.content_range_total < 0
    || typeof value.api.latency_ms !== 'number' || !Number.isFinite(value.api.latency_ms)
    || value.api.latency_ms < 0) {
    reject('api-shape');
  }
  return value;
}

function message(code) {
  return {
    'job-missing': 'P38 cron job is missing',
    'job-inactive': 'P38 cron job is inactive',
    'schedule-mismatch': 'P38 cron schedule differs from the reviewed schedule',
    'command-mismatch': 'P38 cron command differs from the reviewed command',
    'no-run-observed': 'P38 has no recorded cron run',
    'last-run-failed': 'P38 last cron run failed',
    'failed-cycle': 'P38 has one failed two-hour cycle',
    'two-failed-cycles': 'P38 has two or more consecutive failed cycles',
    'no-successful-run': 'P38 has no successful cron run',
    'no-success-4h': 'P38 has no success within four hours',
    'no-success-2h15m': 'P38 has no success within 2h15m',
    'projection-empty': 'P31 projection is empty',
    'snapshot-date-mismatch': 'P31 projection date does not match the current UTC date',
    'snapshot-date-rollover': 'P31 projection date is still the previous UTC date during rollover grace',
    'projection-mixed-refresh': 'P31 projection contains mixed refresh instants',
    'refresh-future': 'P31 projection refresh timestamp is in the future',
    'projection-stale-4h': 'P31 projection is older than four hours',
    'projection-stale-2h15m': 'P31 projection is older than 2h15m',
    'source-count-mismatch': 'P31 projection count differs from the P7 source',
    'membership-hash-mismatch': 'P31 projection membership hash differs from the P7 source',
    'api-visible-count-mismatch': 'Data API visible row count differs from the projection',
    'api-content-range-mismatch': 'Data API exact count differs from the projection',
    'api-latency-over-budget': 'Data API p95 latency exceeds the 1500 ms budget',
    'snapshot-stale': 'P38 health snapshot is older than ten minutes',
  }[code] || code;
}

function add(list, code, severity) {
  if (!list.some(item => item.code === code)) list.push({ code, severity, message: message(code) });
}

export function evaluateP38Health(snapshot, { now = new Date() } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) reject('invalid-now');
  const value = validateSnapshot(snapshot);
  const observedAt = Date.parse(value.observed_at);
  const nowMs = now.valueOf();
  const findings = [];
  const observed = new Date(observedAt);

  if (!value.job.present) add(findings, 'job-missing', 'critical');
  if (!value.job.active) add(findings, 'job-inactive', 'critical');
  if (value.job.schedule !== P39_P38_SCHEDULE) add(findings, 'schedule-mismatch', 'critical');
  if (value.job.command.trim() !== P39_P38_COMMAND) add(findings, 'command-mismatch', 'critical');

  if (value.last_run === null) {
    add(findings, 'no-run-observed', 'warn');
  } else if (value.last_run.status !== 'succeeded') {
    add(findings, 'last-run-failed', 'warn');
  }

  if (value.cycles.consecutive_failed >= 2) {
    add(findings, 'two-failed-cycles', 'critical');
  } else if (value.cycles.consecutive_failed === 1
    || value.cycles.last_cycle_status === 'failed') {
    add(findings, 'failed-cycle', 'warn');
  }

  if (value.last_success === null) {
    add(findings, 'no-successful-run', 'critical');
  } else {
    const successAge = observedAt - Date.parse(value.last_success.start_time);
    if (successAge > CRITICAL_AGE_MS) add(findings, 'no-success-4h', 'critical');
    else if (successAge > WARN_AGE_MS) add(findings, 'no-success-2h15m', 'warn');
  }

  if (value.projection.row_count < 1) add(findings, 'projection-empty', 'critical');
  const utcDate = value.observed_at.slice(0, 10);
  if (value.projection.snapshot_date !== utcDate) {
    const minutesAfterMidnight = observed.getUTCHours() * 60 + observed.getUTCMinutes();
    add(findings, minutesAfterMidnight <= 10 ? 'snapshot-date-rollover' : 'snapshot-date-mismatch',
      minutesAfterMidnight <= 10 ? 'warn' : 'critical');
  }
  if (value.projection.distinct_refreshed_at !== 1) {
    add(findings, 'projection-mixed-refresh', 'critical');
  }

  const refreshAge = observedAt - Date.parse(value.projection.refreshed_at);
  if (refreshAge < -FUTURE_SKEW_MS) add(findings, 'refresh-future', 'critical');
  else if (refreshAge > CRITICAL_AGE_MS) add(findings, 'projection-stale-4h', 'critical');
  else if (refreshAge > WARN_AGE_MS) add(findings, 'projection-stale-2h15m', 'warn');

  if (value.projection.row_count !== value.source.row_count) {
    add(findings, 'source-count-mismatch', 'critical');
  }
  if (value.projection.candidate_id_set_sha256 !== value.source.candidate_id_set_sha256) {
    add(findings, 'membership-hash-mismatch', 'critical');
  }
  if (value.api.visible_rows !== value.projection.row_count) {
    add(findings, 'api-visible-count-mismatch', 'critical');
  }
  if (value.api.content_range_total !== value.projection.row_count) {
    add(findings, 'api-content-range-mismatch', 'critical');
  }
  if (value.api.latency_ms > 1500) add(findings, 'api-latency-over-budget', 'warn');
  if (nowMs - observedAt > STALE_SNAPSHOT_MS || observedAt - nowMs > FUTURE_SKEW_MS) {
    add(findings, 'snapshot-stale', 'critical');
  }

  const severity = findings.some(item => item.severity === 'critical')
    ? 'critical'
    : findings.length > 0 ? 'warn' : 'ok';
  return {
    schema_version: P39_P38_ALERT_SCHEMA,
    observed_at: value.observed_at,
    checked_at: now.toISOString(),
    severity,
    healthy: severity === 'ok',
    codes: findings.map(item => item.code),
    findings,
    auto_remediation: false,
    activation_performed: false,
  };
}

export function planP38Alerts(previous, report, { now = new Date() } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) reject('invalid-now');
  if (!report || report.schema_version !== P39_P38_ALERT_SCHEMA
    || !['ok', 'warn', 'critical'].includes(report.severity)
    || !Array.isArray(report.codes) || !validInstant(report.observed_at)) {
    reject('report-shape');
  }
  const alertKey = report.severity + ':' + report.codes.join(',');
  if (report.severity === 'ok') {
    const previousSeverity = previous?.severity ?? 'ok';
    const wasActive = previousSeverity !== 'ok';
    const previousCount = Number.isInteger(previous?.healthy_probe_count)
      ? Math.max(0, previous.healthy_probe_count) : 0;
    const previousHealthyAt = previous?.last_healthy_at && validInstant(previous.last_healthy_at)
      ? Date.parse(previous.last_healthy_at) : null;
    const observedMs = Date.parse(report.observed_at);
    const separated = previousHealthyAt === null
      || observedMs - previousHealthyAt >= HEALTHY_PROBE_SEPARATION_MS;
    const count = separated ? Math.min(2, previousCount + 1) : Math.max(1, previousCount);
    const resolved = wasActive && count >= 2;
    const active = wasActive && !resolved;
    return {
      schema_version: P39_P38_ALERT_SCHEMA,
      action: resolved ? 'resolve' : 'none',
      severity: active ? previousSeverity : 'ok',
      codes: active ? previous.codes ?? [] : [],
      alert_key: active ? previous.alert_key ?? alertKey : 'ok:',
      healthy_probe_count: count,
      auto_remediation: false,
      next_state: {
        schema_version: P39_P38_STATE_SCHEMA,
        severity: active ? previousSeverity : 'ok',
        alert_key: active ? previous.alert_key ?? alertKey : 'ok:',
        last_alert_at: active ? previous.last_alert_at ?? null : null,
        healthy_probe_count: resolved ? 2 : count,
        last_healthy_at: separated ? report.observed_at : previousHealthyAt
          ? new Date(previousHealthyAt).toISOString() : report.observed_at,
        observed_at: report.observed_at,
      },
    };
  }
  const lastAlertAt = previous?.last_alert_at && validInstant(previous.last_alert_at)
    ? Date.parse(previous.last_alert_at) : null;
  const repeatMs = report.severity === 'critical' ? REPEAT_CRITICAL_MS : REPEAT_WARN_MS;
  const same = previous?.alert_key === alertKey;
  const due = lastAlertAt === null || now.valueOf() - lastAlertAt >= repeatMs;
  return {
    schema_version: P39_P38_ALERT_SCHEMA,
    action: same && !due ? 'suppress' : 'page',
    severity: report.severity,
    codes: report.codes,
    alert_key: alertKey,
    repeat_after_ms: repeatMs,
    auto_remediation: false,
    next_state: {
      schema_version: P39_P38_STATE_SCHEMA,
      severity: report.severity,
      alert_key: alertKey,
      last_alert_at: same && !due
        ? previous?.last_alert_at ?? null : report.observed_at,
      healthy_probe_count: 0,
      last_healthy_at: null,
      observed_at: report.observed_at,
    },
  };
}

export function evaluateP38Soak(cycles) {
  if (!Array.isArray(cycles) || cycles.length < P39_P38_SOAK.required_cycles) {
    return {
      schema_version: 'reference-graph.p39-p38-soak.v1',
      eligible: false,
      required_cycles: P39_P38_SOAK.required_cycles,
      observed_cycles: Array.isArray(cycles) ? cycles.length : 0,
      blockers: ['insufficient-cycles'],
      activation_performed: false,
    };
  }
  const normalized = [];
  for (const [index, cycle] of cycles.entries()) {
    if (!exactKeys(cycle, ['cycle_start', 'invocations', 'succeeded'])
      || !validInstant(cycle.cycle_start)
      || !Number.isInteger(cycle.invocations) || cycle.invocations < 0
      || !Number.isInteger(cycle.succeeded)
      || cycle.succeeded < 0 || cycle.succeeded > cycle.invocations) {
      reject('cycle-shape-' + index);
    }
    normalized.push({ ...cycle, start: Date.parse(cycle.cycle_start) });
  }
  normalized.sort((a, b) => a.start - b.start);
  const windowCycles = normalized.slice(-P39_P38_SOAK.required_cycles);
  const blockers = [];
  if (new Set(windowCycles.map(cycle => cycle.cycle_start)).size !== windowCycles.length) {
    blockers.push('duplicate-cycle');
  }
  // Twelve cycles cover 24h when the final cycle's two-hour window is included.
  const span = windowCycles.at(-1).start + SOAK_CYCLE_MS - windowCycles[0].start;
  if (span < P39_P38_SOAK.window_ms) blockers.push('insufficient-window');
  let maxGap = 0;
  for (let i = 1; i < windowCycles.length; i++) {
    maxGap = Math.max(maxGap, windowCycles[i].start - windowCycles[i - 1].start);
  }
  if (maxGap > P39_P38_SOAK.max_gap_ms) blockers.push('cycle-gap');
  for (const cycle of windowCycles) {
    if (cycle.invocations < 2) blockers.push('insufficient-invocations');
    if (cycle.succeeded < 1) blockers.push('failed-cycle');
  }
  const uniqueBlockers = [...new Set(blockers)];
  return {
    schema_version: 'reference-graph.p39-p38-soak.v1',
    eligible: uniqueBlockers.length === 0,
    required_cycles: P39_P38_SOAK.required_cycles,
    observed_cycles: windowCycles.length,
    healthy_cycles: windowCycles.filter(cycle => cycle.succeeded >= 1
      && cycle.invocations >= 2).length,
    span_hours: Number((span / 3600000).toFixed(3)),
    max_gap_minutes: Number((maxGap / 60000).toFixed(3)),
    blockers: uniqueBlockers,
    activation_performed: false,
  };
}
