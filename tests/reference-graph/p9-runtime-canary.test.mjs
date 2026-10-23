import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runP9ShadowCanary } from '../../reference-graph/p9-runtime-canary.mjs';
import { buildP8OfflineQuickCandidatePool } from '../../reference-graph/p8-cutover-review.mjs';
import { loadPatterns, loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { selectPatterns } from '../../knowledge/design-references/scripts/pattern-selection.mjs';
import { selectRecords } from '../../knowledge/design-references/scripts/selection.mjs';

const CONTROL_NOW = new Date('2026-10-23T12:00:00.000Z');
const CASES = JSON.parse(
  readFileSync(new URL('../../reference-graph/shadow-cases.json', import.meta.url), 'utf8'),
);
const QUICK = CASES[0];

function futureFreshCatalog() {
  return loadRecords().map((record) =>
    record.reviewStatus === 'reviewed'
      ? { ...record, lastVerifiedAt: '2099-01-01' }
      : record,
  );
}

function exactFixture() {
  const records = futureFreshCatalog();
  const patterns = loadPatterns();
  const pool = buildP8OfflineQuickCandidatePool(records, { now: CONTROL_NOW });
  return { records, patterns, pool };
}

function expectedLegacy(records, patterns, request) {
  const selection = selectRecords(records, request);
  return {
    selection,
    patterns: selectPatterns(patterns, selection.selected, request),
  };
}

test('P9 quick shadow reports exact parity while keeping legacy authoritative and logging legacy once', async () => {
  const { records, patterns, pool } = exactFixture();
  const expected = expectedLegacy(records, patterns, QUICK);
  const usageCalls = [];

  const result = await runP9ShadowCanary({
    records,
    patterns,
    request: QUICK,
    fetchCandidatePool: async () => ({
      candidates: pool,
      transport: { status: 'available', latency_ms: 12.5, candidate_count: pool.length },
    }),
    recordUsageFn: (...args) => usageCalls.push(args),
  });

  assert.equal(result.production_source, 'legacy-control');
  assert.deepEqual(result.records.map((row) => row.id), expected.selection.selected.map((row) => row.id));
  assert.deepEqual(result.patterns.map((row) => row.id), expected.patterns.map((row) => row.id));
  assert.equal(result.graph_canary.status, 'exact');
  assert.equal(result.graph_canary.record_exact, true);
  assert.equal(result.graph_canary.pattern_exact, true);
  assert.equal(result.graph_canary.transport.candidate_count, 275);
  assert.equal(usageCalls.length, 1);
  assert.deepEqual(usageCalls[0][0].map((row) => row.id), expected.selection.selected.map((row) => row.id));
  assert.equal(usageCalls[0][1], QUICK);
});

test('P9 quick shadow fails closed to legacy on transport failure without exposing raw error text', async () => {
  const { records, patterns } = exactFixture();
  const expected = expectedLegacy(records, patterns, QUICK);
  const usageCalls = [];

  const result = await runP9ShadowCanary({
    records,
    patterns,
    request: QUICK,
    fetchCandidatePool: async () => { throw new Error('secret-bearing upstream detail'); },
    recordUsageFn: (...args) => usageCalls.push(args),
  });

  assert.equal(result.graph_canary.status, 'fallback');
  assert.equal(result.graph_canary.reason, 'graph-shadow-error');
  assert.doesNotMatch(JSON.stringify(result), /secret-bearing upstream detail/);
  assert.deepEqual(result.records.map((row) => row.id), expected.selection.selected.map((row) => row.id));
  assert.equal(usageCalls.length, 1);
});

test('P9 quick shadow falls back on unknown graph identities or record-order mismatch', async () => {
  const { records, patterns, pool } = exactFixture();
  const expected = expectedLegacy(records, patterns, QUICK);
  const expectedIds = new Set(expected.selection.selected.map((row) => row.id));

  const unknown = await runP9ShadowCanary({
    records,
    patterns,
    request: QUICK,
    fetchCandidatePool: async () => ({
      candidates: [{ ...pool[0], asset_id: '99999999-9999-5999-8999-999999999999', legacy_id: 'ref-unknown-p9' }],
      transport: { status: 'available', latency_ms: 1, candidate_count: 1 },
    }),
    recordUsageFn: () => {},
  });
  assert.equal(unknown.graph_canary.status, 'fallback');

  const driftPool = pool.filter((row) => !expectedIds.has(row.legacy_id));
  const drift = await runP9ShadowCanary({
    records,
    patterns,
    request: QUICK,
    fetchCandidatePool: async () => ({
      candidates: driftPool,
      transport: { status: 'available', latency_ms: 2, candidate_count: driftPool.length },
    }),
    recordUsageFn: () => {},
  });
  assert.equal(drift.graph_canary.status, 'fallback');
  assert.equal(drift.graph_canary.record_exact, false);
  assert.deepEqual(drift.records.map((row) => row.id), expected.selection.selected.map((row) => row.id));
});

test('P9 standard and deep remain network-free legacy-only', async () => {
  const { records, patterns } = exactFixture();
  let fetchCalls = 0;
  for (const [profile, limit] of [['standard', 8], ['deep', 20]]) {
    const request = { ...QUICK, profile, limit };
    const result = await runP9ShadowCanary({
      records,
      patterns,
      request,
      fetchCandidatePool: async () => { fetchCalls += 1; throw new Error('must not run'); },
      recordUsageFn: () => {},
    });
    assert.equal(result.production_source, 'legacy-control');
    assert.equal(result.graph_canary.status, 'legacy-only');
  }
  assert.equal(fetchCalls, 0);
});

test('P9 canary can disable usage recording without affecting the authoritative legacy result', async () => {
  const { records, patterns, pool } = exactFixture();
  let usageCalls = 0;
  const result = await runP9ShadowCanary({
    records,
    patterns,
    request: QUICK,
    fetchCandidatePool: async () => ({
      candidates: pool,
      transport: { status: 'available', latency_ms: 1, candidate_count: pool.length },
    }),
    recordUsageFn: () => { usageCalls += 1; },
    recordUsageEnabled: false,
  });
  assert.equal(result.graph_canary.status, 'exact');
  assert.equal(usageCalls, 0);
  assert.ok(result.records.length > 0);
});
