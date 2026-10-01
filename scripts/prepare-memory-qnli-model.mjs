import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createQnliAnswerabilityGate,
  QNLI_MODEL_ID,
  QNLI_MODEL_REVISION,
} from '../memory-engine/qnli-answerability.mjs';

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

export function parsePrepareQnliArgs(argv) {
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

export async function prepareQnliModel({
  cacheDir,
  createGate = createQnliAnswerabilityGate,
  log = console.log,
}) {
  assertNonEmptyString(cacheDir, 'cacheDir');
  if (typeof createGate !== 'function') {
    throw new TypeError('createGate must be a function');
  }
  if (typeof log !== 'function') {
    throw new TypeError('log must be a function');
  }

  const resolvedCacheDir = resolve(cacheDir);
  await mkdir(resolvedCacheDir, { recursive: true });

  const gate = await createGate({
    cacheDir: resolvedCacheDir,
    allowRemoteModels: true,
  });

  const scores = await gate.score(
    'Which database handles concurrent writers?',
    [
      'Use Postgres because concurrent writers are required.',
      'Keep audit logs for 30 days.',
    ],
  );

  if (
    !Array.isArray(scores)
    || scores.length !== 2
    || scores.some((score) => !Number.isFinite(score))
  ) {
    throw new RangeError('QNLI readiness probe returned invalid scores');
  }

  const result = {
    modelId: QNLI_MODEL_ID,
    modelRevision: QNLI_MODEL_REVISION,
    cacheDir: resolvedCacheDir,
    scores,
  };
  log(JSON.stringify(result));
  return result;
}

async function main() {
  const { cacheDir } = parsePrepareQnliArgs(process.argv.slice(2));
  await prepareQnliModel({ cacheDir });
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
