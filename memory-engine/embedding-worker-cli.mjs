#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createE5Embedder,
  E5_DIMENSIONS,
  E5_MODEL_ID,
  E5_MODEL_REVISION,
} from './e5-embedder.mjs';
import {
  MEMORY_EMBEDDING_IPC_V1,
  defaultEmbeddingIpcPath,
  startEmbeddingIpcServer,
} from './embedding-ipc.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!nonEmpty(value)) {
    throw new Error(`${flag} requires a non-empty value`);
  }
  return value;
}

export function parseEmbeddingWorkerArgs(argv) {
  if (!Array.isArray(argv)) {
    throw new TypeError('argv must be an array');
  }

  let cacheDir = null;
  let socketPath = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--cache-dir') {
      if (cacheDir !== null) {
        throw new Error('--cache-dir may be provided only once');
      }
      cacheDir = requireValue(argv, index, '--cache-dir');
      index += 1;
      continue;
    }

    if (arg === '--socket-path') {
      if (socketPath !== null) {
        throw new Error('--socket-path may be provided only once');
      }
      socketPath = requireValue(argv, index, '--socket-path');
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  if (cacheDir === null) {
    throw new Error('--cache-dir is required');
  }

  return {
    cacheDir,
    socketPath,
  };
}

export async function runEmbeddingWorker({
  cacheDir,
  socketPath = defaultEmbeddingIpcPath(),
  createEmbedder = createE5Embedder,
  startServer = startEmbeddingIpcServer,
  log = console.log,
} = {}) {
  if (!nonEmpty(cacheDir)) {
    throw new TypeError('cacheDir must be a non-empty string');
  }
  if (!nonEmpty(socketPath)) {
    throw new TypeError('socketPath must be a non-empty string');
  }
  if (typeof createEmbedder !== 'function') {
    throw new TypeError('createEmbedder must be a function');
  }
  if (typeof startServer !== 'function') {
    throw new TypeError('startServer must be a function');
  }
  if (typeof log !== 'function') {
    throw new TypeError('log must be a function');
  }

  const resolvedCacheDir = resolve(cacheDir);
  const embedder = await createEmbedder({
    cacheDir: resolvedCacheDir,
    allowRemoteModels: false,
  });

  const readinessVector = await embedder.embedQuery(
    'memory worker readiness probe',
  );
  if (
    !(readinessVector instanceof Float32Array)
    || readinessVector.length !== E5_DIMENSIONS
  ) {
    throw new Error('embedding worker readiness probe failed');
  }

  const server = await startServer({
    socketPath,
    embedder,
  });

  log(JSON.stringify({
    status: 'ready',
    protocol: MEMORY_EMBEDDING_IPC_V1,
    pid: process.pid,
    socketPath,
    cacheDir: resolvedCacheDir,
    modelId: E5_MODEL_ID,
    modelRevision: E5_MODEL_REVISION,
    dimensions: E5_DIMENSIONS,
  }));

  return server;
}

async function main() {
  const parsed = parseEmbeddingWorkerArgs(process.argv.slice(2));
  const server = await runEmbeddingWorker({
    cacheDir: parsed.cacheDir,
    socketPath: parsed.socketPath ?? defaultEmbeddingIpcPath(),
  });

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await server.close();
    } finally {
      process.exitCode = 0;
    }
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
