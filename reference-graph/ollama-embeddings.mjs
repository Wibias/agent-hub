const DEFAULT_URL = 'http://127.0.0.1:11434';
export const OLLAMA_MODEL_TAG = 'all-minilm:22m-l6-v2-fp16';
export const OLLAMA_MODEL_REVISION = '1b226e2802db';
export const OLLAMA_EMBEDDING_DIMENSIONS = 384;

function normalizeUrl(value) {
  const raw = String(value ?? DEFAULT_URL).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(raw)) {
    throw new TypeError('Ollama URL must be http(s)');
  }
  return raw;
}

function requireTexts(texts) {
  if (!Array.isArray(texts)) throw new TypeError('texts must be an array');
  return texts.map((text, index) => {
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new TypeError(`texts[${index}] must be a non-empty string`);
    }
    return text;
  });
}

function validateVector(vector, index) {
  if (!Array.isArray(vector) || vector.length !== OLLAMA_EMBEDDING_DIMENSIONS) {
    throw new TypeError(`embedding[${index}] must contain exactly ${OLLAMA_EMBEDDING_DIMENSIONS} numbers`);
  }
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new TypeError(`embedding[${index}] must contain only finite numbers`);
  }
  return [...vector];
}

async function readJson(response, label) {
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const detail = typeof body === 'string' ? body : body?.error ?? response.statusText;
    throw new Error(`${label} failed (${response.status}): ${detail || 'request failed'}`);
  }
  return body;
}

export class OllamaEmbeddingProvider {
  constructor({
    url = DEFAULT_URL,
    modelTag = OLLAMA_MODEL_TAG,
    modelRevision = OLLAMA_MODEL_REVISION,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.url = normalizeUrl(url);
    this.modelTag = String(modelTag).trim();
    this.modelRevision = String(modelRevision).trim();
    if (!this.modelTag) throw new TypeError('modelTag must be non-empty');
    if (!this.modelRevision) throw new TypeError('modelRevision must be non-empty');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
    this.fetchImpl = fetchImpl;
    this.modelId = `ollama/${this.modelTag}`;
    this._verifiedDigest = null;
  }

  async verifyModel() {
    if (this._verifiedDigest) return this._verifiedDigest;
    const response = await this.fetchImpl(`${this.url}/api/tags`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    const body = await readJson(response, 'Ollama model verification');
    const models = Array.isArray(body?.models) ? body.models : [];
    const found = models.find((row) => row?.name === this.modelTag || row?.model === this.modelTag);
    if (!found) {
      throw new Error(`Ollama model ${this.modelTag} is not installed`);
    }
    const digest = String(found.digest ?? '');
    if (!digest.toLowerCase().startsWith(this.modelRevision.toLowerCase())) {
      throw new Error(
        `Ollama model digest mismatch for ${this.modelTag}: expected ${this.modelRevision}, got ${digest || 'missing'}`,
      );
    }
    this._verifiedDigest = digest;
    return digest;
  }

  async embed(texts) {
    const input = requireTexts(texts);
    if (input.length === 0) return [];
    await this.verifyModel();

    const response = await this.fetchImpl(`${this.url}/api/embed`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model: this.modelTag,
        input,
        truncate: true,
      }),
    });
    const body = await readJson(response, 'Ollama embedding request');
    const embeddings = Array.isArray(body?.embeddings) ? body.embeddings : null;
    if (!embeddings || embeddings.length !== input.length) {
      throw new Error(`Ollama returned ${embeddings?.length ?? 0} embeddings for ${input.length} inputs`);
    }
    return embeddings.map(validateVector);
  }
}
