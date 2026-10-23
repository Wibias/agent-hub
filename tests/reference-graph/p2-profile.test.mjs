import assert from 'node:assert/strict';
import test from 'node:test';

const EXPECTED_PREFIX = 'Represent this sentence for searching relevant passages: ';

test('P2 profile pins Snowflake Arctic small and marks it experimental', async () => {
  const profile = await import('../../reference-graph/embedding-profile.mjs');

  assert.equal(profile.REFERENCE_EMBEDDING_PROFILE.id, 'snowflake-arctic-embed-33m-raw-v1');
  assert.equal(profile.REFERENCE_EMBEDDING_PROFILE.modelTag, 'snowflake-arctic-embed:33m');
  assert.equal(profile.REFERENCE_EMBEDDING_PROFILE.modelRevision, 'e8db018629b4');
  assert.equal(profile.REFERENCE_EMBEDDING_PROFILE.dimensions, 384);
  assert.equal(profile.REFERENCE_EMBEDDING_PROFILE.queryPrefix, EXPECTED_PREFIX);
  assert.equal(profile.REFERENCE_EMBEDDING_PROFILE.qualityStatus, 'experimental');
  assert.equal(profile.REFERENCE_EMBEDDING_PROFILE.cutoverApproved, false);
});

test('P2 query provider applies the retrieval prefix only to queries', async () => {
  const { createProfileQueryProvider } = await import('../../reference-graph/embedding-profile.mjs');
  const calls = [];
  const documentProvider = {
    modelId: 'ollama/snowflake-arctic-embed:33m',
    modelRevision: 'e8db018629b4',
    async embed(texts) {
      calls.push([...texts]);
      return texts.map(() => Array(384).fill(0.01));
    },
  };
  const queryProvider = createProfileQueryProvider(documentProvider);

  await queryProvider.embed(['creator landing page']);

  assert.equal(queryProvider.modelId, documentProvider.modelId);
  assert.equal(queryProvider.modelRevision, documentProvider.modelRevision);
  assert.deepEqual(calls, [[`${EXPECTED_PREFIX}creator landing page`]]);
});
