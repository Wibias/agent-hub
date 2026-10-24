import assert from 'node:assert/strict';
import test from 'node:test';

const MODEL_TAG = 'all-minilm:22m-l6-v2-fp16';
const DIGEST_PREFIX = '1b226e2802db';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('Ollama provider pins the all-minilm tag and verifies the registry digest before embedding', async () => {
  const { OllamaEmbeddingProvider } = await import('../../reference-graph/ollama-embeddings.mjs');
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith('/api/tags')) {
      return jsonResponse({
        models: [{
          name: MODEL_TAG,
          model: MODEL_TAG,
          digest: `${DIGEST_PREFIX}${'a'.repeat(52)}`,
        }],
      });
    }
    if (url.endsWith('/api/embed')) {
      const body = JSON.parse(init.body);
      return jsonResponse({
        model: MODEL_TAG,
        embeddings: body.input.map((_, index) => Array(384).fill(index + 0.01)),
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const provider = new OllamaEmbeddingProvider({ fetchImpl });
  const result = await provider.embed(['first', 'second']);

  assert.equal(provider.modelId, `ollama/${MODEL_TAG}`);
  assert.equal(provider.modelRevision, DIGEST_PREFIX);
  assert.deepEqual(result.map((row) => row.length), [384, 384]);
  assert.equal(requests[0].url, 'http://127.0.0.1:11434/api/tags');
  assert.equal(requests[1].url, 'http://127.0.0.1:11434/api/embed');
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    model: MODEL_TAG,
    input: ['first', 'second'],
    truncate: true,
  });
});

test('Ollama provider fails closed when the local model digest does not match the pinned revision', async () => {
  const { OllamaEmbeddingProvider } = await import('../../reference-graph/ollama-embeddings.mjs');
  let embedCalls = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/api/tags')) {
      return jsonResponse({
        models: [{
          name: MODEL_TAG,
          model: MODEL_TAG,
          digest: `deadbeefdead${'b'.repeat(52)}`,
        }],
      });
    }
    if (url.endsWith('/api/embed')) embedCalls += 1;
    return jsonResponse({ embeddings: [] });
  };

  const provider = new OllamaEmbeddingProvider({ fetchImpl });
  await assert.rejects(provider.embed(['hello']), /digest.*mismatch/i);
  assert.equal(embedCalls, 0);
});

test('Ollama provider rejects malformed embedding dimensions', async () => {
  const { OllamaEmbeddingProvider } = await import('../../reference-graph/ollama-embeddings.mjs');
  const fetchImpl = async (url) => {
    if (url.endsWith('/api/tags')) {
      return jsonResponse({
        models: [{ name: MODEL_TAG, model: MODEL_TAG, digest: `${DIGEST_PREFIX}${'c'.repeat(52)}` }],
      });
    }
    return jsonResponse({ model: MODEL_TAG, embeddings: [[0.1, 0.2]] });
  };

  const provider = new OllamaEmbeddingProvider({ fetchImpl });
  await assert.rejects(provider.embed(['hello']), /384/i);
});
