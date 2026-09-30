#!/usr/bin/env node
import { spawn } from 'node:child_process';
import {
  mkdir,
  open,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createEmbeddingIpcClient,
  defaultEmbeddingIpcPath,
} from './embedding-ipc.mjs';
import {
  E5_DIMENSIONS,
  E5_MODEL_ID,
  E5_MODEL_REVISION,
} from './e5-embedder.mjs';

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_LOCK_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 200;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 300_000) {
    throw new RangeError(`${name} must be an integer between 1 and 300000`);
  }
  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!nonEmpty(value)) {
    throw new Error(`${flag} requires a non-empty value`);
  }
  return value;
}

export function parseEmbeddingWorkerLauncherArgs(argv) {
  if (!Array.isArray(argv)) {
    throw new TypeError('argv must be an array');
  }

  const parsed = {
    cacheDir: null,
    socketPath: null,
    lockFile: null,
    logFile: null,
    startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--cache-dir') {
      if (parsed.cacheDir !== null) {
        throw new Error('--cache-dir may be provided only once');
      }
      parsed.cacheDir = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--socket-path') {
      if (parsed.socketPath !== null) {
        throw new Error('--socket-path may be provided only once');
      }
      parsed.socketPath = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--lock-file') {
      if (parsed.lockFile !== null) {
        throw new Error('--lock-file may be provided only once');
      }
      parsed.lockFile = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--log-file') {
      if (parsed.logFile !== null) {
        throw new Error('--log-file may be provided only once');
      }
      parsed.logFile = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--startup-timeout-ms') {
      parsed.startupTimeoutMs = positiveInteger(
        requireValue(argv, index, arg),
        '--startup-timeout-ms',
      );
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  if (parsed.cacheDir === null) {
    throw new Error('--cache-dir is required');
  }

  return parsed;
}

export function defaultEmbeddingWorkerStatePaths(cacheDir) {
  if (!nonEmpty(cacheDir)) {
    throw new TypeError('cacheDir must be a non-empty string');
  }

  const stateDir = dirname(resolve(cacheDir));
  return {
    lockFile: join(stateDir, 'embedding-worker.lock'),
    logFile: join(stateDir, 'embedding-worker.log'),
  };
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

  return {
    path: lockFile,
    file,
  };
}

export async function acquireEmbeddingWorkerStartLock(lockFile, {
  staleAfterMs = DEFAULT_STALE_LOCK_MS,
  now = Date.now,
} = {}) {
  if (!nonEmpty(lockFile)) {
    throw new TypeError('lockFile must be a non-empty string');
  }
  positiveInteger(staleAfterMs, 'staleAfterMs');
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function');
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
    if (error?.code === 'ENOENT') {
      return openNewLock(resolved, now);
    }
    throw error;
  }

  if ((now() - metadata.mtimeMs) <= staleAfterMs) {
    return null;
  }

  await rm(resolved, { force: true });
  try {
    return await openNewLock(resolved, now);
  } catch (error) {
    if (error?.code === 'EEXIST') return null;
    throw error;
  }
}

export async function releaseEmbeddingWorkerStartLock(handle) {
  if (!handle || !nonEmpty(handle.path) || !handle.file) {
    throw new TypeError('lock handle is invalid');
  }

  try {
    await handle.file.close();
  } finally {
    await rm(handle.path, { force: true });
  }
}

export async function checkEmbeddingWorker({
  socketPath = defaultEmbeddingIpcPath(),
  timeoutMs = 1_000,
  createClient = createEmbeddingIpcClient,
} = {}) {
  if (typeof createClient !== 'function') {
    throw new TypeError('createClient must be a function');
  }

  try {
    const client = createClient({
      socketPath,
      modelId: E5_MODEL_ID,
      modelRevision: E5_MODEL_REVISION,
      dimensions: E5_DIMENSIONS,
      timeoutMs,
    });
    const health = await client.health();
    return health?.ready === true;
  } catch {
    return false;
  }
}

