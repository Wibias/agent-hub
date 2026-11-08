import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { buildP28OfflineProfileCandidatePool } from '../../reference-graph/p28-profile-candidate-contract.mjs';
import {
  P30ProfileTransportError,
  fetchP30ProfileCandidateSnapshot,
} from '../../reference-graph/p30-profile-transport.mjs';

const asOf = '2026-11-07T12:00:00.000Z';
const snapshotDate = '2026-11-07';
const pool = buildP28OfflineProfileCandidatePool({
  records: loadRecords(),
  now: new Date('2026-11-07T00:00:00.000Z'),
}).slice(0, 3);
const rows = pool.map(row => ({
  ...row,
  projection_version: 'reference-graph.profile-runtime.p30.v1',
  snapshot_date: snapshotDate,
  refreshed_at: '2026-11-07T11:30:00.000Z',
}));
const expectedSetHash = createHash('sha256')
  .update(pool.map(row => row.legacy_id).sort().join('\n'), 'utf8')
  .digest('hex');

function withCount(payload, total = rows.length, start = 0) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-range'
          ? `${start}-${start + Math.max(0, payload.length - 1)}/${total}`
          : null;
      },
    },
    async json() { return payload; },
  };
}

function args(payload = rows, overrides = {}) {
  return {
    supabaseUrl: 'https://example.supabase.co/',
    publishableKey: 'sb_publishable_p30-test',
    expectedDate: snapshotDate,
    asOf,
    expectedCandidateCount: rows.length,
    expectedCandidateIdSetSha256: expectedSetHash,
    fetchImpl: async () => withCount(payload),
    ...overrides,
  };
}

async function fail(payload, category, overrides = {}) {
  await assert.rejects(
    fetchP30ProfileCandidateSnapshot(args(payload, overrides)),
    error => error instanceof P30ProfileTransportError && error.category === category,
  );
}

test('P30 fetches distinct versioned projection read-only with publishable key and independent pins', async () => {
  const calls = [];
  const result = await fetchP30ProfileCandidateSnapshot(args(rows, {
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return withCount(rows);
    },
  }));
  assert.equal(calls.length, 1);
  const url = new URL(calls[0][0]);
  assert.equal(url.pathname, '/rest/v1/reference_graph_profile_runtime_projection_p30_v1');
  assert.equal(url.searchParams.get('snapshot_date'), 'eq.2026-11-07');
  assert.equal(url.searchParams.get('order'), 'asset_id.asc');
  for (const column of ['primary_stratum', 'projection_version', 'snapshot_date', 'refreshed_at']) {
    assert.ok(url.searchParams.get('select').split(',').includes(column));
  }
  assert.equal(calls[0][1].method, 'GET');
  assert.deepEqual(calls[0][1].headers, {
    apikey: 'sb_publishable_p30-test',
    Prefer: 'count=exact',
  });
  assert.equal(calls[0][1].body, undefined);
  assert.ok(calls[0][1].signal instanceof AbortSignal);
  assert.deepEqual(result.candidates, pool);
  assert.equal(result.transport.candidate_count, pool.length);
  assert.equal(result.transport.candidate_id_set_sha256, expectedSetHash);
  assert.equal(result.transport.snapshot_date, snapshotDate);
  assert.equal(result.transport.projection_version, 'reference-graph.profile-runtime.p30.v1');
  assert.equal(result.transport.live_graph_parity_verified, false);
  assert.equal(result.transport.pattern_parity_verified, false);
  assert.equal(result.transport.activation_performed, false);
  assert.equal(result.transport.repository_default_graph_enabled, false);
  assert.doesNotMatch(JSON.stringify(result.transport), /sb_publishable_p30-test|legacy_id|search_text/);
});

test('P30 requires independently pinned date, as-of clock, set hash and candidate count', async () => {
  for (const overrides of [
    { expectedDate: undefined },
    { expectedDate: '2026-02-30' },
    { asOf: undefined },
    { asOf: 'not-a-clock' },
    { asOf: '2026-11-08T00:00:00.000Z' },
    { expectedCandidateCount: undefined },
    { expectedCandidateCount: -1 },
    { expectedCandidateIdSetSha256: undefined },
    { expectedCandidateIdSetSha256: 'not-a-sha' },
    { supabaseUrl: 'http://example.supabase.co' },
    { publishableKey: 'sb_secret_test-secret' },
    { publishableKey: 'opaque-secret' },
  ]) {
    await assert.rejects(fetchP30ProfileCandidateSnapshot(args(rows, overrides)), P30ProfileTransportError);
  }
});

