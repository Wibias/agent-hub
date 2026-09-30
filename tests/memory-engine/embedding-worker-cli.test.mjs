import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseEmbeddingWorkerArgs,
  runEmbeddingWorker,
} from '../../memory-engine/embedding-worker-cli.mjs';

test('embedding worker CLI requires an explicit cache directory', () => {
  assert.deepEqual(
    parseEmbeddingWorkerArgs([
      '--cache-dir',
      '.cache/e5',
      '--socket-path',
      '/tmp/agent-hub-test.sock',
    ]),
    {
      cacheDir: '.cache/e5',
      socketPath: '/tmp/agent-hub-test.sock',
    },
  );

  assert.throws(
    () => parseEmbeddingWorkerArgs([]),
    /--cache-dir is required/,
  );
  assert.throws(
    () => parseEmbeddingWorkerArgs(['--unknown']),
    /unknown argument/,
  );
});

test('embedding worker opens the pinned provider offline and reports ready only after probe', async () => {
  const calls = [];
  const server = {
    close() {},
  };

  const result = await runEmbeddingWorker({
    cacheDir: '.cache/e5',
    socketPath: '/tmp/agent-hub-test.sock',
    async createEmbedder(options) {
      calls.push(['createEmbedder', options]);
      return {
        modelId: 'intfloat/multilingual-e5-small',
        modelRevision: '6a0d452a575215f80b8f66276dd4ee5d504942c6',
        dimensions: 384,
        async embedQuery(text) {
          calls.push(['probe', text]);
          return new Float32Array(384);
        },
        async embedPassages() {
          throw new Error('not used');
        },
      };
    },
    async startServer(options) {
      calls.push(['startServer', options.socketPath, options.embedder.modelId]);
      return server;
    },
    log(value) {
      calls.push(['log', JSON.parse(value)]);
    },
  });

  assert.equal(result, server);
  assert.equal(calls[0][0], 'createEmbedder');
  assert.equal(calls[0][1].allowRemoteModels, false);
  assert.match(calls[0][1].cacheDir, /\.cache[\\/]e5$/);
  assert.deepEqual(calls[1], [
    'probe',
    'memory worker readiness probe',
  ]);
  assert.deepEqual(calls[2], [
    'startServer',
    '/tmp/agent-hub-test.sock',
    'intfloat/multilingual-e5-small',
  ]);
  assert.equal(calls[3][0], 'log');
  assert.equal(calls[3][1].status, 'ready');
  assert.equal(calls[3][1].socketPath, '/tmp/agent-hub-test.sock');
  assert.equal(calls[3][1].dimensions, 384);
});
