#!/usr/bin/env node
// Read-only, no-model-download diagnostic for the LOCAL pinned E5 IPC worker.
// No source text, cached model data, log content or credentials are printed.
import { closeSync, existsSync, lstatSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { defaultEmbeddingIpcPath } from '../memory-engine/embedding-ipc.mjs';
import {
  checkEmbeddingWorker,
  defaultEmbeddingWorkerStatePaths,
} from '../memory-engine/embedding-worker-launcher.mjs';

const DEFAULT_CACHE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'memory-engine', 'e5');

export function classifyWorkerLogTail(tail) {
  if (/local_files_only|could not locate file|unable to load model|failed to locate|model not found|ENOENT|no such file/i.test(tail)) return 'model_cache_incomplete_possible';
  if (/onnxruntime|ERR_DLOPEN_FAILED|wasm|failed to create session/i.test(tail)) return 'local_runtime_initialization_possible';
  if (/EADDRINUSE|EACCES|EPERM|permission denied/i.test(tail)) return 'local_ipc_or_permissions_possible';
  if (/error|exception|failed/i.test(tail)) return 'other_worker_error_possible';
  return 'no_recognized_error';
}

function readTail(path, bytes = 16_384) {
  const size = statSync(path).size;
  const buffer = Buffer.alloc(Math.min(bytes, size));
  const fd = openSync(path, 'r');
  try {
    const read = readSync(fd, buffer, 0, buffer.length, size - buffer.length);
    return buffer.subarray(0, read).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

export async function diagnoseE5Worker({
  cacheDir = DEFAULT_CACHE,
  socketPath = defaultEmbeddingIpcPath(),
  checkReady = checkEmbeddingWorker,
} = {}) {
  const cache = resolve(cacheDir);
  const { logFile, lockFile } = defaultEmbeddingWorkerStatePaths(cache);
  let cacheStatus = 'missing';
  try {
    const entry = lstatSync(cache);
    if (!entry.isDirectory() || entry.isSymbolicLink()) cacheStatus = 'invalid';
    else cacheStatus = readdirSync(cache).length > 0 ? 'present_not_verified' : 'empty';
  } catch (error) {
    if (error?.code !== 'ENOENT') cacheStatus = 'unreadable';
  }

  let log = 'missing';
  if (existsSync(logFile)) {
    try {
      const entry = lstatSync(logFile);
      log = entry.isFile() && !entry.isSymbolicLink()
        ? classifyWorkerLogTail(readTail(logFile))
        : 'unsafe_log_path';
    } catch {
      log = 'unreadable';
    }
  }

  let workerReady = false;
  try { workerReady = await checkReady({ socketPath, timeoutMs: 1_000 }); }
  catch { workerReady = false; }

  return {
    worker_ready: workerReady,
    cache_status: cacheStatus,
    log_classification: log,
    startup_lock_present: existsSync(lockFile),
    lexical_recall_available_when_worker_unready: true,
  };
}

export function parseArgs(argv = []) {
  if (argv.length === 0) return { cacheDir: DEFAULT_CACHE };
  if (argv.length === 2 && argv[0] === '--cache-dir'
    && typeof argv[1] === 'string' && argv[1].trim().length > 0) {
    return { cacheDir: argv[1] };
  }
  throw new Error('Usage: node scripts/diagnose-memory-embedding-worker.mjs [--cache-dir PATH]');
}

async function main() {
  const report = await diagnoseE5Worker(parseArgs(process.argv.slice(2)));
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stdout.write(JSON.stringify({ status: 'diagnostic_unavailable' }) + '\n');
    process.exitCode = 2;
  });
}
