import { spawn } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  openSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerScriptPath = fileURLToPath(
  new URL('../scripts/run-memory-candidate-pipeline-worker.mjs', import.meta.url),
);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function defaultMemoryCandidatePipelineLogFile(dbPath) {
  if (!nonEmpty(dbPath)) {
    throw new TypeError('dbPath must be a non-empty string');
  }
  return join(dirname(resolve(dbPath)), 'candidate-pipeline.log');
}

export function launchMemoryCandidatePipeline({
  cwd,
  dbPath,
  limit = 20,
  maxRounds = 5,
  logFile = null,
  executable = process.execPath,
  spawnProcess = spawn,
} = {}) {
  for (const [value, name] of [
    [cwd, 'cwd'],
    [dbPath, 'dbPath'],
    [executable, 'executable'],
  ]) {
    if (!nonEmpty(value)) {
      throw new TypeError(name + ' must be a non-empty string');
    }
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new RangeError('limit must be an integer between 1 and 20');
  }
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 20) {
    throw new RangeError('maxRounds must be an integer between 1 and 20');
  }
  if (typeof spawnProcess !== 'function') {
    throw new TypeError('spawnProcess must be a function');
  }

  const resolvedLogFile = logFile === null
    ? defaultMemoryCandidatePipelineLogFile(dbPath)
    : resolve(logFile);
  mkdirSync(dirname(resolvedLogFile), { recursive: true });
  const logFd = openSync(resolvedLogFile, 'a');

  try {
    const child = spawnProcess(
      executable,
      [
        workerScriptPath,
        '--cwd', resolve(cwd),
        '--db-path', resolve(dbPath),
        '--limit', String(limit),
        '--max-rounds', String(maxRounds),
      ],
      {
        detached: true,
        windowsHide: true,
        stdio: ['ignore', logFd, logFd],
      },
    );
    if (typeof child?.on === 'function') {
      child.on('error', () => {});
    }
    if (typeof child?.unref === 'function') child.unref();

    return {
      status: 'launched',
      pid: Number.isInteger(child?.pid) ? child.pid : null,
      logFile: resolvedLogFile,
    };
  } finally {
    closeSync(logFd);
  }
}
