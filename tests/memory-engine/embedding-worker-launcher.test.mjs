import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  acquireEmbeddingWorkerStartLock,
  launchEmbeddingWorker,
  parseEmbeddingWorkerLauncherArgs,
  releaseEmbeddingWorkerStartLock,
  spawnDetachedEmbeddingWorker,
} from '../../memory-engine/embedding-worker-launcher.mjs';

test('embedding worker launcher parses explicit startup configuration', () => {
  assert.deepEqual(
    parseEmbeddingWorkerLauncherArgs([
      '--cache-dir',
      '.cache/memory-engine/e5',
      '--socket-path',
      'test-socket',
      '--lock-file',
      '.cache/memory-engine/worker.lock',
      '--log-file',
      '.cache/memory-engine/worker.log',
      '--startup-timeout-ms',
      '30000',
    ]),
    {
      cacheDir: '.cache/memory-engine/e5',
      socketPath: 'test-socket',
      lockFile: '.cache/memory-engine/worker.lock',
      logFile: '.cache/memory-engine/worker.log',
      startupTimeoutMs: 30_000,
    },
  );

  assert.throws(
    () => parseEmbeddingWorkerLauncherArgs([]),
    /--cache-dir is required/,
  );
});

test('launcher does not spawn when the pinned worker is already ready', async () => {
  let spawned = false;

  const result = await launchEmbeddingWorker({
    cacheDir: '.cache/memory-engine/e5',
    socketPath: 'test-socket',
    async checkWorker() {
      return true;
    },
    async spawnWorker() {
      spawned = true;
      throw new Error('must not spawn');
    },
  });

  assert.equal(spawned, false);
  assert.equal(result.status, 'already_running');
});

test('launcher owns one start lock, spawns once, and waits for readiness', async () => {
  const calls = [];
  let checks = 0;

  const result = await launchEmbeddingWorker({
    cacheDir: '.cache/memory-engine/e5',
    socketPath: 'test-socket',
    lockFile: 'test-lock',
    logFile: 'test-log',
    startupTimeoutMs: 1_000,
    async checkWorker() {
      checks += 1;
      calls.push(['check', checks]);
      return checks >= 3;
    },
    async acquireLock() {
      calls.push(['lock']);
      return { token: 'lock' };
    },
    async releaseLock(handle) {
      calls.push(['unlock', handle.token]);
    },
    async spawnWorker(options) {
      calls.push(['spawn', options]);
      return { pid: 4242 };
    },
    async sleep() {
      calls.push(['sleep']);
    },
    now: (() => {
      let current = 0;
      return () => {
        current += 100;
        return current;
      };
    })(),
  });

  assert.equal(result.status, 'started');
  assert.equal(result.pid, 4242);
  assert.equal(
    calls.filter(([name]) => name === 'spawn').length,
    1,
  );
  assert.deepEqual(calls.at(-1), ['unlock', 'lock']);
});

test('launcher that loses the start lock waits for the winning worker instead of spawning', async () => {
  let spawned = false;
  let checks = 0;

  const result = await launchEmbeddingWorker({
    cacheDir: '.cache/memory-engine/e5',
    socketPath: 'test-socket',
    startupTimeoutMs: 1_000,
    async checkWorker() {
      checks += 1;
      return checks >= 3;
    },
    async acquireLock() {
      return null;
    },
    async spawnWorker() {
      spawned = true;
      throw new Error('must not spawn');
    },
    async sleep() {},
    now: (() => {
      let current = 0;
      return () => {
        current += 100;
        return current;
      };
    })(),
  });

  assert.equal(spawned, false);
  assert.equal(result.status, 'already_starting');
});

test('start lock is exclusive and stale lock files are recoverable', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-worker-lock-'));
  const lockFile = join(root, 'worker.lock');
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const first = await acquireEmbeddingWorkerStartLock(lockFile, {
    staleAfterMs: 60_000,
  });
  assert.ok(first);

  const second = await acquireEmbeddingWorkerStartLock(lockFile, {
    staleAfterMs: 60_000,
  });
  assert.equal(second, null);

  await releaseEmbeddingWorkerStartLock(first);
  const third = await acquireEmbeddingWorkerStartLock(lockFile, {
    staleAfterMs: 60_000,
  });
  assert.ok(third);
  await releaseEmbeddingWorkerStartLock(third);

  await writeFile(lockFile, 'stale');
  const old = new Date(Date.now() - 120_000);
  await utimes(lockFile, old, old);

  const recovered = await acquireEmbeddingWorkerStartLock(lockFile, {
    staleAfterMs: 1_000,
  });
  assert.ok(recovered);
  assert.equal(
    resolve(dirname(recovered.path)),
    resolve(root),
  );
  const lockStat = await stat(lockFile);
  assert.equal(lockStat.isFile(), true);
  await releaseEmbeddingWorkerStartLock(recovered);
});


test('detached worker spawn is hidden, unrefed, and logs outside hook stdout', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-worker-spawn-'));
  const cacheDir = join(root, 'e5');
  const logFile = join(root, 'worker.log');
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const calls = [];
  const child = {
    pid: 4242,
    unref() {
      calls.push(['unref']);
    },
  };

  const result = await spawnDetachedEmbeddingWorker({
    cacheDir,
    socketPath: 'test-socket',
    logFile,
    executable: 'node-test',
    spawnProcess(executable, args, options) {
      calls.push(['spawn', executable, args, {
        detached: options.detached,
        windowsHide: options.windowsHide,
        stdin: options.stdio[0],
        stdoutIsFd: Number.isInteger(options.stdio[1]),
        stderrIsSameFd: options.stdio[2] === options.stdio[1],
      }]);
      return child;
    },
  });

  assert.deepEqual(result, { pid: 4242 });
  assert.equal(calls[0][0], 'spawn');
  assert.equal(calls[0][1], 'node-test');
  assert.equal(calls[0][3].detached, true);
  assert.equal(calls[0][3].windowsHide, true);
  assert.equal(calls[0][3].stdin, 'ignore');
  assert.equal(calls[0][3].stdoutIsFd, true);
  assert.equal(calls[0][3].stderrIsSameFd, true);
  assert.deepEqual(calls[1], ['unref']);
});
