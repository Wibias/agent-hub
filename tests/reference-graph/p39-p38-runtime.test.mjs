import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { P39_P38_ALERT_SCHEMA } from '../../reference-graph/p39-p38-monitor.mjs';
import {
  P39P38RuntimeError,
  createJsonlAlertSink,
  createWebhookAlertSink,
  readP38AlertState,
  runP38MonitorCycle,
  writeP38AlertStateAtomic,
} from '../../reference-graph/p39-p38-runtime.mjs';

function report(severity, codes, observedAt) {
  return {
    schema_version: P39_P38_ALERT_SCHEMA,
    scope: 'public-freshness-only',
    observed_at: observedAt,
    checked_at: observedAt,
    severity,
    healthy: severity === 'ok',
    codes,
    findings: codes.map(code => ({ code, severity, message: code })),
    auto_remediation: false,
    activation_performed: false,
  };
}

function state(observedAt, severity = 'ok') {
  return {
    schema_version: 'reference-graph.p39-p38-alert-state.v2',
    severity,
    alert_key: severity + ':',
    last_alert_at: null,
    healthy_probe_count: 0,
    last_healthy_at: null,
    observed_at: observedAt,
  };
}

function temp() {
  return mkdtempSync(join(tmpdir(), 'p39-runtime-'));
}

test('P39 runtime persists state atomically and recovers the backup', () => {
  const dir = temp();
  try {
    const path = join(dir, 'state.json');
    writeP38AlertStateAtomic(path, state('2026-11-08T00:00:00.000Z'));
    writeP38AlertStateAtomic(path, state('2026-11-08T00:05:00.000Z', 'warn'));
    writeFileSync(path, '{broken', 'utf8');
    assert.equal(readP38AlertState(path).observed_at, '2026-11-08T00:00:00.000Z');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('P39 runtime pages, suppresses, repeats, resolves and survives restart', async () => {
  const dir = temp();
  try {
    const path = join(dir, 'state.json');
    const events = [];
    const sink = async event => events.push(event);
    const warn = report('warn', ['public-projection-stale-2h15m'], '2026-11-08T00:10:00.000Z');
    const first = await runP38MonitorCycle({ report: warn, statePath: path, sink, now: new Date(warn.observed_at) });
    assert.equal(first.plan.action, 'page');
    const suppress = await runP38MonitorCycle({ report: warn, statePath: path, sink, now: new Date('2026-11-08T00:20:00.000Z') });
    assert.equal(suppress.plan.action, 'suppress');
    assert.equal(events.length, 1);
    const repeat = await runP38MonitorCycle({ report: warn, statePath: path, sink, now: new Date('2026-11-08T01:11:00.000Z') });
    assert.equal(repeat.plan.action, 'page');
    assert.equal(events.length, 2);

    const healthy1 = report('ok', [], '2026-11-08T01:20:00.000Z');
    const firstHealthy = await runP38MonitorCycle({ report: healthy1, statePath: path, sink, now: new Date(healthy1.observed_at) });
    assert.equal(firstHealthy.plan.action, 'none');
    assert.equal(readP38AlertState(path).severity, 'warn');
    const healthy2 = report('ok', [], '2026-11-08T01:26:00.000Z');
    const resolved = await runP38MonitorCycle({ report: healthy2, statePath: path, sink, now: new Date(healthy2.observed_at) });
    assert.equal(resolved.plan.action, 'resolve');
    assert.equal(events.length, 3);
    assert.equal(readP38AlertState(path).severity, 'ok');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('P39 runtime refuses active locks and recovers stale locks', async () => {
  const dir = temp();
  try {
    const path = join(dir, 'state.json');
    const sink = async () => {};
    const r = report('warn', ['public-count-mismatch'], '2026-11-08T00:10:00.000Z');
    writeFileSync(path + '.lock', JSON.stringify({ created_at: new Date().toISOString() }), 'utf8');
    await assert.rejects(runP38MonitorCycle({ report: r, statePath: path, sink }), P39P38RuntimeError);
    writeFileSync(path + '.lock', JSON.stringify({ created_at: new Date(Date.now() - 11 * 60 * 1000).toISOString() }), 'utf8');
    const ok = await runP38MonitorCycle({ report: r, statePath: path, sink });
    assert.equal(ok.plan.action, 'page');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('P39 runtime does not advance state when alert delivery fails', async () => {
  const dir = temp();
  try {
    const path = join(dir, 'state.json');
    const r = report('critical', ['public-count-mismatch'], '2026-11-08T00:10:00.000Z');
    await assert.rejects(runP38MonitorCycle({
      report: r, statePath: path, sink: async () => { throw new Error('sink down'); },
    }), P39P38RuntimeError);
    assert.equal(readP38AlertState(path), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('P39 runtime JSONL and webhook sinks emit only redacted alert events', async () => {
  const dir = temp();
  try {
    const log = join(dir, 'alerts.jsonl');
    const jsonl = createJsonlAlertSink(log);
    const event = { schema_version: 'reference-graph.p39-p38-alert-event.v1', action: 'page', severity: 'warn', codes: ['x'], alert_key: 'warn:x' };
    await jsonl(event);
    assert.deepEqual(JSON.parse(readFileSync(log, 'utf8').trim()), event);
    let received = null;
    const webhook = createWebhookAlertSink('https://example.invalid/alert', {
      fetchImpl: async (_url, options) => { received = JSON.parse(options.body); return { ok: true }; },
    });
    await webhook(event);
    assert.deepEqual(received, event);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
