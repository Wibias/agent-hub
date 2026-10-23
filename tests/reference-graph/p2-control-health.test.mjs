import assert from 'node:assert/strict';
import test from 'node:test';

function legacyRecord(id, { lastVerifiedAt, ttlDays = 90, surface = 'public-home', platform = 'web-responsive' } = {}) {
  return {
    id,
    title: `${id} reference`,
    reviewStatus: 'reviewed',
    lastVerifiedAt,
    ttlDays,
    accessStatus: 'AVAILABLE',
    surfaceFamily: surface,
    primaryStratum: 'direct-domain',
    platform,
    product: id,
    sourceFamily: id,
    pageRole: 'creator landing page',
    topology: `Hero proof CTA ${id}`,
    firstScreenJob: 'creator landing page',
    traversal: 'hero -> proof -> cta',
    responsiveBehavior: 'stack',
    motion: 'low',
    visualWorld: 'dark creator surface',
    flowStates: ['landing'],
    strengths: ['clear hierarchy'],
    weaknesses: ['generic proof'],
    transferableDecisions: ['lead with creator outcome'],
    tags: ['creator', 'landing', 'visual-verified'],
    multiStateFlow: false,
    ordinaryOrFailureProne: false,
    evidenceClass: 'OBSERVED',
  };
}

const quickRequest = {
  profile: 'quick',
  limit: 3,
  surface: 'public-home',
  platform: 'web-responsive',
  job: 'creator landing page',
  dimensions: 'visual-world',
};

test('selectRecords accepts an explicit evaluation time without changing the default call shape', async () => {
  const { selectRecords } = await import('../../knowledge/design-references/scripts/selection.mjs');
  const records = [
    legacyRecord('ref-a', { lastVerifiedAt: '2026-07-21' }),
    legacyRecord('ref-b', { lastVerifiedAt: '2026-07-21' }),
    legacyRecord('ref-c', { lastVerifiedAt: '2026-07-21' }),
  ];

  const atSnapshot = selectRecords(records, quickRequest, {
    now: new Date('2026-07-21T12:00:00Z'),
  });
  const afterExpiry = selectRecords(records, quickRequest, {
    now: new Date('2026-10-23T12:00:00Z'),
  });
  const defaultCall = selectRecords(records, quickRequest);

  assert.equal(atSnapshot.selected.length, 3);
  assert.equal(afterExpiry.selected.length, 0);
  assert.ok(Array.isArray(defaultCall.selected));
});

test('legacy control health distinguishes a healthy snapshot from a stale production-time control', async () => {
  const { assessLegacyControlHealth } = await import('../../reference-graph/shadow-eval.mjs');
  const records = [
    legacyRecord('ref-a', { lastVerifiedAt: '2026-07-21' }),
    legacyRecord('ref-b', { lastVerifiedAt: '2026-07-21' }),
    legacyRecord('ref-c', { lastVerifiedAt: '2026-07-21' }),
  ];

  const healthy = assessLegacyControlHealth({
    records,
    cases: [quickRequest],
    now: new Date('2026-07-21T12:00:00Z'),
  });
  const stale = assessLegacyControlHealth({
    records,
    cases: [quickRequest],
    now: new Date('2026-10-23T12:00:00Z'),
  });

  assert.equal(healthy.healthy, true);
  assert.equal(healthy.reviewed_accessible_count, 3);
  assert.equal(healthy.fresh_pool_count, 3);
  assert.equal(healthy.full_limit_case_count, 1);
  assert.equal(healthy.cases_with_coverage_gaps, 0);
  assert.deepEqual(healthy.blockers, []);

  assert.equal(stale.healthy, false);
  assert.equal(stale.fresh_pool_count, 0);
  assert.equal(stale.full_limit_case_count, 0);
  assert.ok(stale.cases_with_coverage_gaps > 0);
  assert.ok(stale.blockers.some((item) => /fresh pool|coverage|limit/i.test(item)));
});

test('shadow evaluation can benchmark against an explicit healthy control date and reports it', async () => {
  const { runCatalogShadowEvaluation } = await import('../../reference-graph/shadow-eval.mjs');
  const records = [
    legacyRecord('ref-a', { lastVerifiedAt: '2026-07-21' }),
    legacyRecord('ref-b', { lastVerifiedAt: '2026-07-21' }),
    legacyRecord('ref-c', { lastVerifiedAt: '2026-07-21' }),
  ];

  const result = await runCatalogShadowEvaluation({
    records,
    cases: [quickRequest],
    controlNow: new Date('2026-07-21T12:00:00Z'),
    graphRetrieve: async () => ({
      items: records.map((record) => ({
        id: `asset-${record.id}`,
        metadata: {
          legacy_id: record.id,
          surface_family: record.surfaceFamily,
          platform: record.platform,
        },
      })),
    }),
  });

  assert.equal(result.control_reference_time, '2026-07-21T12:00:00.000Z');
  assert.equal(result.control_health.healthy, true);
  assert.equal(result.rows[0].legacy_count, 3);
  assert.equal(result.rows[0].overlap_at_k, 1);
  assert.equal(result.production_source, 'legacy-control');
});
