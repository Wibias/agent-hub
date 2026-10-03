#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  mkdir,
  open,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { memoryRestoreLocked } from '../memory-engine/memory-maintenance-lock.mjs';
import {
  resolveMemoryCandidateJudgeRuntime,
} from './judge-memory-candidates.mjs';
import {
  runMemoryCandidatePipelineCli,
} from './process-memory-candidates.mjs';

const DEFAULT_STALE_LOCK_MS = 60 * 60 * 1000;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInt(value, name, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(name + ' must be an integer between 1 and ' + max);
  }
  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!nonEmpty(value)) throw new Error(flag + ' requires a value');
  return value;
}

export function parseMemoryCandidatePipelineWorkerArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');

  const parsed = {
    cwd: null,
    dbPath: null,
    limit: 20,
    maxRounds: 5,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      parsed.cwd = resolve(requireValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--db-path') {
      parsed.dbPath = resolve(requireValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--limit') {
      parsed.limit = positiveInt(
        requireValue(argv, index, arg),
        '--limit',
        20,
      );
      index += 1;
      continue;
    }
    if (arg === '--max-rounds') {
      parsed.maxRounds = positiveInt(
        requireValue(argv, index, arg),
        '--max-rounds',
        20,
      );
      index += 1;
      continue;
    }
    throw new Error('unknown argument: ' + arg);
  }

  if (parsed.cwd === null) throw new Error('--cwd is required');
  if (parsed.dbPath === null) throw new Error('--db-path is required');
  return parsed;
}

export function memoryCandidatePipelineLockPath(runtime) {
  if (!runtime || !nonEmpty(runtime.dbPath)) {
    throw new TypeError('runtime.dbPath must be a non-empty string');
  }
  if (!nonEmpty(runtime.projectId) || !nonEmpty(runtime.branch)) {
    throw new TypeError('runtime projectId and branch must be non-empty');
  }

  const key = createHash('sha256')
    .update(runtime.projectId, 'utf8')
    .update('\0', 'utf8')
    .update(runtime.branch, 'utf8')
    .digest('hex')
    .slice(0, 16);

  return join(
    dirname(resolve(runtime.dbPath)),
    'candidate-pipeline-' + key + '.lock',
  );
}

async function openNewLock(lockFile, now) {
  await mkdir(dirname(lockFile), { recursive: true });
  const file = await open(lockFile, 'wx');
  try {
    await file.writeFile(JSON.stringify({
      pid: process.pid,
      createdAt: new Date(now()).toISOString(),
    }));
  } catch (error) {
    await file.close();
    await rm(lockFile, { force: true });
    throw error;
  }
  return { path: lockFile, file };
}

export async function acquireMemoryCandidatePipelineLock(lockFile, {
  staleAfterMs = DEFAULT_STALE_LOCK_MS,
  now = Date.now,
} = {}) {
  if (!nonEmpty(lockFile)) {
    throw new TypeError('lockFile must be a non-empty string');
  }
  if (!Number.isInteger(staleAfterMs) || staleAfterMs < 1) {
    throw new RangeError('staleAfterMs must be a positive integer');
  }

  const resolved = resolve(lockFile);
  try {
    return await openNewLock(resolved, now);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  let metadata;
  try {
    metadata = await stat(resolved);
  } catch (error) {
    if (error?.code === 'ENOENT') return openNewLock(resolved, now);
    throw error;
  }

  if ((now() - metadata.mtimeMs) <= staleAfterMs) return null;

  await rm(resolved, { force: true });
  try {
    return await openNewLock(resolved, now);
  } catch (error) {
    if (error?.code === 'EEXIST') return null;
    throw error;
  }
}

export async function releaseMemoryCandidatePipelineLock(lock) {
  if (!lock?.file || !nonEmpty(lock.path)) {
    throw new TypeError('lock handle is invalid');
  }
  await lock.file.close();
  await rm(lock.path, { force: true });
}

function automaticReady(status) {
  return (
    Number(status?.importance_ready ?? 0)
    + Number(status?.relation_ready ?? 0)
    + Number(status?.promotion_ready ?? 0)
  );
}

export async function runMemoryCandidatePipelineWorker({
  cwd,
  dbPath,
  limit = 20,
  maxRounds = 5,
  resolveRuntime = resolveMemoryCandidateJudgeRuntime,
  runPipeline = runMemoryCandidatePipelineCli,
  restoreLocked = memoryRestoreLocked,
  acquireLock = acquireMemoryCandidatePipelineLock,
  releaseLock = releaseMemoryCandidatePipelineLock,
  log = console.log,
} = {}) {
  if (typeof resolveRuntime !== 'function') {
    throw new TypeError('resolveRuntime must be a function');
  }
  if (typeof runPipeline !== 'function') {
    throw new TypeError('runPipeline must be a function');
  }

  const runtime = resolveRuntime({ cwd, dbPath });
  const lockPath = memoryCandidatePipelineLockPath(runtime);
  const lock = await acquireLock(lockPath);
  if (lock === null) {
    return {
      type: 'agent_hub_memory_candidate_pipeline_worker',
      status: 'already_running',
      rounds: 0,
      projectId: runtime.projectId,
      branch: runtime.branch,
    };
  }

  let rounds = 0;
  let final = null;
  let status = 'drained';

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      if (restoreLocked({ dbPath: runtime.dbPath })) {
        status = 'restore_locked';
        break;
      }

      const result = await runPipeline({
        argv: [
          '--apply',
          '--cwd', runtime.cwd,
          '--db-path', runtime.dbPath,
          '--limit', String(limit),
        ],
        cwd: runtime.cwd,
        log,
        dependencies: {
          resolveRuntime() {
            return runtime;
          },
        },
      });
      rounds += 1;
      final = result.final;

      const remaining = automaticReady(result.final);
      if (remaining === 0) {
        status = 'drained';
        break;
      }

      const before = automaticReady(result.initial);
      if (remaining >= before) {
        status = 'stalled';
        break;
      }

      if (round === maxRounds - 1) status = 'max_rounds';
    }

    return {
      type: 'agent_hub_memory_candidate_pipeline_worker',
      status,
      rounds,
      projectId: runtime.projectId,
      branch: runtime.branch,
      final,
    };
  } finally {
    await releaseLock(lock);
  }
}

async function main() {
  const parsed = parseMemoryCandidatePipelineWorkerArgs(
    process.argv.slice(2),
  );
  const result = await runMemoryCandidatePipelineWorker(parsed);
  console.log(JSON.stringify(result));
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
