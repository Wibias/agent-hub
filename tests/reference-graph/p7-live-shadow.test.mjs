import assert from 'node:assert/strict';
import test from 'node:test';

import { ReferenceGraphSupabaseStore } from '../../reference-graph/supabase-store.mjs';
import { createP7SupabaseShadowRetriever } from '../../reference-graph/p7-live-shadow.mjs';

function response(body) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    async text() { return JSON.stringify(body); },
  };
}

function row(overrides = {}) {
  return {
    asset_id: overrides.asset_id ?? `asset-${overrides.legacy_id ?? 'base'}`,
    legacy_id: overrides.legacy_id ?? 'ref-base',
    search_text: overrides.search_text ?? '',
    product: overrides.product ?? `product-${overrides.legacy_id ?? 'base'}`,
    surface_family: overrides.surface_family ?? 'other-surface',
    platform: overrides.platform ?? 'web-responsive',
    page_role: overrides.page_role ?? 'product surface',
    motion: overrides.motion ?? 'none',
    source_family: overrides.source_family ?? `source-${overrides.legacy_id ?? 'base'}`,
    topology: overrides.topology ?? `topology-${overrides.legacy_id ?? 'base'}`,
    access_status: overrides.access_status ?? 'AVAILABLE',
    evidence_class: overrides.evidence_class ?? 'OBSERVED',
    ordinary_or_failure_prone: overrides.ordinary_or_failure_prone ?? false,
    multi_state_flow: overrides.multi_state_flow ?? false,
    tags: overrides.tags ?? [],
  };
}

test('Supabase store exposes one query-agnostic P7 full-pool method without altering older methods', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ name: url.split('/').at(-1), body: JSON.parse(init.body) });
    return response([row({ legacy_id: 'ref-a' })]);
  };
  const store = new ReferenceGraphSupabaseStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl,
  });
  const filters = {
    reference_date: '2026-10-23',
    surface_family: 'target-surface',
    platform: 'native-mobile',
  };

  const rows = await store.quickCandidatePoolP7(filters);

  assert.equal(rows.length, 1);
  assert.deepEqual(calls, [{
    name: 'reference_graph_quick_candidate_pool_p7',
    body: { p_filters: filters },
  }]);
  assert.equal(typeof store.lexicalCandidatesP6, 'function');
  assert.equal(typeof store.semanticCandidatesP6, 'function');
  assert.equal(typeof store.candidateContextP6, 'function');
});

test('P7 shadow retrieves the full pool once and returns pure-policy legacy-id order', async () => {
  const state = { calls: [] };
  const rows = [
    row({
      asset_id: 'asset-000',
      legacy_id: 'ref-z',
      surface_family: 'target-surface',
      platform: 'native-mobile',
    }),
    row({
      asset_id: 'asset-999',
      legacy_id: 'ref-a',
      surface_family: 'target-surface',
      platform: 'native-mobile',
    }),
  ];
  const store = {
    async quickCandidatePoolP7(filters) {
      state.calls.push(filters);
      return rows;
    },
  };
  const retrieve = createP7SupabaseShadowRetriever({ store });
  const request = {
    profile: 'quick',
    limit: 2,
    surface: 'target-surface',
    platform: 'native-mobile',
  };
  const filters = {
    reference_date: '2026-10-23',
    surface_family: 'target-surface',
    platform: 'native-mobile',
  };

  const bundle = await retrieve({
    request,
    query: 'this query must not be sent to the database',
    filters,
    maxItems: 2,
  });

  assert.deepEqual(state.calls, [filters]);
  assert.deepEqual(bundle.items.map((item) => item.legacy_id), ['ref-a', 'ref-z']);
  assert.deepEqual(bundle.items.map((item) => item.asset_id), ['asset-999', 'asset-000']);
  assert.deepEqual(bundle.relations, []);
  assert.equal(bundle.policy_diagnostics.candidate_count, 2);
});

test('P7 shadow preserves constructive coverage from the pure parity policy', async () => {
  const rows = [
    row({ legacy_id: 'ref-high-1', search_text: 'high score' }),
    row({ legacy_id: 'ref-high-2', search_text: 'high score' }),
    row({ legacy_id: 'ref-high-3', search_text: 'high score' }),
    row({ legacy_id: 'ref-high-4', search_text: 'high score' }),
    row({ legacy_id: 'ref-both', surface_family: 'wanted', platform: 'mobile' }),
    row({ legacy_id: 'ref-platform', platform: 'mobile' }),
  ];
  const store = { async quickCandidatePoolP7() { return rows; } };
  const retrieve = createP7SupabaseShadowRetriever({ store });

  const bundle = await retrieve({
    request: {
      profile: 'quick',
      limit: 4,
      surface: 'wanted',
      platform: 'mobile',
      job: 'high score',
    },
    filters: { reference_date: '2026-10-23' },
    maxItems: 4,
  });

  assert.equal(bundle.items.length, 4);
  assert.ok(bundle.items.some((item) => item.legacy_id === 'ref-both'));
  assert.ok(bundle.items.some((item) => item.legacy_id === 'ref-platform'));
  assert.deepEqual(bundle.policy_diagnostics.coverage.gaps, []);
});

test('P7 shadow rejects non-quick requests and missing store capability', async () => {
  assert.throws(
    () => createP7SupabaseShadowRetriever({ store: {} }),
    /quickCandidatePoolP7/i,
  );

  const retrieve = createP7SupabaseShadowRetriever({
    store: { async quickCandidatePoolP7() { return []; } },
  });
  await assert.rejects(
    () => retrieve({
      request: { profile: 'standard', limit: 4 },
      filters: { reference_date: '2026-10-23' },
      maxItems: 4,
    }),
    /quick/i,
  );
});
