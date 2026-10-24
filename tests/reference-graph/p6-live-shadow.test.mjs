import assert from 'node:assert/strict';
import test from 'node:test';

import { ReferenceGraphSupabaseStore } from '../../reference-graph/supabase-store.mjs';
import { createP6SupabaseShadowRetriever } from '../../reference-graph/p6-live-shadow.mjs';

function response(body) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    async text() {
      return JSON.stringify(body);
    },
  };
}

function graphAsset(id, {
  legacyId = id,
  product = id,
  surface = 'other-surface',
  platform = 'web-responsive',
  sourceFamily = `source-${id}`,
  topology = `topology-${id}`,
} = {}) {
  return {
    id,
    metadata: {
      legacy_id: legacyId,
      product,
      surface_family: surface,
      platform,
    },
    surface_family: surface,
    platform,
    source_family: sourceFamily,
    topology,
  };
}

const vector = Array(384).fill(0.01);
const modelId = 'ollama/snowflake-arctic-embed:33m';
const modelRevision = 'e8db018629b4';

const quickRequest = {
  profile: 'quick',
  surface: 'target-surface',
  platform: 'native-mobile',
  limit: 4,
};

const queryProvider = {
  async embed(texts) {
    assert.deepEqual(texts, ['creator mobile landing']);
    return [vector];
  },
};

test('Supabase store exposes versioned P6 RPC methods without altering P5 methods', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const name = url.split('/').at(-1);
    const body = JSON.parse(init.body);
    calls.push({ name, body });
    if (name === 'reference_graph_candidate_context_p6') {
      return response({ assets: [graphAsset('a')], relations: [] });
    }
    return response([{ asset_id: 'a', rank: 1, score: 1 }]);
  };
  const store = new ReferenceGraphSupabaseStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl,
  });
  const filters = {
    surface_family: 'target-surface',
    platform: 'native-mobile',
    reference_date: '2026-10-23',
  };

  await store.lexicalCandidatesP6('creator mobile landing', filters, 24);
  await store.semanticCandidatesP6(vector, modelId, modelRevision, filters, 24);
  await store.candidateContextP6(['a', 'a'], filters);

  assert.deepEqual(calls.map((call) => call.name), [
    'reference_graph_lexical_candidates_p6',
    'reference_graph_semantic_candidates_p6',
    'reference_graph_candidate_context_p6',
  ]);
  assert.deepEqual(calls[0].body, {
    p_query: 'creator mobile landing',
    p_filters: filters,
    p_limit: 24,
  });
  assert.equal(calls[1].body.p_model_id, modelId);
  assert.equal(calls[1].body.p_model_revision, modelRevision);
  assert.deepEqual(calls[1].body.p_filters, filters);
  assert.equal(calls[1].body.p_limit, 24);
  assert.equal(calls[1].body.p_embedding_text.startsWith('['), true);
  assert.deepEqual(calls[2].body, { p_asset_ids: ['a'], p_filters: filters });
  assert.equal(typeof store.lexicalCandidates, 'function');
  assert.equal(typeof store.semanticCandidates, 'function');
  assert.equal(typeof store.candidateContext, 'function');
});

function fakeStore() {
  const assets = [
    graphAsset('l1', { surface: 'target-surface', platform: 'native-mobile' }),
    graphAsset('l2', { platform: 'native-mobile' }),
    graphAsset('l3'),
    graphAsset('l4'),
    graphAsset('s1'),
  ];
  const state = { lexical: [], semantic: [], context: [] };
  return {
    state,
    async lexicalCandidatesP6(query, filters, limit) {
      state.lexical.push({ query, filters, limit });
      return [
        { asset_id: 'l1', rank: 1, score: 5 },
        { asset_id: 'l2', rank: 2, score: 4 },
        { asset_id: 'l3', rank: 3, score: 3 },
        { asset_id: 'l4', rank: 4, score: 2 },
      ];
    },
    async semanticCandidatesP6(embedding, id, revision, filters, limit) {
      state.semantic.push({ embedding, id, revision, filters, limit });
      return [
        { asset_id: 's1', rank: 1, score: 0.99 },
        { asset_id: 'l4', rank: 2, score: 0.8 },
      ];
    },
    async candidateContextP6(ids, filters) {
      state.context.push({ ids, filters });
      return { assets: assets.filter((entry) => ids.includes(entry.id)), relations: [] };
    },
  };
}

