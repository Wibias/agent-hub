import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  P39_P38_ALERT_SCHEMA,
  P39_P38_COMMAND,
  P39_P38_HEALTH_SCHEMA,
  P39_P38_SCHEDULE,
  P39_P38_SOAK,
  P39P38MonitorError,
  evaluateP38Health,
  evaluateP38Soak,
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
    cycles: {
      consecutive_failed: 0,
      last_cycle_start: '2026-11-08T00:00:00.000Z',
      last_cycle_status: 'succeeded',
    },
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

  const failedCycle = evaluate(snapshot({
    cycles: { ...snapshot().cycles, consecutive_failed: 1, last_cycle_status: 'failed' },
  }));
  assert.equal(failedCycle.severity, 'warn');
  assert.ok(failedCycle.codes.includes('failed-cycle'));

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
    snapshot({ cycles: { ...snapshot().cycles, consecutive_failed: 2 } }),
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
    { ...snapshot(), cycles: { ...snapshot().cycles, consecutive_failed: -1 } },
  ]) {
    assert.throws(() => evaluateP38Health(invalid, { now: new Date(observed) }), P39P38MonitorError);
  }
});

test('P39 P38 alert planning deduplicates, re-alerts and never auto-remediates', () => {
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
});

test('P39 P38 resolves only after two independent healthy probes', () => {
  const warn = evaluate(snapshot({ cycles: {
    ...snapshot().cycles, consecutive_failed: 1, last_cycle_status: 'failed',
  } }));
  const page = planP38Alerts(null, warn, { now: new Date(observed) });
  const firstHealthy = evaluate(snapshot({ observed_at: '2026-11-08T00:16:00.000Z' }),
    '2026-11-08T00:16:00.000Z');
  const first = planP38Alerts({
    severity: 'warn',
    alert_key: page.alert_key,
    last_alert_at: observed,
  }, firstHealthy, { now: new Date('2026-11-08T00:16:00.000Z') });
  assert.equal(first.action, 'none');
  assert.equal(first.next_state.severity, 'warn');
  assert.equal(first.next_state.healthy_probe_count, 1);

  const tooSoon = planP38Alerts(first.next_state, evaluate(snapshot({
    observed_at: '2026-11-08T00:18:00.000Z',
  }), '2026-11-08T00:18:00.000Z'), { now: new Date('2026-11-08T00:18:00.000Z') });
  assert.equal(tooSoon.action, 'none');
  assert.equal(tooSoon.next_state.healthy_probe_count, 1);

  const second = planP38Alerts(first.next_state, evaluate(snapshot({
    observed_at: '2026-11-08T00:22:00.000Z',
  }), '2026-11-08T00:22:00.000Z'), { now: new Date('2026-11-08T00:22:00.000Z') });
  assert.equal(second.action, 'resolve');
  assert.equal(second.next_state.severity, 'ok');
  assert.equal(second.next_state.healthy_probe_count, 2);
});

test('P39 P38 soak requires 12 two-hour cycles, 24 hours and two invocations per cycle', () => {
  const cycles = Array.from({ length: P39_P38_SOAK.required_cycles }, (_, index) => ({
    cycle_start: new Date(Date.parse('2026-11-08T00:00:00.000Z') + index * 2 * 3600000).toISOString(),
    invocations: 2,
    succeeded: 2,
  }));
  const healthy = evaluateP38Soak(cycles);
  assert.equal(healthy.eligible, true);
  assert.equal(healthy.observed_cycles, 12);
  assert.equal(healthy.span_hours, 24);

  const fourCycles = evaluateP38Soak(cycles.slice(0, 4));
  assert.equal(fourCycles.eligible, false);
  assert.ok(fourCycles.blockers.includes('insufficient-cycles'));

  const missingInvocation = evaluateP38Soak(cycles.map((cycle, index) =>
    index === 3 ? { ...cycle, invocations: 1, succeeded: 1 } : cycle));
  assert.equal(missingInvocation.eligible, false);
  assert.ok(missingInvocation.blockers.includes('insufficient-invocations'));

  const failedCycle = evaluateP38Soak(cycles.map((cycle, index) =>
    index === 5 ? { ...cycle, succeeded: 0 } : cycle));
  assert.equal(failedCycle.eligible, false);
  assert.ok(failedCycle.blockers.includes('failed-cycle'));

  const gapped = evaluateP38Soak(cycles.map((cycle, index) =>
    index >= 6 ? { ...cycle, cycle_start: new Date(Date.parse(cycle.cycle_start) + 2 * 3600000).toISOString() } : cycle));
  assert.equal(gapped.eligible, false);
  assert.ok(gapped.blockers.includes('cycle-gap'));
});

test('P39 P38 CLI persists state and resolves only after two independent healthy runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p39-monitor-'));
  const snapshotPath = join(dir, 'health.json');
  const statePath = join(dir, 'state.json');
  const outPath = join(dir, 'alert.json');
  const run = now => spawnSync(process.execPath, [
    'reference-graph/cli/p39-p38-monitor.mjs',
    '--snapshot', snapshotPath,
    '--state', statePath,
    '--state-out', statePath,
    '--now', now,
    '--out', outPath,
  ], { encoding: 'utf8' });

  try {
    writeFileSync(snapshotPath, JSON.stringify(snapshot({
      cycles: { ...snapshot().cycles, consecutive_failed: 1, last_cycle_status: 'failed' },
    })), 'utf8');
    const first = run(observed);
    assert.equal(first.status, 2);
    const firstState = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(firstState.severity, 'warn');
    assert.equal(firstState.healthy_probe_count, 0);

    writeFileSync(snapshotPath, JSON.stringify(snapshot({
      observed_at: '2026-11-08T00:16:00.000Z',
    })), 'utf8');
    const second = run('2026-11-08T00:16:00.000Z');
    assert.equal(second.status, 0);
    const secondState = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(secondState.severity, 'warn');
    assert.equal(secondState.healthy_probe_count, 1);

    writeFileSync(snapshotPath, JSON.stringify(snapshot({
      observed_at: '2026-11-08T00:22:00.000Z',
    })), 'utf8');
    const third = run('2026-11-08T00:22:00.000Z');
    assert.equal(third.status, 0);
    const thirdState = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(thirdState.severity, 'ok');
    assert.equal(thirdState.healthy_probe_count, 2);
    const output = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(output.plan.action, 'resolve');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
