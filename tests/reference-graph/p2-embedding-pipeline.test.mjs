import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

const chunkIdA = '00000000-0000-5000-8000-0000000000a1';
const chunkIdB = '00000000-0000-5000-8000-0000000000b2';

function hash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

test('catalog embedding pipeline maps chunks to model-bound persistence rows deterministically', async () => {
  const { buildEmbeddingRows } = await import('../../reference-graph/embedding-pipeline.mjs');
  const calls = [];
  const provider = {
    modelId: 'ollama/all-minilm:22m-l6-v2-fp16',
    modelRevision: '1b226e2802db',
    async embed(texts) {
      calls.push([...texts]);
      return texts.map((_, index) => Array(384).fill(index + 0.001));
    },
  };
  const captures = [
    {
      chunks: [
        { id: chunkIdA, content: 'first chunk' },
        { id: chunkIdB, content: 'second chunk' },
      ],
    },
  ];

  const rows = await buildEmbeddingRows({ captures, provider, batchSize: 1 });

  assert.deepEqual(calls, [['first chunk'], ['second chunk']]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => ({
    chunk_id: row.chunk_id,
    model_id: row.model_id,
    model_revision: row.model_revision,
    text_hash: row.text_hash,
    dimensions: row.embedding.length,
  })), [
    {
      chunk_id: chunkIdA,
      model_id: provider.modelId,
      model_revision: provider.modelRevision,
      text_hash: hash('first chunk'),
      dimensions: 384,
    },
    {
      chunk_id: chunkIdB,
      model_id: provider.modelId,
      model_revision: provider.modelRevision,
      text_hash: hash('second chunk'),
      dimensions: 384,
    },
  ]);
});

test('catalog embedding pipeline rejects duplicate chunk ids before provider work', async () => {
  const { buildEmbeddingRows } = await import('../../reference-graph/embedding-pipeline.mjs');
  let calls = 0;
  const provider = {
    modelId: 'model',
    modelRevision: 'revision',
    async embed() {
      calls += 1;
      return [];
    },
  };

  await assert.rejects(buildEmbeddingRows({
    captures: [
      { chunks: [{ id: chunkIdA, content: 'one' }] },
      { chunks: [{ id: chunkIdA, content: 'two' }] },
    ],
    provider,
  }), /duplicate chunk id/i);
  assert.equal(calls, 0);
});

test('persistEmbeddingRows sends bounded batches through the existing store boundary', async () => {
  const { persistEmbeddingRows } = await import('../../reference-graph/embedding-pipeline.mjs');
  const batches = [];
  const store = {
    async persistEmbeddings(rows) {
      batches.push(rows.map((row) => row.chunk_id));
      return { embedding_count: rows.length };
    },
  };
  const rows = [chunkIdA, chunkIdB, '00000000-0000-5000-8000-0000000000c3'].map((chunk_id) => ({
    chunk_id,
    model_id: 'model',
    model_revision: 'revision',
    text_hash: 'a'.repeat(64),
    embedding: Array(384).fill(0.01),
  }));

  const result = await persistEmbeddingRows({ rows, store, batchSize: 2 });

  assert.deepEqual(batches, [[chunkIdA, chunkIdB], ['00000000-0000-5000-8000-0000000000c3']]);
  assert.equal(result.persisted_count, 3);
  assert.equal(result.batch_count, 2);
});