async function defaultSleep(ms) {
  await new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

const workerScriptPath = fileURLToPath(
  new URL('./embedding-worker-cli.mjs', import.meta.url),
);

export async function spawnDetachedEmbeddingWorker({
  cacheDir,
  socketPath,
  logFile,
  executable = process.execPath,
  spawnProcess = spawn,
} = {}) {
  for (const [value, name] of [
    [cacheDir, 'cacheDir'],
    [socketPath, 'socketPath'],
    [logFile, 'logFile'],
    [executable, 'executable'],
  ]) {
    if (!nonEmpty(value)) {
      throw new TypeError(`${name} must be a non-empty string`);
    }
  }
  if (typeof spawnProcess !== 'function') {
    throw new TypeError('spawnProcess must be a function');
  }

  const resolvedLogFile = resolve(logFile);
  await mkdir(dirname(resolvedLogFile), { recursive: true });
  const logHandle = await open(resolvedLogFile, 'a');

  try {
    const child = spawnProcess(
      executable,
      [
        workerScriptPath,
        '--cache-dir',
        resolve(cacheDir),
        '--socket-path',
        socketPath,
      ],
      {
        detached: true,
        windowsHide: true,
        stdio: ['ignore', logHandle.fd, logHandle.fd],
      },
    );
    child.unref();

    return {
      pid: Number.isInteger(child.pid) ? child.pid : null,
    };
  } finally {
    await logHandle.close();
  }
}

async function waitUntilReady({
  checkWorker,
  startupTimeoutMs,
  pollIntervalMs,
  sleep,
  now,
}) {
  const deadline = now() + startupTimeoutMs;

  while (now() <= deadline) {
    if (await checkWorker()) return true;
    await sleep(pollIntervalMs);
  }
  return false;
}

export async function launchEmbeddingWorker({
  cacheDir,
  socketPath = defaultEmbeddingIpcPath(),
  lockFile = null,
  logFile = null,
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  checkWorker = null,
  acquireLock = acquireEmbeddingWorkerStartLock,
  releaseLock = releaseEmbeddingWorkerStartLock,
  spawnWorker = spawnDetachedEmbeddingWorker,
  sleep = defaultSleep,
  now = Date.now,
} = {}) {
  if (!nonEmpty(cacheDir)) {
    throw new TypeError('cacheDir must be a non-empty string');
  }
  if (!nonEmpty(socketPath)) {
    throw new TypeError('socketPath must be a non-empty string');
  }
  positiveInteger(startupTimeoutMs, 'startupTimeoutMs');
  positiveInteger(pollIntervalMs, 'pollIntervalMs');

  for (const [fn, name] of [
    [acquireLock, 'acquireLock'],
    [releaseLock, 'releaseLock'],
    [spawnWorker, 'spawnWorker'],
    [sleep, 'sleep'],
    [now, 'now'],
  ]) {
    if (typeof fn !== 'function') {
      throw new TypeError(`${name} must be a function`);
    }
  }

  const resolvedCacheDir = resolve(cacheDir);
  const defaults = defaultEmbeddingWorkerStatePaths(resolvedCacheDir);
  const resolvedLockFile = lockFile === null
    ? defaults.lockFile
    : resolve(lockFile);
  const resolvedLogFile = logFile === null
    ? defaults.logFile
    : resolve(logFile);

  const probe = checkWorker === null
    ? () => checkEmbeddingWorker({ socketPath })
    : checkWorker;
  if (typeof probe !== 'function') {
    throw new TypeError('checkWorker must be a function');
  }

  if (await probe()) {
    return {
      status: 'already_running',
      pid: null,
      socketPath,
    };
  }

  const lock = await acquireLock(resolvedLockFile, {
    staleAfterMs: Math.max(
      DEFAULT_STALE_LOCK_MS,
      startupTimeoutMs * 2,
    ),
    now,
  });

  if (lock === null) {
    const ready = await waitUntilReady({
      checkWorker: probe,
      startupTimeoutMs,
      pollIntervalMs,
      sleep,
      now,
    });

    return {
      status: ready ? 'already_starting' : 'start_in_progress',
      pid: null,
      socketPath,
    };
  }

  let child = null;
  try {
    if (await probe()) {
      return {
        status: 'already_running',
        pid: null,
        socketPath,
      };
    }

    child = await spawnWorker({
      cacheDir: resolvedCacheDir,
      socketPath,
      logFile: resolvedLogFile,
    });

    const ready = await waitUntilReady({
      checkWorker: probe,
      startupTimeoutMs,
      pollIntervalMs,
      sleep,
      now,
    });

    return {
      status: ready ? 'started' : 'start_failed',
      pid: child?.pid ?? null,
      socketPath,
    };
  } finally {
    await releaseLock(lock);
  }
}

async function main() {
  const parsed = parseEmbeddingWorkerLauncherArgs(process.argv.slice(2));
  const defaults = defaultEmbeddingWorkerStatePaths(parsed.cacheDir);

  // Intentionally emit no stdout on normal operation. SessionStart hook stdout
  // is developer context, and worker lifecycle status must not enter the model.
  await launchEmbeddingWorker({
    cacheDir: parsed.cacheDir,
    socketPath: parsed.socketPath ?? defaultEmbeddingIpcPath(),
    lockFile: parsed.lockFile ?? defaults.lockFile,
    logFile: parsed.logFile ?? defaults.logFile,
    startupTimeoutMs: parsed.startupTimeoutMs,
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
