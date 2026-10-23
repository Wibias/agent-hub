import assert from 'node:assert/strict';
import test from 'node:test';

function vector(first, second = 0) {
  const values = Array(384).fill(0);
  values[0] = first;
  values[1] = second;
  return values;
}

function capture(id, legacyId, content, surface = 'public-home', platform = 'web-responsive') {
  const chunkId = `${id.slice(0, -1)}${id.endsWith('1') ? 'a' : id.endsWith('2') ? 'b' : 'c'}`;
  return {
    asset: {
      id,
      metadata: {
        legacy_id: legacyId,
        surface_family: surface,
        platform,
      },
    },
    chunks: [{ id: chunkId, content }],
    tags: ['reference'],
  };
}

const assetA = '00000000-0000-5000-8000-000000000001';
const assetB = '00000000-0000-5000-8000-000000000002';
const assetC = '00000000-0000-5000-8000-000000000003';

const captures = [
  capture(assetA, 'legacy-a', 'creator landing page tools'),
  capture(assetB, 'legacy-b', 'marketing homepage proof'),
  capture(assetC, 'legacy-c', 'creator dashboard layout'),
];

const embeddingRows = captures.map((item, index) => ({
  chunk_id: item.chunks[0].id,
  model_id: 'ollama/all-minilm:22m-l6-v2-fp16',
  model_revision: '1b226e2802db',
  text_hash: String(index).repeat(64),
  embedding: index === 1 ? vector(1, 0) : index === 0 ? vector(0.8, 0.2) : vector(0, 1),
}));

test('semantic retriever ranks eligible captures by cosine similarity', async () => {
  const { createOfflineEmbeddedRetriever } = await import('../../reference-graph/semantic-shadow.mjs');
  const provider = {
    modelId: 'ollama/all-minilm:22m-l6-v2-fp16',
    modelRevision: '1b226e2802db',
    async embed() { return [vector(1, 0)]; },
  };
  const retrieve = createOfflineEmbeddedRetriever({
    captures,
    embeddingRows,
    provider,
    mode: 'semantic',
  });

  const result = await retrieve({
    query: 'semantic query',
    filters: { surface_family: 'public-home', platform: 'web-responsive' },
    maxItems: 3,
  });

  assert.equal(result.items[0].metadata.legacy_id, 'legacy-b');
  assert.equal(result.retrieval_mode, 'semantic');
  assert.equal(result.semantic_enabled, true);
});

test('hybrid retriever fuses lexical and semantic ranks through the existing RRF path', async () => {
  const { createOfflineEmbeddedRetriever } = await import('../../reference-graph/semantic-shadow.mjs');
  const provider = {
    modelId: 'ollama/all-minilm:22m-l6-v2-fp16',
    modelRevision: '1b226e2802db',
    async embed() { return [vector(1, 0)]; },
  };
  const retrieve = createOfflineEmbeddedRetriever({
    captures,
    embeddingRows,
    provider,
    mode: 'hybrid',
  });

  const result = await retrieve({
    query: 'creator landing page',
    filters: { surface_family: 'public-home', platform: 'web-responsive' },
    maxItems: 3,
  });

  assert.equal(result.items[0].metadata.legacy_id, 'legacy-a');
  assert.equal(result.retrieval_mode, 'hybrid');
  assert.equal(result.semantic_enabled, true);
  assert.ok(result.items[0].retrieval_channels.lexical_rank);
  assert.ok(result.items[0].retrieval_channels.semantic_rank);
});

test('embedded retriever rejects rows from a different model revision', async () => {
  const { createOfflineEmbeddedRetriever } = await import('../../reference-graph/semantic-shadow.mjs');
  const provider = {
    modelId: 'ollama/all-minilm:22m-l6-v2-fp16',
    modelRevision: '1b226e2802db',
    async embed() { return [vector(1, 0)]; },
  };
  const badRows = embeddingRows.map((row) => ({ ...row, model_revision: 'different' }));

  assert.throws(() => createOfflineEmbeddedRetriever({
    captures,
    embeddingRows: badRows,
    provider,
    mode: 'semantic',
  }), /model revision/i);
});
