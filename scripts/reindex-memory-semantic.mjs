#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createEmbeddingIpcClient,
  defaultEmbeddingIpcPath,
} from '../memory-engine/embedding-ipc.mjs';
import {
  E5_DIMENSIONS,
  E5_MODEL_ID,
  E5_MODEL_REVISION,
} from '../memory-engine/e5-embedder.mjs';
import { HybridMemoryRetriever } from '../memory-engine/hybrid-retrieval.mjs';
import { MemoryEngine } from '../memory-engine/index.mjs';

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
  };

  const flags = new Map([
    ['--db-path', 'dbPath'],
    ['--project-id', 'projectId'],
    ['--branch', 'branch'],
    ['--socket-path', 'socketPath'],
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
  ]) {
    if (!nonEmpty(value)) {
      throw new TypeError(`${name} must be a non-empty string`);
    }
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

    const embedder = createEmbeddingClient({
      socketPath,
      modelId: E5_MODEL_ID,
      modelRevision: E5_MODEL_REVISION,
      dimensions: E5_DIMENSIONS,
      timeoutMs: 5_000,
    });

    // Fail once, up front, if the worker is unavailable instead of paying one
    // connection timeout per Claim.
    const readiness = await embedder.embedQuery(
      'semantic reindex readiness probe',
    );
    if (
      !(readiness instanceof Float32Array)
      || readiness.length !== E5_DIMENSIONS
    ) {
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
