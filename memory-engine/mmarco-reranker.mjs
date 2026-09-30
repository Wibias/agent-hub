export const MMARCO_MODEL_ID = 'SugoLabs/mmarco-mMiniLMv2-L12-H384-v1';
export const MMARCO_MODEL_REVISION = '6772eee';
export const MMARCO_MAX_LENGTH = 512;

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

async function defaultLoadTokenizer(modelId, options) {
  const { AutoTokenizer } = await import('@huggingface/transformers');
  return AutoTokenizer.from_pretrained(modelId, options);
}

async function defaultLoadModel(modelId, options) {
  const { AutoModelForSequenceClassification } = await import(
    '@huggingface/transformers'
  );
  return AutoModelForSequenceClassification.from_pretrained(modelId, options);
}

function normalizeScores(raw, expectedCount) {
  if (!Array.isArray(raw) || raw.length !== expectedCount) {
    throw new RangeError('reranker score count must match passage count');
  }

  return raw.map((row, index) => {
    const value = Array.isArray(row) ? row[0] : row;
    if (!Number.isFinite(value)) {
      throw new TypeError(`reranker score ${index} must be finite`);
    }
    if (value < 0 || value > 1) {
      throw new RangeError(`reranker score ${index} must be between 0 and 1`);
    }
    return value;
  });
}

export async function createMmarcoReranker({
  cacheDir,
  allowRemoteModels = false,
  loadTokenizer = defaultLoadTokenizer,
  loadModel = defaultLoadModel,
} = {}) {
  assertNonEmptyString(cacheDir, 'cacheDir');
  if (typeof allowRemoteModels !== 'boolean') {
    throw new TypeError('allowRemoteModels must be a boolean');
  }
  if (typeof loadTokenizer !== 'function') {
    throw new TypeError('loadTokenizer must be a function');
  }
  if (typeof loadModel !== 'function') {
    throw new TypeError('loadModel must be a function');
  }

  const shared = {
    revision: MMARCO_MODEL_REVISION,
    cache_dir: cacheDir,
    local_files_only: !allowRemoteModels,
  };

  const tokenizer = await loadTokenizer(MMARCO_MODEL_ID, shared);
  const model = await loadModel(MMARCO_MODEL_ID, {
    ...shared,
    dtype: 'q8',
    device: 'cpu',
  });

  if (typeof tokenizer !== 'function') {
    throw new TypeError('reranker tokenizer must be callable');
  }
  if (typeof model !== 'function') {
    throw new TypeError('reranker model must be callable');
  }

  return {
    modelId: MMARCO_MODEL_ID,
    modelRevision: MMARCO_MODEL_REVISION,

    async score(query, passages) {
      assertNonEmptyString(query, 'query');
      if (!Array.isArray(passages) || passages.length === 0) {
        throw new TypeError('passages must be a non-empty array');
      }
      for (const passage of passages) {
        assertNonEmptyString(passage, 'passage');
      }

      const inputs = tokenizer(
        new Array(passages.length).fill(query.trim()),
        {
          text_pair: passages.map((passage) => passage.trim()),
          padding: true,
          truncation: true,
          max_length: MMARCO_MAX_LENGTH,
        },
      );

      const output = await model(inputs);
      const sigmoid = output?.logits?.sigmoid;
      if (typeof sigmoid !== 'function') {
        throw new TypeError('reranker model output must expose logits.sigmoid()');
      }

      const probabilities = output.logits.sigmoid();
      if (!probabilities || typeof probabilities.tolist !== 'function') {
        throw new TypeError(
          'reranker sigmoid output must expose tolist()',
        );
      }

      const rows = await probabilities.tolist();
      return normalizeScores(rows, passages.length);
    },
  };
}
