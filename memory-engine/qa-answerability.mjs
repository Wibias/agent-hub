export const QA_ANSWERABILITY_MODEL_ID =
  'onnx-community/all-MiniLM-L12-v2-qa-all-ONNX';
export const QA_ANSWERABILITY_MODEL_REVISION =
  '222ce933417187f06dd936952104aabfe889925c';
export const QA_ANSWERABILITY_MAX_LENGTH = 256;
export const QA_ANSWERABILITY_MAX_ANSWER_TOKENS = 32;

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
    throw new TypeError(`${name}.dims must be [batch, sequence]`);
  }
  if (value.data.length !== value.dims[0] * value.dims[1]) {
    throw new RangeError(`${name} data length must match dimensions`);
  }
  return value;
}

function numericValue(value) {
  if (typeof value === 'bigint') return Number(value);
  return Number(value);
}

function finiteLogits(tensor, name) {
  assertTensor(tensor, name);
  for (const value of tensor.data) {
    if (!Number.isFinite(Number(value))) {
      throw new TypeError(`${name} logits must be finite`);
    }
  }
  return tensor;
}

async function defaultLoadTokenizer(modelId, options) {
  const { AutoTokenizer } = await import('@huggingface/transformers');
  return AutoTokenizer.from_pretrained(modelId, options);
}

async function defaultLoadModel(modelId, options) {
  const { AutoModelForQuestionAnswering } = await import(
    '@huggingface/transformers'
  );
  return AutoModelForQuestionAnswering.from_pretrained(modelId, options);
}

function specialTokenIds(tokenizer) {
  return new Set([
    tokenizer.cls_token_id,
    tokenizer.sep_token_id,
    tokenizer.pad_token_id,
  ].filter((value) => Number.isInteger(value)));
}

function scoreRow({
  row,
  sequenceLength,
  inputIds,
  attentionMask,
  tokenTypeIds,
  startLogits,
  endLogits,
  specials,
  maxAnswerTokens,
}) {
  const offset = row * sequenceLength;
  const clsIndex = offset;
  const nullScore = (
    Number(startLogits.data[clsIndex])
    + Number(endLogits.data[clsIndex])
  );

  const contextPositions = [];
  for (let column = 0; column < sequenceLength; column += 1) {
    const index = offset + column;
    const attended = numericValue(attentionMask.data[index]) !== 0;
    const context = numericValue(tokenTypeIds.data[index]) === 1;
    const tokenId = numericValue(inputIds.data[index]);
    if (attended && context && !specials.has(tokenId)) {
      contextPositions.push(column);
    }
  }

  if (contextPositions.length === 0) {
    throw new Error('QA answerability input has no context tokens');
  }

  let bestSpanScore = Number.NEGATIVE_INFINITY;
  let bestStartToken = null;
  let bestEndToken = null;

  for (const start of contextPositions) {
    for (const end of contextPositions) {
      if (end < start) continue;
      if ((end - start + 1) > maxAnswerTokens) break;

      const startIndex = offset + start;
      const endIndex = offset + end;
      const score = (
        Number(startLogits.data[startIndex])
        + Number(endLogits.data[endIndex])
      );
      if (score > bestSpanScore) {
        bestSpanScore = score;
        bestStartToken = start;
        bestEndToken = end;
      }
    }
  }

  if (
    !Number.isFinite(nullScore)
    || !Number.isFinite(bestSpanScore)
    || bestStartToken === null
    || bestEndToken === null
  ) {
    throw new TypeError('QA answerability scores must be finite');
  }

  return {
    answerabilityMargin: bestSpanScore - nullScore,
    bestSpanScore,
    nullScore,
    bestStartToken,
    bestEndToken,
  };
}

export async function createQaAnswerabilityGate({
  cacheDir,
  allowRemoteModels = false,
  loadTokenizer = defaultLoadTokenizer,
  loadModel = defaultLoadModel,
  maxAnswerTokens = QA_ANSWERABILITY_MAX_ANSWER_TOKENS,
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
  if (!Number.isInteger(maxAnswerTokens) || maxAnswerTokens < 1) {
    throw new RangeError('maxAnswerTokens must be a positive integer');
  }

  const shared = {
    revision: QA_ANSWERABILITY_MODEL_REVISION,
    cache_dir: cacheDir,
    local_files_only: !allowRemoteModels,
  };

  const tokenizer = await loadTokenizer(
    QA_ANSWERABILITY_MODEL_ID,
    shared,
  );
  const model = await loadModel(
    QA_ANSWERABILITY_MODEL_ID,
    {
      ...shared,
      dtype: 'q8',
      device: 'cpu',
    },
  );

  if (typeof tokenizer !== 'function') {
    throw new TypeError('QA answerability tokenizer must be callable');
  }
  if (typeof model !== 'function') {
    throw new TypeError('QA answerability model must be callable');
  }

  const specials = specialTokenIds(tokenizer);

  return {
    modelId: QA_ANSWERABILITY_MODEL_ID,
    modelRevision: QA_ANSWERABILITY_MODEL_REVISION,

    async score(question, contexts) {
      assertNonEmptyString(question, 'question');
      if (!Array.isArray(contexts) || contexts.length === 0) {
        throw new TypeError('contexts must be a non-empty array');
      }
      for (const context of contexts) {
        assertNonEmptyString(context, 'context');
      }

      const questions = new Array(contexts.length).fill(question.trim());
      const inputs = tokenizer(questions, {
        text_pair: contexts.map((context) => context.trim()),
        padding: true,
        truncation: true,
        max_length: QA_ANSWERABILITY_MAX_LENGTH,
      });

      const inputIds = assertTensor(inputs?.input_ids, 'input_ids');
      const attentionMask = assertTensor(
        inputs?.attention_mask,
        'attention_mask',
      );
      const tokenTypeIds = assertTensor(
        inputs?.token_type_ids,
        'token_type_ids',
      );

      const [batchSize, sequenceLength] = inputIds.dims;
      if (batchSize !== contexts.length) {
        throw new RangeError('tokenizer batch size must match context count');
      }
      for (const [tensor, name] of [
        [attentionMask, 'attention_mask'],
        [tokenTypeIds, 'token_type_ids'],
      ]) {
        if (
          tensor.dims[0] !== batchSize
          || tensor.dims[1] !== sequenceLength
        ) {
          throw new RangeError(`${name} dimensions must match input_ids`);
        }
      }

      const output = await model(inputs);
      const startLogits = finiteLogits(
        output?.start_logits,
        'start_logits',
      );
      const endLogits = finiteLogits(
        output?.end_logits,
        'end_logits',
      );

      for (const [tensor, name] of [
        [startLogits, 'start_logits'],
        [endLogits, 'end_logits'],
      ]) {
        if (
          tensor.dims[0] !== batchSize
          || tensor.dims[1] !== sequenceLength
        ) {
          throw new RangeError(
            `${name} dimensions must match tokenized input`,
          );
        }
      }

      const results = [];
      for (let row = 0; row < batchSize; row += 1) {
        results.push(scoreRow({
          row,
          sequenceLength,
          inputIds,
          attentionMask,
          tokenTypeIds,
          startLogits,
          endLogits,
          specials,
          maxAnswerTokens,
        }));
      }
      return results;
    },
  };
}
