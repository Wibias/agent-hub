import assert from 'node:assert/strict';
import test from 'node:test';

import { runCatalogShadowEvaluation } from '../../reference-graph/shadow-eval.mjs';
import { createSupabaseShadowRetriever } from '../../reference-graph/live-shadow.mjs';
import { ReferenceGraphSupabaseStore } from '../../reference-graph/supabase-store.mjs';
import { loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';

const MODEL_ID = 'ollama/snowflake-arctic-embed:33m';
const MODEL_REVISION = 'e8db018629b4';
const VECTOR = Array(384).fill(0.01);

function request() {
  return {
    profile: 'quick',
    limit: 3,
    surface: 'public-home',
    platform: 'web-responsive',
    job: 'creator product landing page',
    dimensions: 'ia,visual-world',
  };
}

test('shadow evaluation propagates the control date to graph retrieval filters', async () => {
  let seen = null;
  await runCatalogShadowEvaluation({
    records: loadRecords(),
    cases: [request()],
    controlNow: new Date('2026-10-23T12:00:00.000Z'),
    graphRetrieve: async (input) => {
      seen = input;
      return { items: [] };
    },
  });

  assert.equal(seen.filters.reference_date, '2026-10-23');
  assert.equal(seen.filters.platform, 'web-responsive');
  assert.equal(seen.filters.surface_family, 'public-home');
});

test('lexical hybrid and semantic live retrievers preserve reference_date unchanged', async () => {
  const calls = [];
  const store = {
    retrieve: async (input) => {
      calls.push({ method: 'retrieve', input });
      return { items: [] };
    },
    semanticCandidates: async (embedding, modelId, modelRevision, filters, limit) => {
      calls.push({ method: 'semanticCandidates', embedding, modelId, modelRevision, filters, limit });
      return [];
    },
    candidateContext: async (ids, filters) => {
      calls.push({ method: 'candidateContext', ids, filters });
      return { assets: [], relations: [] };
    },
  };
  const queryProvider = {
    embed: async () => [VECTOR],
  };
  const filters = {
    platform: 'web-responsive',
    surface_family: 'public-home',
    reference_date: '2026-10-23',
  };

  const lexical = createSupabaseShadowRetriever({ store, mode: 'lexical' });
  await lexical({ query: 'creator dashboard', filters, maxItems: 3 });

  const hybrid = createSupabaseShadowRetriever({
    store,
    queryProvider,
    mode: 'hybrid',
    modelId: MODEL_ID,
    modelRevision: MODEL_REVISION,
  });
  await hybrid({ query: 'creator dashboard', filters, maxItems: 3 });

  const semantic = createSupabaseShadowRetriever({
    store,
    queryProvider,
    mode: 'semantic',
    modelId: MODEL_ID,
    modelRevision: MODEL_REVISION,
  });
  await semantic({ query: 'creator dashboard', filters, maxItems: 3 });

  const retrievalCalls = calls.filter((row) => row.method === 'retrieve');
  assert.equal(retrievalCalls.length, 2);
  assert.ok(retrievalCalls.every((row) => row.input.filters.reference_date === '2026-10-23'));
  const semanticCall = calls.find((row) => row.method === 'semanticCandidates');
  assert.equal(semanticCall.filters.reference_date, '2026-10-23');
});

test('Supabase store records verification rows through the P4 service-only RPC', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ verification_count: 1, inserted_count: 1, duplicate_count: 0 }), { status: 200 });
  };
  const store = new ReferenceGraphSupabaseStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl,
  });
  const rows = [{ decision_hash: 'abc', legacy_id: 'ref-example', verdict: 'confirm' }];

  const result = await store.recordVerifications(rows);

  assert.equal(result.inserted_count, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://example.supabase.co/rest/v1/rpc/reference_graph_record_verifications');
  assert.deepEqual(JSON.parse(requests[0].init.body), { p_verifications: rows });
});

test('Supabase store reports exact embedding coverage for model revision and reference date', async () => {
  const requests = [];
  const expected = {
    eligible_chunk_count: 600,
    compatible_count: 599,
    missing_count: 0,
    text_hash_mismatch_count: 1,
    coverage_rate: 599 / 600,
  };
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(expected), { status: 200 });
  };
  const store = new ReferenceGraphSupabaseStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl,
  });

  const result = await store.embeddingCoverage(MODEL_ID, MODEL_REVISION, '2026-10-23');

  assert.deepEqual(result, expected);
  assert.equal(requests[0].url, 'https://example.supabase.co/rest/v1/rpc/reference_graph_embedding_coverage');
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    p_model_id: MODEL_ID,
    p_model_revision: MODEL_REVISION,
    p_reference_date: '2026-10-23',
  });
});

test('new P4 store methods retain existing credential redaction on RPC failures', async () => {
  const secret = 'p4-service-role-secret';
  const fetchImpl = async () => new Response(JSON.stringify({
    message: `backend echoed ${secret}`,
  }), { status: 500 });
  const store = new ReferenceGraphSupabaseStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: secret,
    fetchImpl,
  });

  await assert.rejects(
    () => store.embeddingCoverage(MODEL_ID, MODEL_REVISION, '2026-10-23'),
    (error) => {
      assert.equal(error.message.includes(secret), false);
      assert.match(error.message, /\[redacted\]/);
      return true;
    },
  );
});
