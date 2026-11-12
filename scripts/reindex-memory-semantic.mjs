#!/usr/bin/env node
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createEmbeddingIpcClient,
  defaultEmbeddingIpcPath,
} from '../memory-engine/embedding-ipc.mjs';
import {
  E5_DIMENSIONS,
  E5_MODEL_ID,
  E5_MODEL_REVISION,
  createE5Embedder,
} from '../memory-engine/e5-embedder.mjs';
import { HybridMemoryRetriever } from '../memory-engine/hybrid-retrieval.mjs';
import { MemoryEngine } from '../memory-engine/index.mjs';

/**
 * The same repo-local cache selected by the standard Codex hook.
 * Model loading is offline-only; a Windows fallback never downloads weights.
 */
export function defaultSemanticOfflineCacheDir() {
  return resolve(fileURLToPath(new URL('../.cache/memory-engine/e5/', import.meta.url)));
}

export function ordinarySemanticCacheDirectory(path) {
  try {
    const stat = lstatSync(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

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

export function parseReindexSemanticArgs(argv) {
  if (!Array.isArray(argv)) {
    throw new TypeError('argv must be an array');
  }

  const parsed = {
    dbPath: null,
    projectId: null,
    branch: null,
    socketPath: null,
    cacheDir: null,
  };

  const flags = new Map([
    ['--db-path', 'dbPath'],
    ['--project-id', 'projectId'],
    ['--branch', 'branch'],
    ['--socket-path', 'socketPath'],
    ['--cache-dir', 'cacheDir'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const key = flags.get(arg);
    if (!key) {
      throw new Error(`unknown argument: ${arg}`);
    }
    if (parsed[key] !== null) {
      throw new Error(`${arg} may be provided only once`);
    }
    parsed[key] = requireValue(argv, index, arg);
    index += 1;
  }

  for (const [key, flag] of [
    ['dbPath', '--db-path'],
    ['projectId', '--project-id'],
    ['branch', '--branch'],
  ]) {
    if (parsed[key] === null) {
      throw new Error(`${flag} is required`);
    }
  }

  return parsed;
}

export async function reindexMemorySemantic({
  dbPath,
  projectId,
  branch,
  socketPath = defaultEmbeddingIpcPath(),
  cacheDir = defaultSemanticOfflineCacheDir(),
  platform = process.platform,
  offlineCacheExists = ordinarySemanticCacheDirectory,
  createOfflineEmbedder = createE5Embedder,
  createEngine = (options) => new MemoryEngine(options),
  createEmbeddingClient = createEmbeddingIpcClient,
  createHybridRetriever = (options) => new HybridMemoryRetriever(options),
  log = console.log,
} = {}) {
  for (const [value, name] of [
    [dbPath, 'dbPath'],
    [projectId, 'projectId'],
    [branch, 'branch'],
    [socketPath, 'socketPath'],
    [cacheDir, 'cacheDir'],
  ]) {
    if (!nonEmpty(value)) {
      throw new TypeError(`${name} must be a non-empty string`);
    }
  }
  if (typeof platform !== 'string') {
    throw new TypeError('platform must be a string');
  }
  if (typeof offlineCacheExists !== 'function'
    || typeof createOfflineEmbedder !== 'function') {
    throw new TypeError('offline embedding dependencies must be functions');
  }
  if (typeof createEngine !== 'function') {
    throw new TypeError('createEngine must be a function');
  }
  if (typeof createEmbeddingClient !== 'function') {
    throw new TypeError('createEmbeddingClient must be a function');
  }
  if (typeof createHybridRetriever !== 'function') {
    throw new TypeError('createHybridRetriever must be a function');
  }
  if (typeof log !== 'function') {
    throw new TypeError('log must be a function');
  }

  const memory = createEngine({
    dbPath: resolve(dbPath),
  });

  try {
    if (!memory.getProject(projectId)) {
      throw new Error(`unknown project: ${projectId}`);
    }

    let embedder;
    let readiness;
    try {
      embedder = createEmbeddingClient({
        socketPath,
        modelId: E5_MODEL_ID,
        modelRevision: E5_MODEL_REVISION,
        dimensions: E5_DIMENSIONS,
        timeoutMs: 5_000,
      });

      // Fail once up front instead of paying one connection timeout per Claim.
      readiness = await embedder.embedQuery('semantic reindex readiness probe');
    } catch (error) {
      // A Windows IPC listener without verified per-user ACL is not launched
      // by this repair. Only the *specific worker-unavailable* error may
      // use a local, pinned, offline E5 embedder in this same process.
      if (platform !== 'win32'
        || error?.message !== 'embedding worker unavailable') {
        throw error;
      }
      if (!offlineCacheExists(cacheDir)) {
        throw new Error('embedding worker unavailable; offline E5 cache missing');
      }
      try {
        embedder = await createOfflineEmbedder({
          cacheDir: resolve(cacheDir),
          allowRemoteModels: false,
        });
      } catch {
        throw new Error('offline E5 model initialization failed');
      }
      if (embedder?.modelId !== E5_MODEL_ID
        || embedder?.modelRevision !== E5_MODEL_REVISION
        || embedder?.dimensions !== E5_DIMENSIONS) {
        throw new Error('offline E5 provider identity mismatch');
      }
      try {
        readiness = await embedder.embedQuery('semantic reindex readiness probe');
      } catch {
        throw new Error('offline E5 readiness failed');
      }
    }
    if (!(readiness instanceof Float32Array)
      || readiness.length !== E5_DIMENSIONS
      || [...readiness].some(value => !Number.isFinite(value))) {
      throw new Error('embedding worker readiness failed');
    }

    const hybrid = createHybridRetriever({
      memory,
      embedder,
    });
    const documents = memory.listEmbeddingDocuments({
      projectId,
      branch,
    });

    let indexed = 0;
    let failed = 0;
    for (const document of documents) {
      try {
        const result = await hybrid.indexClaim(document.claim_id);
        if (result?.indexed === true) indexed += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }

    const result = {
      projectId,
      branch,
      candidates: documents.length,
      indexed,
      failed,
      modelId: E5_MODEL_ID,
      modelRevision: E5_MODEL_REVISION,
      dimensions: E5_DIMENSIONS,
    };
    log(JSON.stringify(result));
    return result;
  } finally {
    memory.close();
  }
}

async function main() {
  const parsed = parseReindexSemanticArgs(process.argv.slice(2));
  const result = await reindexMemorySemantic({
    dbPath: parsed.dbPath,
    projectId: parsed.projectId,
    branch: parsed.branch,
    socketPath: parsed.socketPath ?? defaultEmbeddingIpcPath(),
    cacheDir: parsed.cacheDir ?? defaultSemanticOfflineCacheDir(),
  });
  if (result.failed > 0) {
    process.exitCode = 1;
  }
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
