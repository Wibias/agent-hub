import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createQnliAnswerabilityGate,
  QNLI_MODEL_FILE,
  QNLI_MODEL_ID,
  QNLI_MODEL_REVISION,
} from '../../memory-engine/qnli-answerability.mjs';

function tensor(data, dims) {
  return { data, dims };
}

test('QNLI answerability gate loads pinned local-only qint8 CPU model and scores question-passage pairs', async () => {
  const calls = [];

  const tokenizer = (questions, options) => {
    calls.push(['tokenize', questions, options]);
    return {
      input_ids: tensor(new BigInt64Array([
        1n, 2n, 3n,
        4n, 5n, 6n,
      ]), [2, 3]),
      attention_mask: tensor(new BigInt64Array([
        1n, 1n, 1n,
        1n, 1n, 1n,
      ]), [2, 3]),
    };
  };

  const model = async (inputs) => {
    calls.push(['model-call', inputs]);
    return {
      logits: tensor(new Float32Array([4, -4]), [2, 1]),
    };
  };

  const gate = await createQnliAnswerabilityGate({
    cacheDir: 'C:/cache/qnli',
    loadTokenizer: async (modelId, options) => {
      calls.push(['load-tokenizer', modelId, options]);
      return tokenizer;
    },
    loadModel: async (modelId, options) => {
      calls.push(['load-model', modelId, options]);
      return model;
    },
  });

  assert.equal(gate.modelId, QNLI_MODEL_ID);
  assert.equal(gate.modelRevision, QNLI_MODEL_REVISION);

  const scores = await gate.score(
    'Which database handles concurrent writers?',
    [
      'Use Postgres because concurrent writers are required.',
      'Keep audit logs for 30 days.',
    ],
  );

  assert.ok(Math.abs(scores[0] - 0.9820137900379085) < 1e-12);
  assert.ok(Math.abs(scores[1] - 0.01798620996209156) < 1e-12);

  assert.deepEqual(calls[0], [
    'load-tokenizer',
    QNLI_MODEL_ID,
    {
      revision: QNLI_MODEL_REVISION,
      cache_dir: 'C:/cache/qnli',
      local_files_only: true,
    },
  ]);
  assert.deepEqual(calls[1], [
    'load-model',
    QNLI_MODEL_ID,
    {
      revision: QNLI_MODEL_REVISION,
      cache_dir: 'C:/cache/qnli',
      local_files_only: true,
      model_file_name: QNLI_MODEL_FILE,
      dtype: 'fp32',
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
      max_length: 512,
    },
  ]);
});

test('QNLI answerability gate enables remote loading only when explicitly requested', async () => {
  const optionsSeen = [];

  const gate = await createQnliAnswerabilityGate({
    cacheDir: '/cache/qnli',
    allowRemoteModels: true,
    loadTokenizer: async (_modelId, options) => {
      optionsSeen.push(options);
      return () => ({
        input_ids: tensor(new BigInt64Array([1n, 2n]), [1, 2]),
        attention_mask: tensor(new BigInt64Array([1n, 1n]), [1, 2]),
      });
    },
    loadModel: async (_modelId, options) => {
      optionsSeen.push(options);
      return async () => ({
        logits: tensor(new Float32Array([0]), [1, 1]),
      });
    },
  });

  assert.equal(optionsSeen[0].local_files_only, false);
  assert.equal(optionsSeen[1].local_files_only, false);
  assert.deepEqual(await gate.score('question', ['passage']), [0.5]);
});

test('QNLI answerability gate rejects malformed logits instead of fabricating confidence', async () => {
  const gate = await createQnliAnswerabilityGate({
    cacheDir: '/cache/qnli',
    loadTokenizer: async () => () => ({
      input_ids: tensor(new BigInt64Array([1n, 2n]), [1, 2]),
      attention_mask: tensor(new BigInt64Array([1n, 1n]), [1, 2]),
    }),
    loadModel: async () => async () => ({
      logits: tensor(new Float32Array([Number.NaN]), [1, 1]),
    }),
  });

  await assert.rejects(
    gate.score('question', ['passage']),
    /finite|logit/i,
  );
});

test('QNLI answerability gate rejects output batch mismatch', async () => {
  const gate = await createQnliAnswerabilityGate({
    cacheDir: '/cache/qnli',
    loadTokenizer: async () => () => ({
      input_ids: tensor(new BigInt64Array([
        1n, 2n,
        3n, 4n,
      ]), [2, 2]),
      attention_mask: tensor(new BigInt64Array([
        1n, 1n,
        1n, 1n,
      ]), [2, 2]),
    }),
    loadModel: async () => async () => ({
      logits: tensor(new Float32Array([1]), [1, 1]),
    }),
  });

  await assert.rejects(
    gate.score('question', ['one', 'two']),
    /batch|count|dimension/i,
  );
});
