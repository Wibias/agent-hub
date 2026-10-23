import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizeReferenceCapture } from '../../reference-graph/capture.mjs';
import { loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sampleCapture() {
  return normalizeReferenceCapture({
    source: {
      canonicalUrl: 'https://example.com/reference',
      sourceKind: 'underlying-product',
      title: 'Example',
      sourceFamily: 'example',
    },
    asset: {
      kind: 'web-page',
      canonicalLocator: 'https://example.com/reference',
      title: 'Example reference',
      mediaType: 'text/html',
      capturedAt: '2026-10-23T00:00:00.000Z',
      contentText: 'Reference content',
      storagePolicy: 'text-link-only',
    },
    provenance: {
      captureMethod: 'test',
      capturedBy: 'p1-test',
      observedAt: '2026-10-23T00:00:00.000Z',
      sourceRef: 'https://example.com/reference',
    },
    tags: ['reference', 'example'],
    observations: [{
      kind: 'topology',
      body: 'Hero -> proof -> CTA',
      evidenceClass: 'OBSERVED',
    }],
  });
}

test('deterministic capture identifiers are PostgreSQL UUID compatible', () => {
  const first = sampleCapture();
  const second = sampleCapture();

  assert.deepEqual(first, second);
  assert.match(first.source.id, UUID_RE);
  assert.match(first.asset.id, UUID_RE);
  assert.match(first.chunks[0].id, UUID_RE);
  assert.match(first.observations[0].id, UUID_RE);
});

test('P1 SQL exposes only service-role RPCs and keeps exact model-bound vector retrieval', () => {
  const sql = read('reference-graph/schema/002_reference_graph_rpc.sql');

  for (const fn of [
    'reference_graph_ingest_capture',
    'reference_graph_ingest_captures',
    'reference_graph_lexical_candidates',
    'reference_graph_semantic_candidates',
    'reference_graph_candidate_context',
    'reference_graph_stats',
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\b`, 'i'));
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}.*service_role`, 'is'));
  }

  assert.match(sql, /security definer/i);
  assert.match(sql, /model_id\s*=\s*p_model_id/i);
  assert.match(sql, /model_revision\s*=\s*p_model_revision/i);
  assert.match(sql, /embedding\s*<=>/i);
  assert.doesNotMatch(sql, /grant\s+.*reference_graph.*\b(?:anon|authenticated)\b/i);
});

test('Supabase store persists through the locked RPC surface', async () => {
  const { ReferenceGraphSupabaseStore } = await import('../../reference-graph/supabase-store.mjs');
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ asset_id: sampleCapture().asset.id }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const store = new ReferenceGraphSupabaseStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl,
  });

  const capture = sampleCapture();
  const result = await store.persistCapture(capture);

  assert.equal(result.asset_id, capture.asset.id);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://example.supabase.co/rest/v1/rpc/reference_graph_ingest_capture');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers.apikey, 'service-secret');
  assert.equal(requests[0].init.headers.authorization, 'Bearer service-secret');
  assert.deepEqual(JSON.parse(requests[0].init.body), { p_capture: capture });
});

test('Supabase store retrieves lexical and semantic candidates before P0 fusion', async () => {
  const { ReferenceGraphSupabaseStore } = await import('../../reference-graph/supabase-store.mjs');
  const assetA = '00000000-0000-5000-8000-000000000001';
  const assetB = '00000000-0000-5000-8000-000000000002';
  const rpcNames = [];
  const fetchImpl = async (url) => {
    const name = url.split('/').at(-1);
    rpcNames.push(name);
    const payloads = {
      reference_graph_lexical_candidates: [
        { asset_id: assetA, rank: 1, score: 1 },
        { asset_id: assetB, rank: 2, score: 0.8 },
      ],
      reference_graph_semantic_candidates: [
        { asset_id: assetB, rank: 1, score: 0.95 },
        { asset_id: assetA, rank: 2, score: 0.9 },
      ],
      reference_graph_candidate_context: {
        assets: [
          {
            id: assetA,
            platform: 'web-responsive',
            surface_family: 'public-home',
            tags: ['landing'],
            metadata: { legacy_id: 'ref-a', platform: 'web-responsive', surface_family: 'public-home' },
          },
          {
            id: assetB,
            platform: 'web-responsive',
            surface_family: 'public-home',
            tags: ['landing'],
            metadata: { legacy_id: 'ref-b', platform: 'web-responsive', surface_family: 'public-home' },
          },
        ],
        relations: [],
      },
    };
    return new Response(JSON.stringify(payloads[name]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const store = new ReferenceGraphSupabaseStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl,
  });
  const bundle = await store.retrieve({
    query: 'creator landing page',
    embedding: Array(384).fill(0.01),
    modelId: 'test-embedding',
    modelRevision: 'v1',
    filters: { platform: 'web-responsive', surface_family: 'public-home' },
    maxItems: 2,
  });

  assert.deepEqual(rpcNames, [
    'reference_graph_lexical_candidates',
    'reference_graph_semantic_candidates',
    'reference_graph_candidate_context',
  ]);
  assert.equal(bundle.items.length, 2);
  assert.deepEqual(new Set(bundle.items.map((item) => item.id)), new Set([assetA, assetB]));
});

test('legacy catalog produces a complete 600-record deterministic import plan', async () => {
  const { planLegacyCatalogImport } = await import('../../reference-graph/catalog-import.mjs');
  const records = loadRecords();
  const plan = planLegacyCatalogImport(records);

  assert.equal(records.length, 600);
  assert.equal(plan.capture_count, 600);
  assert.equal(plan.captures.length, 600);
  assert.equal(new Set(plan.legacy_ids).size, 600);
  assert.ok(plan.captures.every((capture) => UUID_RE.test(capture.asset.id)));
  assert.ok(plan.captures.every((capture) => capture.asset.metadata.legacy_id));
});

test('legacy catalog import batches all 600 captures without dropping records', async () => {
  const { importLegacyCatalog } = await import('../../reference-graph/catalog-import.mjs');
  const batchSizes = [];
  const store = {
    persistCaptures: async (captures) => {
      batchSizes.push(captures.length);
      return { capture_count: captures.length };
    },
  };

  const result = await importLegacyCatalog({
    records: loadRecords(),
    store,
    batchSize: 50,
  });

  assert.equal(result.imported_count, 600);
  assert.equal(result.batch_count, 12);
  assert.equal(batchSizes.reduce((sum, size) => sum + size, 0), 600);
  assert.ok(batchSizes.every((size) => size > 0 && size <= 50));
});
