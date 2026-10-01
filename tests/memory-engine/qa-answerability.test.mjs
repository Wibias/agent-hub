import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createQaAnswerabilityGate,
  QA_ANSWERABILITY_MODEL_ID,
  QA_ANSWERABILITY_MODEL_REVISION,
} from '../../memory-engine/qa-answerability.mjs';

function tensor(data, dims) {
  return { data, dims };
}

test('QA answerability gate loads pinned local-only q8 model by default and scores null-vs-span margin', async () => {
  const calls = [];

  const tokenizer = (questions, options) => {
    calls.push(['tokenize', questions, options]);
    return {
      input_ids: tensor(new BigInt64Array([
        101n, 11n, 102n, 21n, 22n, 102n,
        101n, 11n, 102n, 31n, 32n, 102n,
      ]), [2, 6]),
      attention_mask: tensor(new BigInt64Array([
        1n, 1n, 1n, 1n, 1n, 1n,
        1n, 1n, 1n, 1n, 1n, 1n,
      ]), [2, 6]),
      token_type_ids: tensor(new BigInt64Array([
        0n, 0n, 0n, 1n, 1n, 1n,
        0n, 0n, 0n, 1n, 1n, 1n,
      ]), [2, 6]),
    };
  };
  tokenizer.cls_token_id = 101;
  tokenizer.sep_token_id = 102;
  tokenizer.pad_token_id = 0;

  const model = async (inputs) => {
    calls.push(['model-call', inputs]);
    return {
      start_logits: tensor(new Float32Array([
        3, 0, 0, 8, 1, 0,
        8, 0, 0, 3, 1, 0,
      ]), [2, 6]),
      end_logits: tensor(new Float32Array([
        3, 0, 0, 8, 1, 0,
        8, 0, 0, 3, 1, 0,
      ]), [2, 6]),
    };
  };

  const gate = await createQaAnswerabilityGate({
    cacheDir: 'C:/cache/qa',
    loadTokenizer: async (modelId, options) => {
      calls.push(['load-tokenizer', modelId, options]);
      return tokenizer;
    },
    loadModel: async (modelId, options) => {
      calls.push(['load-model', modelId, options]);
      return model;
    },
  });

  assert.equal(gate.modelId, QA_ANSWERABILITY_MODEL_ID);
  assert.equal(gate.modelRevision, QA_ANSWERABILITY_MODEL_REVISION);

  const scored = await gate.score(
    'Which database handles concurrent writers?',
    [
      'Use Postgres because concurrent writers are required.',
      'Keep audit logs for 30 days.',
    ],
  );

  assert.deepEqual(scored, [
    {
      answerabilityMargin: 10,
      bestSpanScore: 16,
      nullScore: 6,
      bestStartToken: 3,
      bestEndToken: 3,
    },
    {
      answerabilityMargin: -10,
      bestSpanScore: 6,
      nullScore: 16,
      bestStartToken: 3,
      bestEndToken: 3,
    },
  ]);

  assert.deepEqual(calls[0], [
    'load-tokenizer',
    QA_ANSWERABILITY_MODEL_ID,
    {
      revision: QA_ANSWERABILITY_MODEL_REVISION,
      cache_dir: 'C:/cache/qa',
      local_files_only: true,
    },
  ]);
  assert.deepEqual(calls[1], [
    'load-model',
    QA_ANSWERABILITY_MODEL_ID,
    {
      revision: QA_ANSWERABILITY_MODEL_REVISION,
      cache_dir: 'C:/cache/qa',
      local_files_only: true,
      dtype: 'q8',
      device: 'cpu',
    },
  ]);
  assert.deepEqual(calls[2], [
    'tokenize',
    [
      'Which database handles concurrent writers?',
      'Which database handles concurrent writers?',
    ],
    {
      text_pair: [
        'Use Postgres because concurrent writers are required.',
        'Keep audit logs for 30 days.',
      ],
      padding: true,
      truncation: true,
      max_length: 256,
    },
  ]);
});

test('QA answerability gate only permits remote model access when explicitly requested', async () => {
  const optionsSeen = [];
  const tokenizer = () => ({
    input_ids: tensor(new BigInt64Array([101n, 102n, 22n, 102n]), [1, 4]),
    attention_mask: tensor(new BigInt64Array([1n, 1n, 1n, 1n]), [1, 4]),
    token_type_ids: tensor(new BigInt64Array([0n, 0n, 1n, 1n]), [1, 4]),
  });
  tokenizer.cls_token_id = 101;
  tokenizer.sep_token_id = 102;
  tokenizer.pad_token_id = 0;

  const gate = await createQaAnswerabilityGate({
    cacheDir: '/cache/qa',
    allowRemoteModels: true,
    loadTokenizer: async (_modelId, options) => {
      optionsSeen.push(options);
      return tokenizer;
    },
    loadModel: async (_modelId, options) => {
      optionsSeen.push(options);
      return async () => ({
        start_logits: tensor(new Float32Array([0, 0, 2, 0]), [1, 4]),
        end_logits: tensor(new Float32Array([0, 0, 2, 0]), [1, 4]),
      });
    },
  });

  assert.equal(optionsSeen[0].local_files_only, false);
  assert.equal(optionsSeen[1].local_files_only, false);

  const [result] = await gate.score('question', ['context']);
  assert.equal(result.answerabilityMargin, 4);
});

test('QA answerability gate rejects malformed provider output instead of fabricating confidence', async () => {
  const tokenizer = () => ({
    input_ids: tensor(new BigInt64Array([101n, 102n, 22n, 102n]), [1, 4]),
    attention_mask: tensor(new BigInt64Array([1n, 1n, 1n, 1n]), [1, 4]),
    token_type_ids: tensor(new BigInt64Array([0n, 0n, 1n, 1n]), [1, 4]),
  });
  tokenizer.cls_token_id = 101;
  tokenizer.sep_token_id = 102;
  tokenizer.pad_token_id = 0;

  const gate = await createQaAnswerabilityGate({
    cacheDir: '/cache/qa',
    loadTokenizer: async () => tokenizer,
    loadModel: async () => async () => ({
      start_logits: tensor(new Float32Array([0, 0, Number.NaN, 0]), [1, 4]),
      end_logits: tensor(new Float32Array([0, 0, 1, 0]), [1, 4]),
    }),
  });

  await assert.rejects(
    gate.score('question', ['context']),
    /finite|logit/i,
  );
});

test('QA answerability gate requires context token boundaries', async () => {
  const tokenizer = () => ({
    input_ids: tensor(new BigInt64Array([101n, 11n, 102n]), [1, 3]),
    attention_mask: tensor(new BigInt64Array([1n, 1n, 1n]), [1, 3]),
    token_type_ids: tensor(new BigInt64Array([0n, 0n, 0n]), [1, 3]),
  });
  tokenizer.cls_token_id = 101;
  tokenizer.sep_token_id = 102;
  tokenizer.pad_token_id = 0;

  const gate = await createQaAnswerabilityGate({
    cacheDir: '/cache/qa',
    loadTokenizer: async () => tokenizer,
    loadModel: async () => async () => ({
      start_logits: tensor(new Float32Array([1, 1, 1]), [1, 3]),
      end_logits: tensor(new Float32Array([1, 1, 1]), [1, 3]),
    }),
  });

  await assert.rejects(
    gate.score('question', ['context']),
    /context token/i,
  );
});
