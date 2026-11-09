import assert from 'node:assert/strict';
import test from 'node:test';

import {
  P39PublicHealthError,
  collectP38PublicHealth,
  evaluateP38PublicHealth,
  publicP38FailureReport,
} from '../../reference-graph/p39-p38-public-health.mjs';

const now = new Date('2026-11-08T03:00:00.000Z');
const refreshed = '2026-11-08T02:05:00.179+00:00';

function rows(count = 2, overrides = {}) {
  return Array.from({ length: count }, (_, index) => ({
    projection_version: 'reference-graph.profile-runtime.p30.v1',
    snapshot_date: '2026-11-08',
    refreshed_at: refreshed,
    ...overrides,
  }));
}

function response(payload, total = payload.length, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-range'
          ? `0-${Math.max(0, payload.length - 1)}/${total}` : null;
      },
    },
    async json() { return payload; },
  };
}

function input(fetchImpl, overrides = {}) {
  return {
    supabaseUrl: 'https://vrznfnxzlxaavpqbzbzd.supabase.co/',
    publishableKey: 'sb_publishable_p39_monitor_test',
    fetchImpl,
    now,
    ...overrides,
  };
}

test('P39 public monitor collects the three-field freshness view read-only', async () => {
  const calls = [];
  const snapshot = await collectP38PublicHealth(input(async (url, options) => {
    calls.push([url, options]);
    return response(rows());
  }));
  assert.equal(calls.length, 1);
  const url = new URL(calls[0][0]);
  assert.equal(url.pathname, '/rest/v1/reference_graph_profile_public_p30_v1');
  assert.equal(url.searchParams.get('select'), 'projection_version,snapshot_date,refreshed_at');
  assert.deepEqual(calls[0][1].headers, {
    apikey: 'sb_publishable_p39_monitor_test',
    Prefer: 'count=exact',
  });
  assert.equal(snapshot.api.visible_rows, 2);
  assert.equal(snapshot.api.content_range_total, 2);
  assert.equal(snapshot.projection.distinct_refreshed_at, 1);
  assert.equal(snapshot.projection.refreshed_at, '2026-11-08T02:05:00.179Z');
});

test('P39 public monitor evaluates healthy, stale, critical and date states', () => {
  const snapshot = {
    schema_version: 'reference-graph.p39-p38-public-health.v1',
    observed_at: now.toISOString(),
    api: { visible_rows: 2, content_range_total: 2, latency_ms: 100 },
    projection: {
      projection_version: 'reference-graph.profile-runtime.p30.v1',
      row_count: 2,
      snapshot_date: '2026-11-08',
      refreshed_at: '2026-11-08T02:05:00.179Z',
      distinct_refreshed_at: 1,
    },
  };
  assert.equal(evaluateP38PublicHealth(snapshot, { now, expectedCount: 2 }).severity, 'ok');
  assert.equal(evaluateP38PublicHealth({
    ...snapshot, projection: { ...snapshot.projection, refreshed_at: '2026-11-08T00:00:00.000Z' },
  }, { now, expectedCount: 2 }).severity, 'warn');
  assert.equal(evaluateP38PublicHealth({
    ...snapshot, projection: { ...snapshot.projection, refreshed_at: '2026-11-07T22:00:00.000Z' },
  }, { now, expectedCount: 2 }).severity, 'critical');
  assert.equal(evaluateP38PublicHealth({
    ...snapshot, projection: { ...snapshot.projection, snapshot_date: '2026-11-07' },
  }, { now, expectedCount: 2 }).severity, 'critical');
  assert.equal(evaluateP38PublicHealth({
    ...snapshot, api: { ...snapshot.api, latency_ms: 1600 },
  }, { now, expectedCount: 2 }).severity, 'warn');
});

test('P39 public monitor rejects count, range, mixed-refresh and invalid payloads', async () => {
  const one = await collectP38PublicHealth(input(async () => response(rows(1), 1)));
  assert.equal(evaluateP38PublicHealth(one, { now, expectedCount: 2 }).severity, 'critical');
  const mixed = await collectP38PublicHealth(input(async () => response(rows(2, {
    refreshed_at: '2026-11-08T02:05:00.179+00:00',
  }).map((row, index) => index === 1 ? { ...row, refreshed_at: '2026-11-08T02:05:01.179+00:00' } : row))));
  assert.equal(evaluateP38PublicHealth(mixed, { now, expectedCount: 2 }).severity, 'critical');
  for (const [fetchImpl, category] of [
    [async () => response(rows(), 2, 500), 'http'],
    [async () => ({ ...response(rows()), async json() { throw new SyntaxError('bad'); } }), 'invalid-json'],
    [async () => ({ ok: true, status: 200, headers: { get: () => null }, async json() { return rows(); } }), 'content-range-invalid'],
  ]) {
    await assert.rejects(collectP38PublicHealth(input(fetchImpl)),
      error => error instanceof P39PublicHealthError && error.category === category);
  }
  await assert.rejects(collectP38PublicHealth(input(async () => response(rows(), 2), {
    publishableKey: 'sb_secret_forbidden',
  })), P39PublicHealthError);
});

test('P39 public monitor turns transport failure into a critical redacted report', () => {
  const report = publicP38FailureReport('timeout', { now });
  assert.equal(report.severity, 'critical');
  assert.ok(report.codes.includes('public-api-timeout'));
  assert.equal(report.source_hash_verified, false);
  assert.equal(report.cron_history_verified, false);
  assert.equal(report.auto_remediation, false);
});
