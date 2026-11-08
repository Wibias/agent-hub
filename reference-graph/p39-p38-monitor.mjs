const HEX64 = /^[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SNAPSHOT_KEYS = [
  'schema_version', 'observed_at', 'job', 'last_run', 'last_success',
  'projection', 'source', 'api',
];
const WARN_AGE_MS = 2 * 60 * 60 * 1000 + 15 * 60 * 1000;
const CRITICAL_AGE_MS = 4 * 60 * 60 * 1000;
const STALE_SNAPSHOT_MS = 10 * 60 * 1000;
const FUTURE_SKEW_MS = 60 * 1000;
const REPEAT_WARN_MS = 60 * 60 * 1000;
const REPEAT_CRITICAL_MS = 30 * 60 * 1000;

export const P39_P38_HEALTH_SCHEMA = 'reference-graph.p39-p38-health.v1';
export const P39_P38_ALERT_SCHEMA = 'reference-graph.p39-p38-alert-plan.v1';
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
    || !Array.isArray(report.codes)) {
    reject('report-shape');
  }
  const alertKey = report.severity + ':' + report.codes.join(',');
  if (report.severity === 'ok') {
    return {
      schema_version: P39_P38_ALERT_SCHEMA,
      action: previous && previous.severity && previous.severity !== 'ok' ? 'resolve' : 'none',
      severity: 'ok',
      codes: [],
      alert_key: alertKey,
      auto_remediation: false,
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
  };
}
