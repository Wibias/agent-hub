import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MEMORY_EMBEDDING_IPC_V1,
  createEmbeddingIpcClient,
  defaultEmbeddingIpcPath,
  startEmbeddingIpcServer,
} from '../../memory-engine/embedding-ipc.mjs';

function vector(seed, dimensions = 3) {
  return Float32Array.from(
    { length: dimensions },
    (_, index) => seed + index,
  );
}

test('embedding IPC uses a local named pipe on Windows', () => {
  assert.equal(
    defaultEmbeddingIpcPath({
      platform: 'win32',
      env: {},
      tmpDir: 'C:\\Temp',
      uid: null,
    }),
    '\\\\.\\pipe\\agent-hub-memory-embedding-v1',
  );
});

test('embedding IPC client round-trips query and passage vectors', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-embedding-ipc-'));
  const socketPath = join(root, 'embedding.sock');
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const calls = [];
  const embedder = {
    modelId: 'test/model',
    modelRevision: 'test-revision',
    dimensions: 3,
    async embedQuery(text) {
      calls.push(['query', text]);
      return vector(1);
    },
    async embedPassages(texts) {
      calls.push(['passages', texts]);
      return texts.map((_, index) => vector(index + 10));
    },
  };

  const server = await startEmbeddingIpcServer({
    socketPath,
    embedder,
  });
  t.after(() => server.close());

  const stat = await lstat(socketPath);
  assert.equal(stat.mode & 0o777, 0o600);

  const client = createEmbeddingIpcClient({
    socketPath,
    modelId: embedder.modelId,
    modelRevision: embedder.modelRevision,
    dimensions: embedder.dimensions,
    timeoutMs: 1_000,
  });

  assert.deepEqual(
    [...await client.embedQuery('parallel writers')],
    [1, 2, 3],
  );
  assert.deepEqual(
    (await client.embedPassages(['alpha', 'beta'])).map((item) => [...item]),
    [[10, 11, 12], [11, 12, 13]],
  );
  assert.deepEqual(calls, [
    ['query', 'parallel writers'],
    ['passages', ['alpha', 'beta']],
  ]);
  assert.equal(client.modelId, 'test/model');
  assert.equal(client.modelRevision, 'test-revision');
  assert.equal(client.dimensions, 3);
  assert.equal(MEMORY_EMBEDDING_IPC_V1, 'memory.embedding.v1');
});

test('embedding IPC client rejects unavailable workers instead of hanging', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-embedding-ipc-missing-'));
  const socketPath = join(root, 'missing.sock');

  try {
    const client = createEmbeddingIpcClient({
      socketPath,
      modelId: 'test/model',
      modelRevision: 'test-revision',
      dimensions: 3,
      timeoutMs: 50,
    });

    await assert.rejects(
      client.embedQuery('fallback please'),
      /embedding worker unavailable/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('embedding IPC rejects model identity mismatches', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-embedding-ipc-model-'));
  const socketPath = join(root, 'embedding.sock');
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const server = await startEmbeddingIpcServer({
    socketPath,
    embedder: {
      modelId: 'server/model',
      modelRevision: 'server-revision',
      dimensions: 3,
      async embedQuery() {
        return vector(1);
      },
      async embedPassages(texts) {
        return texts.map(() => vector(1));
      },
    },
  });
  t.after(() => server.close());

  const client = createEmbeddingIpcClient({
    socketPath,
    modelId: 'different/model',
    modelRevision: 'server-revision',
    dimensions: 3,
    timeoutMs: 1_000,
  });

  await assert.rejects(
    client.embedQuery('query'),
    /embedding worker model identity mismatch/i,
  );
});


test('a second Unix worker cannot replace an active socket', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-embedding-ipc-active-'));
  const socketPath = join(root, 'embedding.sock');
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const embedder = {
    modelId: 'test/model',
    modelRevision: 'test-revision',
    dimensions: 3,
    async embedQuery() {
      return vector(1);
    },
    async embedPassages(texts) {
      return texts.map(() => vector(1));
    },
  };

  const first = await startEmbeddingIpcServer({
    socketPath,
    embedder,
    platform: 'linux',
  });
  t.after(() => first.close());

  await assert.rejects(
    startEmbeddingIpcServer({
      socketPath,
      embedder,
      platform: 'linux',
    }),
    /already running/i,
  );

  const client = createEmbeddingIpcClient({
    socketPath,
    modelId: embedder.modelId,
    modelRevision: embedder.modelRevision,
    dimensions: embedder.dimensions,
    timeoutMs: 1_000,
  });
  assert.deepEqual([...await client.embedQuery('still alive')], [1, 2, 3]);
});
