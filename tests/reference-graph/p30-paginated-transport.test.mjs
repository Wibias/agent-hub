import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { buildP28OfflineProfileCandidatePool } from '../../reference-graph/p28-profile-candidate-contract.mjs';
import {
  fetchP30ProfileCandidateSnapshot,
  P30ProfileTransportError,
} from '../../reference-graph/p30-profile-transport.mjs';

// Representative 1201-row catalog, above Supabase's default 1000-row Data API limit.
// Everything remains synthetic and locally hosted in the fetch stub.
const seed = buildP28OfflineProfileCandidatePool({
  records: loadRecords(),
  now: new Date('2026-11-07T00:00:00.000Z'),
})[0];
assert.ok(seed, 'P28 test catalog must contain a candidate');

const ROW_COUNT = 1201;
const snapshot = Array.from({ length: ROW_COUNT }, (_, i) => ({
  ...seed,
  asset_id: '00000000-0000-5000-8000-' + i.toString(16).padStart(12, '0'),
  legacy_id: 'p30-page-' + i.toString(10).padStart(4, '0'),
  projection_version: 'reference-graph.profile-runtime.p30.v1',
  snapshot_date: '2026-11-07',
  refreshed_at: '2026-11-07T11:30:00+00:00',
}));
const idSha = createHash('sha256')
  .update(snapshot.map(x => x.legacy_id).sort().join('\n'), 'utf8').digest('hex');

function input(fetchImpl, overrides = {}) {
  return {
    supabaseUrl: 'https://test-p30.supabase.co/',
    publishableKey: 'sb_publishable_p30_paginated_test',
    expectedDate: '2026-11-07',
    asOf: '2026-11-07T12:00:00.000Z',
    expectedCandidateCount: ROW_COUNT,
    expectedCandidateIdSetSha256: idSha,
    timeoutMs: 5000,
    fetchImpl,
    ...overrides,
  };
}

// Simulates a hosted API that caps each response at 1000 or fewer rows,
// regardless of the client's requested size.
function cappedApi({ rows = snapshot, cap = 1000, failures = {}, calls = [] } = {}) {
  return async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, { apikey: 'sb_publishable_p30_paginated_test' });
    const u = new URL(url);
    assert.equal(u.pathname, '/rest/v1/reference_graph_profile_runtime_projection_p30_v1');
    assert.equal(u.searchParams.get('snapshot_date'), 'eq.2026-11-07');
    assert.equal(u.searchParams.get('order'), 'asset_id.asc');
    const rawLimit = u.searchParams.get('limit');
    const rawOffset = u.searchParams.get('offset');
    const limit = rawLimit === null ? 1000 : Number(rawLimit);
    const offset = rawOffset === null ? 0 : Number(rawOffset);
    assert.ok(Number.isInteger(limit) && limit >= 1 && limit <= 1000);
    assert.ok(Number.isInteger(offset) && offset >= 0);
    calls.push({ limit, offset });
    const page = rows.slice(offset, offset + Math.min(limit, cap));
    return failures[offset]
      ? failures[offset](page)
      : { ok: true, status: page.length < limit ? 200 : 206, async json() { return page; } };
  };
}

async function fails(category, fetchImpl) {
  await assert.rejects(fetchP30ProfileCandidateSnapshot(input(fetchImpl)),
    e => e instanceof P30ProfileTransportError && e.category === category
      && !/sb_publishable_p30_paginated_test|search_text|p30-page-/.test(e.message));
}

test('P30 pages a 1201-candidate snapshot past the default 1000-row API cap', async () => {
  const calls = [];
  const report = await fetchP30ProfileCandidateSnapshot(input(cappedApi({ calls })));
  assert.equal(report.candidates.length, ROW_COUNT);
  assert.equal(report.transport.candidate_count, ROW_COUNT);
  assert.equal(report.transport.candidate_id_set_sha256, idSha);
  assert.equal(report.transport.refreshed_at, '2026-11-07T11:30:00.000Z');
  assert.deepEqual(calls.map(x => x.offset), [0, 500, 1000]);
  assert.deepEqual(calls.map(x => x.limit), [500, 500, 201]);
  assert.equal(report.transport.live_graph_parity_verified, false);
  assert.equal(report.transport.activation_performed, false);
});

test('P30 remains correct when Supabase caps pages smaller than requested', async () => {
  const calls = [];
  const report = await fetchP30ProfileCandidateSnapshot(input(cappedApi({ calls, cap: 117 })));
  assert.equal(report.candidates.length, ROW_COUNT);
  assert.equal(report.transport.candidate_id_set_sha256, idSha);
  assert.ok(calls.length > 10);
  assert.equal(calls[0].offset, 0);
  assert.equal(calls[1].offset, 117);
  assert.equal(calls.at(-1).offset + Math.min(calls.at(-1).limit, 117), ROW_COUNT);
});

test('P30 rejects a missing later page rather than accepting a partial candidate set', async () => {
  let requests = 0;
  const api = cappedApi({
    failures: {
      500: () => ({ ok: true, status: 200, async json() { return []; } }),
    },
  });
  await fails('candidate-count-mismatch', async (...args) => {
    requests++;
    return api(...args);
  });
  assert.equal(requests, 2);
});

test('P30 rejects a later page HTTP or JSON failure and never returns partial results', async () => {
  for (const [failure, category] of [
    [() => ({ ok: false, status: 503 }), 'http'],
    [() => ({ ok: true, status: 200, async json() { throw new Error('bad JSON'); } }), 'invalid-json'],
  ]) {
    await fails(category, cappedApi({ failures: { 500: failure } }));
  }
});

test('P30 rejects mixed publication instants or duplicated pages across a paginated snapshot', async () => {
  await fails('snapshot-invalid', cappedApi({
    failures: {
      500: page => ({ ok: true, status: 206, async json() {
        return page.map(r => ({ ...r, refreshed_at: '2026-11-07T11:29:00+00:00' }));
      } }),
    },
  }));
  await fails('candidate-invalid', cappedApi({
    failures: {
      500: () => ({ ok: true, status: 206, async json() { return snapshot.slice(0, 500); } }),
    },
  }));
});

test('P30 does not overfetch or write and keeps read-only P11 isolation', () => {
  const src = readFileSync('reference-graph/p30-profile-transport.mjs', 'utf8');
  const router = readFileSync('reference-graph/p11-runtime-router.mjs', 'utf8');
  assert.doesNotMatch(src, /method:\s*['\"](?:POST|PATCH|DELETE)['\"]|service_role|writeFileSync|createClient/);
  assert.doesNotMatch(router, /p30-profile-transport/);
});