test('P30 rejects missing or injected candidate fields and invalid Standard/Deep strata', async () => {
  await fail([{ ...rows[0], primary_stratum: 'invalid-stratum' }, rows[1], rows[2]], 'candidate-invalid');
  await fail([{ ...rows[0], extra_secret: 'leak' }, rows[1], rows[2]], 'candidate-invalid');
  const { primary_stratum: _ignored, ...missing } = rows[0];
  await fail([missing, rows[1], rows[2]], 'candidate-invalid');
  await fail([{ ...rows[0], tags: 'bad' }, rows[1], rows[2]], 'candidate-invalid');
  await fail([{ ...rows[0], platform: 'unknown' }, rows[1], rows[2]], 'candidate-invalid');
  await fail([rows[0], { ...rows[0] }, rows[1]], 'candidate-invalid');
});

test('P30 fails closed on count, canonical membership, ordering, version and snapshot bindings', async () => {
  await fail(rows.slice(0, 2), 'candidate-count-mismatch');
  await fail(rows.map((row, i) => i === 0 ? { ...row, legacy_id: 'different' } : row), 'fingerprint-mismatch');
  await fail([...rows].reverse(), 'candidate-invalid');
  await fail(rows.map((row, i) => i === 0 ? { ...row, snapshot_date: '2026-11-06' } : row), 'snapshot-invalid');
  await fail(rows.map((row, i) => i === 0 ? { ...row, projection_version: 'v2' } : row), 'projection-version-mismatch');
  await fail(rows.map((row, i) => i === 0 ? { ...row, refreshed_at: '2026-11-07T11:29:00.000Z' } : row), 'snapshot-invalid');
  await fail(rows.map(row => ({ ...row, refreshed_at: '2026-11-07T06:00:00.000Z' })), 'snapshot-stale');
  await fail(rows.map(row => ({ ...row, refreshed_at: '2026-11-07T12:03:00.000Z' })), 'snapshot-invalid');
  await fail([], 'candidate-invalid');
  await fail({ invalid: 'body' }, 'candidate-invalid');
});

test('P30 rejects a server snapshot with more rows than the pinned candidate count', async () => {
  const extraRows = rows.concat({
    ...rows[0],
    asset_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    legacy_id: 'p30-extra-row',
  });
  await fail(extraRows, 'candidate-count-mismatch', {
    fetchImpl: async (url) => {
      const limit = Number(new URL(url).searchParams.get('limit'));
      return withCount(extraRows.slice(0, limit), extraRows.length);
    },
  });
});

test('P30 requires an exact Content-Range total', async () => {
  const cases = [
    async () => ({ ok: true, status: 200, async json() { return rows; } }),
    async () => ({
      ok: true,
      status: 200,
      headers: { get: () => '0-2/*' },
      async json() { return rows; },
    }),
    async () => ({
      ok: true,
      status: 200,
      headers: { get: () => '1-3/3' },
      async json() { return rows; },
    }),
    async () => withCount(rows, 4),
  ];
  for (const fetchImpl of cases) {
    await assert.rejects(
      fetchP30ProfileCandidateSnapshot(args(rows, { fetchImpl })),
      error => error instanceof P30ProfileTransportError
        && error.category === 'candidate-count-mismatch',
    );
  }
});

test('P30 rejects HTTP failures, invalid JSON, network errors and timeouts without key disclosure', async () => {
  const bad = [
    [async () => ({ ok: false, status: 503 }), 'http'],
    [async () => ({ ok: true, status: 200, async json() { throw new SyntaxError('broken'); } }), 'invalid-json'],
    [async () => { throw new Error('apikey=sb_publishable_p30-test'); }, 'network'],
  ];
  for (const [fetchImpl, category] of bad) {
    await assert.rejects(
      fetchP30ProfileCandidateSnapshot(args(rows, { fetchImpl })),
      error => error instanceof P30ProfileTransportError
        && error.category === category
        && !error.message.includes('sb_publishable_p30-test'),
    );
  }
  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  await assert.rejects(
    fetchP30ProfileCandidateSnapshot(args(rows, { fetchImpl, timeoutMs: 5 })),
    error => error instanceof P30ProfileTransportError && error.category === 'timeout',
  );
});

test('P30 is isolated from live P10/P11 routing and P28/P29 candidate selection', () => {
  const source = readFileSync('reference-graph/p30-profile-transport.mjs', 'utf8');
  const router = readFileSync('reference-graph/p11-runtime-router.mjs', 'utf8');
  assert.doesNotMatch(router, /p30-profile-transport|profile_runtime_projection_p30/i);
  assert.doesNotMatch(source, /selectRecords|hydrateP8LegacyIds|service.?role|\/rest\/v1\/rpc\/|persistCapture|writeFileSync/);
  assert.match(source, /auditP28ProfileCandidateContract/);
  assert.doesNotMatch(readFileSync('reference-graph/schema/009_reference_graph_runtime_projection.sql', 'utf8'), /profile_runtime_projection_p30/);
});
