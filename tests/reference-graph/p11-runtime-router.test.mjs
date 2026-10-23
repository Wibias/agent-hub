import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  loadPatterns,
  loadRecords,
} from '../../knowledge/design-references/scripts/lib.mjs';
import { selectPatterns } from '../../knowledge/design-references/scripts/pattern-selection.mjs';
import { selectRecords } from '../../knowledge/design-references/scripts/selection.mjs';
import { buildP8OfflineQuickCandidatePool } from '../../reference-graph/p8-cutover-review.mjs';
import { runP11RuntimeQuery } from '../../reference-graph/p11-runtime-router.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const cases = JSON.parse(readFileSync(path.join(root, 'reference-graph/shadow-cases.json'), 'utf8'));
const records = loadRecords();
const patterns = loadPatterns();
const now = new Date('2026-10-23T12:00:00.000Z');
const candidatePool = buildP8OfflineQuickCandidatePool(records, { now });
const quickCase = cases.find((row) => row.profile === 'quick');

function requestFromCase(row = quickCase) {
  return {
    profile: row.profile,
    limit: row.limit,
    surface: row.surface,
    platform: row.platform,
    job: row.job,
    dimensions: row.dimensions,
  };
}

function publicKeys(value) {
  return Object.keys(value).sort();
}

function ids(rows) {
  return rows.map((row) => row.id);
}

function directLegacy(request) {
  const selection = selectRecords(records, request, { now });
  return {
    selection,
    patterns: selectPatterns(patterns, selection.selected, request),
  };
}

const expectedPublicKeys = [
  'profile',
  'requested',
  'countsByStratum',
  'coverage',
  'coverageGaps',
  'requiresTargetedResearch',
  'usageWarning',
  'records',
  'patterns',
].sort();

test('default mode returns legacy and never fetches', async () => {
  const request = requestFromCase();
  let fetchCount = 0;
  const result = await runP11RuntimeQuery({
    records,
    patterns,
    request,
    now,
    fetchCandidatePool: async () => {
      fetchCount += 1;
      return { candidates: candidatePool };
    },
    recordUsageEnabled: false,
  });

  const legacy = directLegacy(request);
  assert.equal(fetchCount, 0);
  assert.equal(result.routing.attempted, false);
  assert.equal(result.routing.authoritative_source, 'legacy-control');
  assert.equal(result.routing.reason, 'activation-disabled');
  assert.deepEqual(ids(result.result.records), ids(legacy.selection.selected));
  assert.deepEqual(ids(result.result.patterns), ids(legacy.patterns));
  assert.deepEqual(publicKeys(result.result), expectedPublicKeys);
});

test('only exact graph mode enables quick fetch', async () => {
  const request = requestFromCase();
  for (const graphMode of ['GRAPH', 'enabled', 'true', '', undefined]) {
    let fetchCount = 0;
    const result = await runP11RuntimeQuery({
      records,
      patterns,
      request,
      now,
      graphMode,
      fetchCandidatePool: async () => {
        fetchCount += 1;
        return { candidates: candidatePool };
      },
      recordUsageEnabled: false,
    });
    assert.equal(fetchCount, 0, `mode ${String(graphMode)} must not fetch`);
    assert.equal(result.routing.authoritative_source, 'legacy-control');
  }
});

test('standard and deep remain zero-network legacy-only even in graph mode', async () => {
  for (const profile of ['standard', 'deep']) {
    const profileCase = cases.find((row) => row.profile === profile) ?? {
      ...quickCase,
      profile,
      limit: profile === 'standard' ? 8 : 20,
    };
    const request = requestFromCase(profileCase);
    let fetchCount = 0;
    const result = await runP11RuntimeQuery({
      records,
      patterns,
      request,
      now,
      graphMode: 'graph',
      fetchCandidatePool: async () => {
        fetchCount += 1;
        return { candidates: candidatePool };
      },
      recordUsageEnabled: false,
    });
    assert.equal(fetchCount, 0);
    assert.equal(result.routing.attempted, false);
    assert.equal(result.routing.authoritative_source, 'legacy-control');
    assert.equal(result.routing.reason, 'profile-legacy-only');
  }
});

test('quick graph becomes authoritative only when ordered records and patterns are exact', async () => {
  const request = requestFromCase();
  const result = await runP11RuntimeQuery({
    records,
    patterns,
    request,
    now,
    graphMode: 'graph',
    fetchCandidatePool: async () => ({
      candidates: candidatePool,
      transport: { status: 'available', candidate_count: candidatePool.length },
    }),
    recordUsageEnabled: false,
  });

  const legacy = directLegacy(request);
  assert.equal(result.routing.attempted, true);
  assert.equal(result.routing.authoritative_source, 'reference-graph');
  assert.equal(result.routing.record_exact, true);
  assert.equal(result.routing.pattern_exact, true);
  assert.equal(result.routing.reason, null);
  assert.deepEqual(ids(result.result.records), ids(legacy.selection.selected));
  assert.deepEqual(ids(result.result.patterns), ids(legacy.patterns));
  assert.deepEqual(publicKeys(result.result), expectedPublicKeys);
});

