import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createE5Embedder,
  E5_DIMENSIONS,
  E5_MODEL_ID,
  E5_MODEL_REVISION,
} from '../memory-engine/e5-embedder.mjs';

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

export function parsePrepareModelArgs(argv) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');

  let cacheDir = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== '--cache-dir') {
      throw new Error(`unknown argument: ${arg}`);
    }
    if (cacheDir !== null) {
      throw new Error('--cache-dir may be provided only once');
    }
    const value = argv[index + 1];
    assertNonEmptyString(value, '--cache-dir');
    cacheDir = value;
    index += 1;
  }

  if (cacheDir === null) {
    throw new Error('--cache-dir is required');
  }

  return { cacheDir };
}

export async function prepareMemoryEmbeddingModel({
  cacheDir,
  createEmbedder = createE5Embedder,
  log = console.log,
}) {
  assertNonEmptyString(cacheDir, 'cacheDir');
  if (typeof createEmbedder !== 'function') {
    throw new TypeError('createEmbedder must be a function');
  }
  if (typeof log !== 'function') {
    throw new TypeError('log must be a function');
  }

  const resolvedCacheDir = resolve(cacheDir);
  await mkdir(resolvedCacheDir, { recursive: true });

  const embedder = await createEmbedder({
    cacheDir: resolvedCacheDir,
    allowRemoteModels: true,
  });
  const vector = await embedder.embedQuery('memory cache readiness probe');
  if (!(vector instanceof Float32Array) || vector.length !== E5_DIMENSIONS) {
    throw new RangeError(
      `memory embedding readiness probe must return ${E5_DIMENSIONS} dimensions`,
    );
  }

  const result = {
    modelId: E5_MODEL_ID,
    modelRevision: E5_MODEL_REVISION,
    dimensions: E5_DIMENSIONS,
    cacheDir: resolvedCacheDir,
  };
  log(JSON.stringify(result));
  return result;
}

async function main() {
  const { cacheDir } = parsePrepareModelArgs(process.argv.slice(2));
  await prepareMemoryEmbeddingModel({ cacheDir });
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
