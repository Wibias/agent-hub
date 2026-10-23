import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function asset(id) {
  return {
    id,
    metadata: {
      legacy_id: id,
      surface_family: 'landing-page',
      platform: 'web-responsive',
    },
    surface_family: 'landing-page',
    platform: 'web-responsive',
  };
}

function fakeStore() {
  const state = {
    lexicalCalls: 0,
    semanticCalls: 0,
    contextCalls: 0,
    retrieveCalls: 0,
  };
  return {
    state,
    async lexicalCandidates() {
      state.lexicalCalls += 1;
      return [{ asset_id: 'lexical-1', rank: 1, score: 1 }];
    },
    async semanticCandidates() {
      state.semanticCalls += 1;
      return [{ asset_id: 'semantic-1', rank: 1, score: 0.9 }];
    },
    async candidateContext(ids) {
      state.contextCalls += 1;
      return { assets: ids.map(asset), relations: [] };
    },
    async retrieve({ embedding }) {
      state.retrieveCalls += 1;
      state.lexicalCalls += 1;
      if (embedding) state.semanticCalls += 1;
      return { items: [asset(embedding ? 'hybrid-1' : 'lexical-1')] };
    },
  };
}

const queryProvider = {
  modelId: 'ollama/snowflake-arctic-embed:33m',
  modelRevision: 'e8db018629b4',
  async embed(texts) {
    return texts.map(() => Array(384).fill(0.01));
  },
};

test('P3 deployed semantic mode queries only the model-bound semantic RPC before P0 fusion', async () => {
  const { createSupabaseShadowRetriever } = await import('../../reference-graph/live-shadow.mjs');
  const store = fakeStore();
  const retrieve = createSupabaseShadowRetriever({
    store,
    queryProvider,
    mode: 'semantic',
    modelId: queryProvider.modelId,
    modelRevision: queryProvider.modelRevision,
  });

  const bundle = await retrieve({
    query: 'creator landing page',
    filters: { surface_family: 'landing-page', platform: 'web-responsive' },
    maxItems: 4,
  });

  assert.equal(store.state.lexicalCalls, 0);
  assert.equal(store.state.semanticCalls, 1);
  assert.equal(store.state.contextCalls, 1);
  assert.equal(bundle.items[0].metadata.legacy_id, 'semantic-1');
});

test('P3 deployed hybrid mode uses the existing Supabase store fusion path', async () => {
  const { createSupabaseShadowRetriever } = await import('../../reference-graph/live-shadow.mjs');
  const store = fakeStore();
  const retrieve = createSupabaseShadowRetriever({
    store,
    queryProvider,
    mode: 'hybrid',
    modelId: queryProvider.modelId,
    modelRevision: queryProvider.modelRevision,
  });

  const bundle = await retrieve({
    query: 'creator landing page',
    filters: {},
    maxItems: 4,
  });

  assert.equal(store.state.retrieveCalls, 1);
  assert.equal(store.state.lexicalCalls, 1);
  assert.equal(store.state.semanticCalls, 1);
  assert.equal(bundle.items[0].metadata.legacy_id, 'hybrid-1');
});

test('P3 embedding availability probe is exact-model bound and distinguishes unavailable from failure', async () => {
  const { probeCompatibleEmbeddings } = await import('../../reference-graph/live-shadow.mjs');
  const calls = [];
  const emptyStore = {
    async semanticCandidates(embedding, modelId, modelRevision, filters, limit) {
      calls.push({ embedding, modelId, modelRevision, filters, limit });
      return [];
    },
  };

  const unavailable = await probeCompatibleEmbeddings({
    store: emptyStore,
    queryProvider,
    modelId: queryProvider.modelId,
    modelRevision: queryProvider.modelRevision,
  });
  assert.deepEqual(unavailable, {
    status: 'unavailable',
    model_id: queryProvider.modelId,
    model_revision: queryProvider.modelRevision,
    candidate_count: 0,
  });
  assert.equal(calls[0].modelId, queryProvider.modelId);
  assert.equal(calls[0].modelRevision, queryProvider.modelRevision);
  assert.deepEqual(calls[0].filters, {});
  assert.equal(calls[0].limit, 1);

  const available = await probeCompatibleEmbeddings({
    store: {
      async semanticCandidates() {
        return [{ asset_id: 'one' }];
      },
    },
    queryProvider,
    modelId: queryProvider.modelId,
    modelRevision: queryProvider.modelRevision,
  });
  assert.equal(available.status, 'available');
  assert.equal(available.candidate_count, 1);

  await assert.rejects(
    probeCompatibleEmbeddings({
      store: {
        async semanticCandidates() {
          throw new Error('rpc exploded');
        },
      },
      queryProvider,
      modelId: queryProvider.modelId,
      modelRevision: queryProvider.modelRevision,
    }),
    /rpc exploded/,
  );
});

test('P3 shadow CLI exposes bound Supabase semantic and hybrid modes without changing production control', () => {
  const cliPath = fileURLToPath(new URL('../../reference-graph/cli/shadow-design-references.mjs', import.meta.url));
  const source = readFileSync(cliPath, 'utf8');

  assert.match(source, /--supabase-semantic/);
  assert.match(source, /--supabase-hybrid/);
  assert.match(source, /--target/);
  assert.match(source, /createSupabaseShadowRetriever/);
  assert.match(source, /probeCompatibleEmbeddings/);
  assert.match(source, /legacy-control/);
});
