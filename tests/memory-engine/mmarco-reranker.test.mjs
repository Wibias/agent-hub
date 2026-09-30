import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMmarcoReranker,
  MMARCO_MODEL_ID,
  MMARCO_MODEL_REVISION,
} from '../../memory-engine/mmarco-reranker.mjs';

test('mMARCO reranker loads pinned local-only tokenizer and model by default', async () => {
  const calls = [];
  const tokenizer = (queries, options) => {
    calls.push(['tokenize', queries, options]);
    return { input_ids: 'fake-inputs' };
  };
  const model = async (inputs) => {
    calls.push(['model-call', inputs]);
    return {
      logits: {
        sigmoid() {
          return {
            async tolist() {
              return [[0.9], [0.2]];
            },
          };
        },
      },
    };
  };

  const reranker = await createMmarcoReranker({
    cacheDir: 'C:/cache/reranker',
    loadTokenizer: async (modelId, options) => {
      calls.push(['load-tokenizer', modelId, options]);
      return tokenizer;
    },
    loadModel: async (modelId, options) => {
      calls.push(['load-model', modelId, options]);
      return model;
    },
  });

  assert.equal(reranker.modelId, MMARCO_MODEL_ID);
  assert.equal(reranker.modelRevision, MMARCO_MODEL_REVISION);

  const scores = await reranker.score(
    'Which database handles concurrent writers?',
    [
      'Use Postgres because concurrent writers are required.',
      'Keep audit logs for 30 days.',
    ],
  );

  assert.deepEqual(scores, [0.9, 0.2]);

  assert.deepEqual(calls[0], [
    'load-tokenizer',
    MMARCO_MODEL_ID,
    {
      revision: MMARCO_MODEL_REVISION,
      cache_dir: 'C:/cache/reranker',
      local_files_only: true,
    },
  ]);
  assert.deepEqual(calls[1], [
    'load-model',
    MMARCO_MODEL_ID,
    {
      revision: MMARCO_MODEL_REVISION,
      cache_dir: 'C:/cache/reranker',
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
      max_length: 512,
    },
  ]);
});

test('mMARCO reranker explicitly enables remote model access only when requested', async () => {
  const optionsSeen = [];
  const reranker = await createMmarcoReranker({
    cacheDir: '/cache/reranker',
    allowRemoteModels: true,
    loadTokenizer: async (_modelId, options) => {
      optionsSeen.push(options);
      return () => ({});
    },
    loadModel: async (_modelId, options) => {
      optionsSeen.push(options);
      return async () => ({
        logits: {
          sigmoid() {
            return {
              tolist() {
                return [[0.5]];
              },
            };
          },
        },
      });
    },
  });

  assert.equal(optionsSeen[0].local_files_only, false);
  assert.equal(optionsSeen[1].local_files_only, false);
  assert.deepEqual(await reranker.score('query', ['passage']), [0.5]);
});

test('mMARCO reranker rejects malformed score outputs instead of hiding provider errors', async () => {
  const reranker = await createMmarcoReranker({
    cacheDir: '/cache/reranker',
    loadTokenizer: async () => () => ({}),
    loadModel: async () => async () => ({
      logits: {
        sigmoid() {
          return {
            tolist() {
              return [[Number.NaN]];
            },
          };
        },
      },
    }),
  });

  await assert.rejects(
    reranker.score('query', ['passage']),
    /finite|score/i,
  );
});
