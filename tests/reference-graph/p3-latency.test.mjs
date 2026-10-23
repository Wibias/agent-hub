import assert from 'node:assert/strict';
import test from 'node:test';

function row(overrides = {}) {
  return {
    comparable: true,
    legacy_empty: false,
    overlap_at_k: 0.5,
    legacy_top1_retained: true,
    graph_exact_surface_rate: 1,
    graph_exact_platform_rate: 1,
    graph_empty: false,
    ...overrides,
  };
}

function legacyRecord(id) {
  return {
    id,
    title: `${id} reference`,
    reviewStatus: 'reviewed',
    lastVerifiedAt: '2026-10-22',
    ttlDays: 90,
    accessStatus: 'AVAILABLE',
    surfaceFamily: 'public-home',
    primaryStratum: 'direct-domain',
    platform: 'web-responsive',
    product: id,
    sourceFamily: id,
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
  };
}

function graphItem(id) {
  return {
    id: `asset-${id}`,
    metadata: {
      legacy_id: id,
      surface_family: 'public-home',
      platform: 'web-responsive',
    },
  };
}

test('P3 latency summary uses deterministic nearest-rank percentiles without changing quality metrics', async () => {
  const { summarizeShadowEvaluation } = await import('../../reference-graph/shadow-eval.mjs');
  const rows = [
    row({ graph_latency_ms: 10, overlap_at_k: 0.75 }),
    row({ graph_latency_ms: 20, overlap_at_k: 0.25, legacy_top1_retained: false, graph_exact_surface_rate: 0.5 }),
    row({ graph_latency_ms: 100, overlap_at_k: 0, legacy_top1_retained: false, graph_exact_surface_rate: 0, graph_exact_platform_rate: 0, graph_empty: true }),
  ];

  const summary = summarizeShadowEvaluation(rows);
  assert.deepEqual(summary.latency_ms, {
    min: 10,
    p50: 20,
    p95: 100,
    max: 100,
    average: 130 / 3,
  });
  assert.equal(summary.case_count, 3);
  assert.equal(summary.comparable_case_count, 3);
  assert.equal(summary.average_overlap_at_k, 1 / 3);
  assert.equal(summary.legacy_top1_retention_rate, 1 / 3);
  assert.equal(summary.graph_empty_rate, 1 / 3);
  assert.equal(summary.average_exact_surface_rate, 0.5);
  assert.equal(summary.average_exact_platform_rate, 2 / 3);
});

test('P3 latency summary ignores invalid values and returns null fields when none are usable', async () => {
  const { summarizeShadowEvaluation } = await import('../../reference-graph/shadow-eval.mjs');

  const partial = summarizeShadowEvaluation([
    row({ graph_latency_ms: -1 }),
    row({ graph_latency_ms: Number.NaN }),
    row({ graph_latency_ms: 12 }),
  ]);
  assert.deepEqual(partial.latency_ms, {
    min: 12,
    p50: 12,
    p95: 12,
    max: 12,
    average: 12,
  });

  const empty = summarizeShadowEvaluation([
    row({ graph_latency_ms: -1 }),
    row({ graph_latency_ms: undefined }),
  ]);
  assert.deepEqual(empty.latency_ms, {
    min: null,
    p50: null,
    p95: null,
    max: null,
    average: null,
  });
});

test('P3 catalog shadow runner records per-case latency from an injected monotonic clock', async () => {
  const { runCatalogShadowEvaluation } = await import('../../reference-graph/shadow-eval.mjs');
  const records = [legacyRecord('ref-a')];
  const cases = [{
    profile: 'quick',
    limit: 1,
    surface: 'public-home',
    platform: 'web-responsive',
    job: 'creator landing page',
    dimensions: 'visual-world',
  }];
  const ticks = [100, 137];

  const result = await runCatalogShadowEvaluation({
    records,
    cases,
    graphRetrieve: async () => ({ items: [graphItem('ref-a')] }),
    nowMs: () => ticks.shift(),
  });

  assert.equal(result.rows[0].graph_latency_ms, 37);
  assert.deepEqual(result.summary.latency_ms, {
    min: 37,
    p50: 37,
    p95: 37,
    max: 37,
    average: 37,
  });
  assert.equal(result.rows[0].overlap_at_k, 1);
  assert.equal(result.production_source, 'legacy-control');
});
