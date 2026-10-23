import assert from 'node:assert/strict';
import test from 'node:test';

function graphItem(id, surface = 'public-home', platform = 'web-responsive') {
  return {
    id: `asset-${id}`,
    metadata: {
      legacy_id: id,
      surface_family: surface,
      platform,
    },
  };
}

function legacyRecord(id, overrides = {}) {
  const suffix = id.replace(/^ref-/, '').toUpperCase();
  return {
    id,
    title: `${suffix} reference`,
    reviewStatus: 'reviewed',
    lastVerifiedAt: '2026-10-22',
    ttlDays: 90,
    accessStatus: 'AVAILABLE',
    surfaceFamily: 'public-home',
    primaryStratum: 'direct-domain',
    platform: 'web-responsive',
    product: suffix,
    sourceFamily: suffix.toLowerCase(),
    pageRole: 'creator landing page',
    topology: 'Hero proof CTA',
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
    ...overrides,
  };
}

test('shadow comparison reports overlap, top-1 retention, eligibility, and bounded counts', async () => {
  const { compareShadowSelection } = await import('../../reference-graph/shadow-eval.mjs');

  const row = compareShadowSelection({
    request: {
      profile: 'quick',
      limit: 4,
      surface: 'public-home',
      platform: 'web-responsive',
      job: 'creator landing page',
      dimensions: 'visual-world,topology',
    },
    legacySelected: [
      { id: 'ref-a' },
      { id: 'ref-b' },
      { id: 'ref-c' },
      { id: 'ref-d' },
    ],
    graphBundle: {
      items: [
        graphItem('ref-a'),
        graphItem('ref-c'),
        graphItem('ref-x'),
        graphItem('ref-y', 'design-system-craft'),
      ],
    },
  });

  assert.equal(row.legacy_count, 4);
  assert.equal(row.graph_count, 4);
  assert.equal(row.overlap_count, 2);
  assert.equal(row.overlap_at_k, 0.5);
  assert.equal(row.legacy_top1_retained, true);
  assert.equal(row.graph_exact_surface_rate, 0.75);
  assert.equal(row.graph_exact_platform_rate, 1);
  assert.equal(row.graph_empty, false);
});

test('shadow summary remains conservative and does not declare cutover from weak evidence', async () => {
  const { summarizeShadowEvaluation } = await import('../../reference-graph/shadow-eval.mjs');

  const summary = summarizeShadowEvaluation([
    {
      overlap_at_k: 0.75,
      legacy_top1_retained: true,
      graph_exact_surface_rate: 1,
      graph_exact_platform_rate: 1,
      graph_empty: false,
    },
    {
      overlap_at_k: 0.25,
      legacy_top1_retained: false,
      graph_exact_surface_rate: 0.5,
      graph_exact_platform_rate: 1,
      graph_empty: false,
    },
    {
      overlap_at_k: 0,
      legacy_top1_retained: false,
      graph_exact_surface_rate: 0,
      graph_exact_platform_rate: 0,
      graph_empty: true,
    },
  ]);

  assert.equal(summary.case_count, 3);
  assert.equal(summary.average_overlap_at_k, 1 / 3);
  assert.equal(summary.legacy_top1_retention_rate, 1 / 3);
  assert.equal(summary.graph_empty_rate, 1 / 3);
  assert.equal(summary.cutover_ready, false);
  assert.ok(summary.blockers.length > 0);
});

test('catalog shadow runner evaluates legacy control against injected graph retrieval without changing production selection', async () => {
  const { runCatalogShadowEvaluation } = await import('../../reference-graph/shadow-eval.mjs');

  const records = [
    legacyRecord('ref-a'),
    legacyRecord('ref-b', {
      product: 'B',
      sourceFamily: 'b',
      topology: 'Hero proof CTA',
      visualWorld: 'editorial creator surface',
      transferableDecisions: ['show proof early'],
    }),
    legacyRecord('ref-c', {
      primaryStratum: 'adjacent-domain',
      product: 'C',
      sourceFamily: 'c',
      topology: 'Hero cards CTA',
      traversal: 'hero -> cards -> cta',
      visualWorld: 'high contrast creator surface',
      transferableDecisions: ['use asymmetry'],
    }),
  ];

  const request = {
    profile: 'quick',
    limit: 3,
    surface: 'public-home',
    platform: 'web-responsive',
    job: 'creator landing page',
    dimensions: 'visual-world',
  };

  const result = await runCatalogShadowEvaluation({
    records,
    cases: [request],
    graphRetrieve: async () => ({
      items: [graphItem('ref-a'), graphItem('ref-b'), graphItem('ref-c')],
    }),
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].overlap_at_k, 1);
  assert.equal(result.summary.case_count, 1);
  assert.equal(result.production_source, 'legacy-control');
});