test('pattern mismatch keeps legacy authoritative even when records are exact', async () => {
  const request = requestFromCase();
  let calls = 0;
  const result = await runP11RuntimeQuery({
    records,
    patterns,
    request,
    now,
    graphMode: 'graph',
    fetchCandidatePool: async () => ({ candidates: candidatePool }),
    selectPatternsFn(patternRows, selected, req) {
      calls += 1;
      const rows = selectPatterns(patternRows, selected, req);
      return calls === 1 ? rows : rows.slice().reverse();
    },
    recordUsageEnabled: false,
  });

  assert.equal(result.routing.record_exact, true);
  assert.equal(result.routing.pattern_exact, false);
  assert.equal(result.routing.authoritative_source, 'legacy-control');
  assert.equal(result.routing.reason, 'handoff-mismatch');
});

test('record mismatch keeps legacy authoritative', async () => {
  const request = requestFromCase();
  const legacy = directLegacy(request);
  const selectedIds = new Set(ids(legacy.selection.selected));
  const result = await runP11RuntimeQuery({
    records,
    patterns,
    request,
    now,
    graphMode: 'graph',
    fetchCandidatePool: async () => ({
      candidates: candidatePool.filter((row) => !selectedIds.has(row.legacy_id)),
    }),
    recordUsageEnabled: false,
  });

  assert.equal(result.routing.authoritative_source, 'legacy-control');
  assert.equal(result.routing.record_exact, false);
  assert.equal(result.routing.reason, 'handoff-mismatch');
});

test('missing runtime config fails closed without a fetch attempt', async () => {
  const result = await runP11RuntimeQuery({
    records,
    patterns,
    request: requestFromCase(),
    now,
    graphMode: 'graph',
    recordUsageEnabled: false,
  });

  assert.equal(result.routing.attempted, false);
  assert.equal(result.routing.authoritative_source, 'legacy-control');
  assert.equal(result.routing.reason, 'missing-runtime-config');
});

test('transport, malformed payload, and unknown hydration ids fail closed without leaking errors', async () => {
  const request = requestFromCase();
  const legacy = directLegacy(request);
  const failures = [
    async () => { throw new Error('SUPER SECRET REMOTE ERROR'); },
    async () => ({ nope: [] }),
    async () => ({
      candidates: candidatePool.map((row, index) => ({
        ...row,
        legacy_id: `unknown-p11-${index}`,
      })),
    }),
  ];

  for (const fetchCandidatePool of failures) {
    const result = await runP11RuntimeQuery({
      records,
      patterns,
      request,
      now,
      graphMode: 'graph',
      fetchCandidatePool,
      recordUsageEnabled: false,
    });
    assert.equal(result.routing.authoritative_source, 'legacy-control');
    assert.equal(result.routing.reason, 'graph-runtime-error');
    assert.equal(JSON.stringify(result.routing).includes('SUPER SECRET'), false);
    assert.deepEqual(ids(result.result.records), ids(legacy.selection.selected));
    assert.deepEqual(ids(result.result.patterns), ids(legacy.patterns));
  }
});

test('usage is written exactly once for the authoritative result', async () => {
  const request = requestFromCase();
  const calls = [];
  const result = await runP11RuntimeQuery({
    records,
    patterns,
    request,
    now,
    graphMode: 'graph',
    fetchCandidatePool: async () => ({ candidates: candidatePool }),
    recordUsageFn(selected, req) {
      calls.push({ ids: ids(selected), request: req });
    },
  });

  assert.equal(result.routing.authoritative_source, 'reference-graph');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ids, ids(result.result.records));
  assert.equal(calls[0].request, request);
});

test('usage failure is non-fatal and preserves existing warning semantics', async () => {
  const result = await runP11RuntimeQuery({
    records,
    patterns,
    request: requestFromCase(),
    now,
    recordUsageFn() {
      throw new Error('disk full');
    },
  });

  assert.match(result.result.usageWarning, /^Selected records are valid, but local usage recording failed: disk full$/);
  assert.ok(result.result.records.length > 0);
});

test('recordUsageEnabled false performs zero writes', async () => {
  let writes = 0;
  await runP11RuntimeQuery({
    records,
    patterns,
    request: requestFromCase(),
    now,
    recordUsageFn() { writes += 1; },
    recordUsageEnabled: false,
  });
  assert.equal(writes, 0);
});
