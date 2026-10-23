import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const sql = readFileSync(
  path.join(root, 'reference-graph/schema/002_reference_graph_rpc.sql'),
  'utf8',
);

const chunkId = '00000000-0000-5000-8000-000000000001';

test('embedding persistence is service-role-only and model revision bound', () => {
  assert.match(sql, /create or replace function public\.reference_graph_upsert_embeddings\b/i);
  assert.match(sql, /revoke all on function public\.reference_graph_upsert_embeddings/i);
  assert.match(sql, /grant execute on function public\.reference_graph_upsert_embeddings.*service_role/is);
  assert.match(sql, /model_id/i);
  assert.match(sql, /model_revision/i);
  assert.match(sql, /text_hash/i);
  assert.match(sql, /extensions\.vector/i);
});

test('store persists supplied embeddings without owning an embedding provider', async () => {
  const { ReferenceGraphSupabaseStore } = await import('../../reference-graph/supabase-store.mjs');
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ embedding_count: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const store = new ReferenceGraphSupabaseStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl,
  });
  const row = {
    chunk_id: chunkId,
    model_id: 'example-384',
    model_revision: '2026-10-23',
    text_hash: 'a'.repeat(64),
    embedding: Array(384).fill(0.01),
  };

  const result = await store.persistEmbeddings([row]);

  assert.equal(result.embedding_count, 1);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    'https://example.supabase.co/rest/v1/rpc/reference_graph_upsert_embeddings',
  );
  assert.deepEqual(JSON.parse(requests[0].init.body), { p_embeddings: [row] });
});

test('store rejects incompatible embedding dimensions before any network call', async () => {
  const { ReferenceGraphSupabaseStore } = await import('../../reference-graph/supabase-store.mjs');
  let calls = 0;
  const store = new ReferenceGraphSupabaseStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl: async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    },
  });

  await assert.rejects(
    store.persistEmbeddings([{
      chunk_id: chunkId,
      model_id: 'bad-model',
      model_revision: 'v1',
      text_hash: 'b'.repeat(64),
      embedding: [0.1, 0.2],
    }]),
    /384-number array/i,
  );
  assert.equal(calls, 0);
});
