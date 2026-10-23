import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assessP8ActivationBoundary,
  buildP8OfflineQuickCandidatePool,
  compareP8QuickHandoff,
  hydrateP8LegacyIds,
} from '../../reference-graph/p8-cutover-review.mjs';
import { adaptLegacyDesignReference } from '../../reference-graph/legacy-import.mjs';
import { selectP7ParityLexicalResults } from '../../reference-graph/p7-parity-policy.mjs';
import { loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { selectRecords } from '../../knowledge/design-references/scripts/selection.mjs';

const CONTROL_NOW = new Date('2026-10-23T12:00:00.000Z');
const CASES = JSON.parse(
  readFileSync(new URL('../../reference-graph/shadow-cases.json', import.meta.url), 'utf8'),
);

function record(id, extra = {}) {
  return { id, ...extra };
}

function quickRequest(overrides = {}) {
  return {
    id: overrides.id ?? 'p8-case',
    profile: 'quick',
    limit: overrides.limit ?? 2,
    surface: overrides.surface ?? 'public-home',
    platform: overrides.platform ?? 'web-responsive',
    job: overrides.job ?? 'creator landing page',
    dimensions: overrides.dimensions ?? 'visual-world,topology',
    ...overrides,
  };
}

test('P8 offline pool reproduces the current eligible P7 candidate population and source-family precedence', () => {
  const records = loadRecords();
  const pool = buildP8OfflineQuickCandidatePool(records, { now: CONTROL_NOW });

  assert.equal(pool.length, 275);
  assert.equal(new Set(pool.map((row) => row.asset_id)).size, 275);
  assert.equal(new Set(pool.map((row) => row.legacy_id)).size, 275);

  const byLegacyId = new Map(pool.map((row) => [row.legacy_id, row]));
  for (const sourceRecord of records) {
    const candidate = byLegacyId.get(sourceRecord.id);
    if (!candidate) continue;
    const capture = adaptLegacyDesignReference(sourceRecord);
    assert.equal(
      candidate.source_family,
      capture.asset.metadata.source_family ?? capture.source.source_family ?? null,
      `source_family precedence drifted for ${sourceRecord.id}`,
    );
  }
});

test('P8 hydration preserves graph order and canonical local object identity', () => {
  const alpha = record('ref-alpha', { title: 'Alpha' });
  const beta = record('ref-beta', { title: 'Beta' });
  const result = hydrateP8LegacyIds({
    records: [alpha, beta],
    legacyIds: ['ref-beta', 'ref-alpha'],
  });

  assert.deepEqual(result.map((row) => row.id), ['ref-beta', 'ref-alpha']);
  assert.equal(result[0], beta);
  assert.equal(result[1], alpha);
});

test('P8 hydration fails closed for unknown graph IDs', () => {
  assert.throws(
    () => hydrateP8LegacyIds({ records: [record('ref-alpha')], legacyIds: ['ref-missing'] }),
    /ref-missing/,
  );
});

test('P8 hydration rejects duplicate graph IDs and duplicate local IDs', () => {
  assert.throws(
    () => hydrateP8LegacyIds({
      records: [record('ref-alpha')],
      legacyIds: ['ref-alpha', 'ref-alpha'],
    }),
    /duplicate graph legacy id/i,
  );
  assert.throws(
    () => hydrateP8LegacyIds({
      records: [record('ref-alpha'), record('ref-alpha')],
      legacyIds: ['ref-alpha'],
    }),
    /duplicate local record id/i,
  );
});

test('P8 quick handoff reports exact ordered parity and returns hydrated graph records', () => {
  const records = [record('ref-a'), record('ref-b')];
  const request = quickRequest();
  const legacySelection = { selected: [records[0], records[1]] };
  const result = compareP8QuickHandoff({
    records,
    request,
    graphLegacyIds: ['ref-a', 'ref-b'],
    legacySelection,
  });

  assert.equal(result.handoff_exact, true);
  assert.deepEqual(result.legacy_ids, ['ref-a', 'ref-b']);
  assert.deepEqual(result.graph_ids, ['ref-a', 'ref-b']);
  assert.deepEqual(result.missing_from_graph, []);
  assert.deepEqual(result.unexpected_from_graph, []);
  assert.equal(result.graph_records[0], records[0]);
  assert.equal(result.graph_records[1], records[1]);
});

test('P8 quick handoff reports order drift instead of normalizing it away', () => {
  const records = [record('ref-a'), record('ref-b')];
  const result = compareP8QuickHandoff({
    records,
    request: quickRequest(),
    graphLegacyIds: ['ref-b', 'ref-a'],
    legacySelection: { selected: [records[0], records[1]] },
  });

  assert.equal(result.handoff_exact, false);
  assert.equal(result.same_membership, true);
  assert.equal(result.same_order, false);
});

test('P8 graph handoff rejects standard and deep profiles', () => {
  const records = [record('ref-a')];
  for (const profile of ['standard', 'deep']) {
    assert.throws(
      () => compareP8QuickHandoff({
        records,
        request: quickRequest({ profile, limit: 1 }),
        graphLegacyIds: ['ref-a'],
        legacySelection: { selected: [records[0]] },
      }),
      /quick/i,
    );
  }
});

test('P8 activation boundary distinguishes quick review eligibility from production activation', () => {
  const exact = assessP8ActivationBoundary({
    profile: 'quick',
    handoffExact: true,
    runtimeCredentialMode: 'service-role',
  });
  assert.equal(exact.quick_path_review_eligible, true);
  assert.equal(exact.production_activation_ready, false);
  assert.equal(exact.production_source, 'legacy-control');
  assert.equal(exact.activation_performed, false);
  assert.match(exact.blockers.join('\n'), /service.?role/i);

  const drift = assessP8ActivationBoundary({
    profile: 'quick',
    handoffExact: false,
    runtimeCredentialMode: 'service-role',
  });
  assert.equal(drift.quick_path_review_eligible, false);

  for (const profile of ['standard', 'deep']) {
    const legacyOnly = assessP8ActivationBoundary({
      profile,
      handoffExact: true,
      runtimeCredentialMode: 'service-role',
    });
    assert.equal(legacyOnly.quick_path_review_eligible, false);
    assert.equal(legacyOnly.production_activation_ready, false);
    assert.equal(legacyOnly.profile_status, 'legacy-only');
  }
});

test('P8 real current catalog produces exact quick handoff on all 24 frozen cases', () => {
  const records = loadRecords();
  const pool = buildP8OfflineQuickCandidatePool(records, { now: CONTROL_NOW });
  assert.equal(CASES.length, 24);

  for (const request of CASES) {
    assert.equal(request.profile, 'quick', `non-quick frozen case ${request.id}`);
    const legacySelection = selectRecords(records, request, { now: CONTROL_NOW });
    const graph = selectP7ParityLexicalResults({
      candidates: pool,
      request,
      maxItems: request.limit,
    });
    const handoff = compareP8QuickHandoff({
      records,
      request,
      graphLegacyIds: graph.ids,
      legacySelection,
    });
    assert.equal(handoff.handoff_exact, true, `handoff drift for ${request.id}`);
  }
});