test('P6 lexical shadow uses only versioned lexical candidates and the pure lexical policy', async () => {
  const store = fakeStore();
  let queryEmbeddings = 0;
  const retrieve = createP6SupabaseShadowRetriever({
    store,
    mode: 'lexical',
    queryProvider: { async embed() { queryEmbeddings += 1; return [vector]; } },
    candidateLimit: 24,
  });
  const filters = { surface_family: 'target-surface', platform: 'native-mobile', reference_date: '2026-10-23' };

  const bundle = await retrieve({
    request: quickRequest,
    query: 'creator mobile landing',
    filters,
    maxItems: 4,
  });

  assert.equal(queryEmbeddings, 0);
  assert.equal(store.state.lexical.length, 1);
  assert.equal(store.state.semantic.length, 0);
  assert.deepEqual(store.state.lexical[0], { query: 'creator mobile landing', filters, limit: 24 });
  assert.deepEqual(bundle.items.map((item) => item.id), ['l1', 'l2', 'l3', 'l4']);
  assert.equal(bundle.policy_diagnostics.coverage.feasible, true);
});

test('P6 semantic diagnostic uses exact model binding and constructive semantic policy', async () => {
  const store = fakeStore();
  const retrieve = createP6SupabaseShadowRetriever({
    store,
    mode: 'semantic',
    queryProvider,
    modelId,
    modelRevision,
    candidateLimit: 24,
  });

  const bundle = await retrieve({
    request: { ...quickRequest, surface: undefined, platform: undefined },
    query: 'creator mobile landing',
    filters: { reference_date: '2026-10-23' },
    maxItems: 2,
  });

  assert.equal(store.state.lexical.length, 0);
  assert.equal(store.state.semantic.length, 1);
  assert.equal(store.state.semantic[0].id, modelId);
  assert.equal(store.state.semantic[0].revision, modelRevision);
  assert.equal(store.state.semantic[0].limit, 24);
  assert.deepEqual(bundle.items.map((item) => item.id), ['s1', 'l4']);
});

test('P6 guarded hybrid keeps lexical results when lexical can fill request and coverage', async () => {
  const store = fakeStore();
  const retrieve = createP6SupabaseShadowRetriever({
    store,
    mode: 'hybrid',
    queryProvider,
    modelId,
    modelRevision,
    candidateLimit: 24,
  });

  const bundle = await retrieve({
    request: quickRequest,
    query: 'creator mobile landing',
    filters: { surface_family: 'target-surface', platform: 'native-mobile', reference_date: '2026-10-23' },
    maxItems: 4,
  });

  assert.equal(store.state.lexical.length, 1);
  assert.equal(store.state.semantic.length, 1);
  assert.equal(bundle.items.some((item) => item.id === 's1'), false);
  assert.deepEqual(bundle.items.map((item) => item.id), ['l1', 'l2', 'l3', 'l4']);
  assert.equal(bundle.policy_diagnostics.selected_counts.semantic_only, 0);
});

test('P6 retriever requires request profile and exact semantic identity', () => {
  const store = fakeStore();
  assert.throws(
    () => createP6SupabaseShadowRetriever({ store, mode: 'semantic', queryProvider }),
    /modelId/i,
  );
  assert.throws(
    () => createP6SupabaseShadowRetriever({ store, mode: 'hybrid', queryProvider, modelId }),
    /modelRevision/i,
  );
});
