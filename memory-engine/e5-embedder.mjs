export const E5_MODEL_ID = 'intfloat/multilingual-e5-small';
export const E5_MODEL_REVISION = 'fd1525a9fd15316a2d503bf26ab031a61d056e98';
export const E5_DIMENSIONS = 384;

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function prefixOnce(text, prefix, name) {
  assertNonEmptyString(text, name);
  const trimmed = text.trim();
  return trimmed.startsWith(prefix) ? trimmed : `${prefix}${trimmed}`;
}

function vectorsFromTensor(output, expectedCount) {
  if (!output || typeof output !== 'object') {
    throw new TypeError('feature extractor must return a tensor-like object');
  }
  if (!(output.data instanceof Float32Array)) {
    throw new TypeError('feature extractor tensor data must be Float32Array');
  }
  if (!Array.isArray(output.dims) || output.dims.length < 1) {
    throw new TypeError('feature extractor tensor dims must be an array');
  }
  if (output.dims.at(-1) !== E5_DIMENSIONS) {
    throw new RangeError(
      `feature extractor final dimension must be ${E5_DIMENSIONS}`,
    );
  }
  if (
    !Number.isInteger(expectedCount)
    || expectedCount < 1
    || output.data.length !== expectedCount * E5_DIMENSIONS
  ) {
    throw new RangeError('feature extractor output count does not match input count');
  }

  for (const value of output.data) {
    if (!Number.isFinite(value)) {
      throw new TypeError('feature extractor output values must be finite');
    }
  }

  const vectors = [];
  for (let index = 0; index < expectedCount; index += 1) {
    const start = index * E5_DIMENSIONS;
    vectors.push(
      new Float32Array(output.data.slice(start, start + E5_DIMENSIONS)),
    );
  }
  return vectors;
}

async function defaultPipelineFactory(task, model, options) {
  const { pipeline } = await import('@huggingface/transformers');
  return pipeline(task, model, options);
}

export async function createE5Embedder({
  cacheDir,
  allowRemoteModels = false,
  pipelineFactory = defaultPipelineFactory,
}) {
  assertNonEmptyString(cacheDir, 'cacheDir');
  if (typeof allowRemoteModels !== 'boolean') {
    throw new TypeError('allowRemoteModels must be a boolean');
  }
  if (typeof pipelineFactory !== 'function') {
    throw new TypeError('pipelineFactory must be a function');
  }

  const extractor = await pipelineFactory(
    'feature-extraction',
    E5_MODEL_ID,
    {
      revision: E5_MODEL_REVISION,
      cache_dir: cacheDir,
      local_files_only: !allowRemoteModels,
      dtype: 'fp32',
      device: 'cpu',
    },
  );
  if (typeof extractor !== 'function') {
    throw new TypeError('pipelineFactory must return a callable extractor');
  }

  return {
    modelId: E5_MODEL_ID,
    modelRevision: E5_MODEL_REVISION,
    dimensions: E5_DIMENSIONS,

    async embedQuery(rawText) {
      const input = prefixOnce(rawText, 'query: ', 'query');
      const output = await extractor(input, {
        pooling: 'mean',
        normalize: true,
      });
      return vectorsFromTensor(output, 1)[0];
    },

    async embedPassages(texts) {
      if (!Array.isArray(texts) || texts.length === 0) {
        throw new TypeError('passages must be a non-empty array');
      }
      const inputs = texts.map((text) => prefixOnce(text, 'passage: ', 'passage'));
      const output = await extractor(inputs, {
        pooling: 'mean',
        normalize: true,
      });
      return vectorsFromTensor(output, inputs.length);
    },
  };
}
