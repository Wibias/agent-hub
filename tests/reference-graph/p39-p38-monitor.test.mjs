import assert from 'node:assert/strict';
import test from 'node:test';

import {
  P39_P38_ALERT_SCHEMA,
  P39_P38_COMMAND,
  P39_P38_HEALTH_SCHEMA,
  P39_P38_SCHEDULE,
  P39P38MonitorError,
  evaluateP38Health,
  planP38Alerts,
} from '../../reference-graph/p39-p38-monitor.mjs';

const hash = 'b3037425ff08c7822f695ce28c6e5fb1dbd3e245255ab33a614e96995cf2a6a2';
const observed = '2026-11-08T00:10:00.000Z';
const refreshed = '2026-11-08T00:05:00.095Z';

function snapshot(overrides = {}) {
  return {
    schema_version: P39_P38_HEALTH_SCHEMA,
    observed_at: observed,
    job: {
      present: true,
      active: true,
      schedule: P39_P38_SCHEDULE,
      command: P39_P38_COMMAND,
    },
    last_run: {
      status: 'succeeded',
      start_time: '2026-11-08T00:05:00.090Z',
      end_time: '2026-11-08T00:05:00.221Z',
    },
    last_success: { start_time: '2026-11-08T00:05:00.090Z' },
    projection: {
      row_count: 275,
      snapshot_date: '2026-11-08',
      refreshed_at: refreshed,
      distinct_refreshed_at: 1,
      candidate_id_set_sha256: hash,
    },
    source: { row_count: 275, candidate_id_set_sha256: hash },
    api: { visible_rows: 275, content_range_total: 275, latency_ms: 180 },
    ...overrides,
  };
}

function evaluate(value, now = observed) {
  return evaluateP38Health(value, { now: new Date(now) });
}

test('P39 P38 healthy snapshot is green and non-authorizing', () => {
  const report = evaluate(snapshot());
  assert.equal(report.schema_version, P39_P38_ALERT_SCHEMA);
  assert.equal(report.severity, 'ok');
  assert.equal(report.healthy, true);
  assert.deepEqual(report.codes, []);
  assert.equal(report.auto_remediation, false);
  assert.equal(report.activation_performed, false);
});

test('P39 P38 warns on one failed run, no recent success, stale refresh or latency', async () => {
  const failed = evaluate(snapshot({
    last_run: {
      status: 'failed',
      start_time: '2026-11-08T00:05:00.090Z',
      end_time: '2026-11-08T00:05:00.200Z',
    },
  }));
  assert.equal(failed.severity, 'warn');
  assert.ok(failed.codes.includes('last-run-failed'));

  const stale = evaluate(snapshot({
    observed_at: '2026-11-08T02:30:00.000Z',
    projection: {
      ...snapshot().projection,
      refreshed_at: '2026-11-08T00:10:00.000Z',
    },
    last_success: { start_time: '2026-11-08T00:10:00.000Z' },
  }), '2026-11-08T02:30:00.000Z');
  assert.equal(stale.severity, 'warn');
  assert.ok(stale.codes.includes('projection-stale-2h15m'));
  assert.ok(stale.codes.includes('no-success-2h15m'));

  const latency = evaluate(snapshot({
    api: { ...snapshot().api, latency_ms: 1600 },
  }));
  assert.equal(latency.severity, 'warn');
  assert.ok(latency.codes.includes('api-latency-over-budget'));
});

test('P39 P38 escalates missing/inactive job and stale/count/hash/API failures to critical', async () => {
  const cases = [
    snapshot({ job: { ...snapshot().job, present: false } }),
    snapshot({ job: { ...snapshot().job, active: false } }),
    snapshot({ job: { ...snapshot().job, schedule: '0 0 * * *' } }),
    snapshot({ job: { ...snapshot().job, command: 'select 1;' } }),
    snapshot({ projection: { ...snapshot().projection, row_count: 0 } }),
    snapshot({ projection: { ...snapshot().projection, distinct_refreshed_at: 2 } }),
    snapshot({ source: { ...snapshot().source, row_count: 274 } }),
    snapshot({ source: { ...snapshot().source, candidate_id_set_sha256: '0'.repeat(64) } }),
    snapshot({ api: { ...snapshot().api, visible_rows: 0 } }),
    snapshot({ api: { ...snapshot().api, content_range_total: 274 } }),
  ];
  for (const value of cases) {
    const report = evaluate(value);
    assert.equal(report.severity, 'critical', JSON.stringify(report.findings));
  }
});

test('P39 P38 detects UTC date mismatch and rollover grace', async () => {
  const rollover = evaluate(snapshot({
    observed_at: '2026-11-08T00:05:00.000Z',
    projection: { ...snapshot().projection, snapshot_date: '2026-11-07' },
  }), '2026-11-08T00:05:00.000Z');
  assert.equal(rollover.severity, 'warn');
  assert.ok(rollover.codes.includes('snapshot-date-rollover'));

  const mismatch = evaluate(snapshot({
    observed_at: '2026-11-08T00:11:00.000Z',
    projection: { ...snapshot().projection, snapshot_date: '2026-11-07' },
  }), '2026-11-08T00:11:00.000Z');
  assert.equal(mismatch.severity, 'critical');
  assert.ok(mismatch.codes.includes('snapshot-date-mismatch'));
});

test('P39 P38 rejects stale monitoring snapshots and malformed data', async () => {
  const stale = evaluateP38Health(snapshot(), { now: new Date('2026-11-08T00:25:00.000Z') });
  assert.equal(stale.severity, 'critical');
  assert.ok(stale.codes.includes('snapshot-stale'));

  for (const invalid of [
    { ...snapshot(), unexpected: true },
    { ...snapshot(), observed_at: '2026-11-08T00:10:00Z' },
    { ...snapshot(), projection: { ...snapshot().projection, candidate_id_set_sha256: 'bad' } },
    { ...snapshot(), api: { ...snapshot().api, latency_ms: -1 } },
  ]) {
    assert.throws(() => evaluateP38Health(invalid, { now: new Date(observed) }), P39P38MonitorError);
  }
});

test('P39 P38 alert planning deduplicates, re-alerts, resolves and never auto-remediates', () => {
  const warn = evaluate(snapshot({ last_run: {
    status: 'failed', start_time: '2026-11-08T00:05:00.090Z', end_time: null,
  } }));
  const page = planP38Alerts(null, warn, { now: new Date(observed) });
  assert.equal(page.action, 'page');
  assert.equal(page.severity, 'warn');
  assert.equal(page.auto_remediation, false);

  const suppress = planP38Alerts({
    severity: 'warn', alert_key: page.alert_key, last_alert_at: observed,
  }, warn, { now: new Date('2026-11-08T00:20:00.000Z') });
  assert.equal(suppress.action, 'suppress');

  const repeat = planP38Alerts({
    severity: 'warn', alert_key: page.alert_key, last_alert_at: observed,
  }, warn, { now: new Date('2026-11-08T01:11:00.000Z') });
  assert.equal(repeat.action, 'page');

  const healthy = evaluate(snapshot());
  const resolved = planP38Alerts({
    severity: 'warn', alert_key: page.alert_key, last_alert_at: observed,
  }, healthy, { now: new Date(observed) });
  assert.equal(resolved.action, 'resolve');
  assert.equal(planP38Alerts({ severity: 'ok', alert_key: 'ok:' }, healthy).action, 'none');
});
