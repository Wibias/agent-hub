export const QNLI_MODEL_ID = 'cross-encoder/qnli-distilroberta-base';
export const QNLI_MODEL_REVISION =
  '7dd04ee0a6040c06fb381ad7edcb8585f4d937fd';
export const QNLI_MODEL_FILE = 'model_qint8_avx512_vnni';
export const QNLI_MAX_LENGTH = 512;

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertTensor(value, name) {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`${name} must be tensor-like`);
  }
  if (!ArrayBuffer.isView(value.data)) {
    throw new TypeError(`${name}.data must be a typed array`);
  }
  if (
    !Array.isArray(value.dims)
    || value.dims.length !== 2
    || !value.dims.every((dimension) => (
      Number.isInteger(dimension) && dimension > 0
    ))
  ) {
    throw new TypeError(`${name}.dims must be [batch, width]`);
  }
  if (value.data.length !== value.dims[0] * value.dims[1]) {
    throw new RangeError(`${name} data length must match dimensions`);
  }
  return value;
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
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

export async function createQnliAnswerabilityGate({
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
    revision: QNLI_MODEL_REVISION,
    cache_dir: cacheDir,
    local_files_only: !allowRemoteModels,
  };

  const tokenizer = await loadTokenizer(QNLI_MODEL_ID, shared);
  const model = await loadModel(QNLI_MODEL_ID, {
    ...shared,
    model_file_name: QNLI_MODEL_FILE,
    dtype: 'fp32',
    device: 'cpu',
  });

  if (typeof tokenizer !== 'function') {
    throw new TypeError('QNLI tokenizer must be callable');
  }
  if (typeof model !== 'function') {
    throw new TypeError('QNLI model must be callable');
  }

  return {
    modelId: QNLI_MODEL_ID,
    modelRevision: QNLI_MODEL_REVISION,

    async score(question, passages) {
      assertNonEmptyString(question, 'question');
      if (!Array.isArray(passages) || passages.length === 0) {
        throw new TypeError('passages must be a non-empty array');
      }
      for (const passage of passages) {
        assertNonEmptyString(passage, 'passage');
      }

      const questions = new Array(passages.length).fill(question.trim());
      const inputs = tokenizer(questions, {
        text_pair: passages.map((passage) => passage.trim()),
        padding: true,
        truncation: true,
        max_length: QNLI_MAX_LENGTH,
      });

      const output = await model(inputs);
      const logits = assertTensor(output?.logits, 'logits');

      if (logits.dims[0] !== passages.length || logits.dims[1] !== 1) {
        throw new RangeError(
          'QNLI logits dimensions must be [passage_count, 1]',
        );
      }

      return Array.from(logits.data, (value, index) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          throw new TypeError(`QNLI logit ${index} must be finite`);
        }
        const score = sigmoid(numeric);
        if (!Number.isFinite(score)) {
          throw new TypeError(`QNLI score ${index} must be finite`);
        }
        return score;
      });
    },
  };
}
