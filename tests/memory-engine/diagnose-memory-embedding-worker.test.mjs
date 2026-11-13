import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  classifyWorkerLogTail,
  diagnoseE5Worker,
  parseArgs,
} from '../../scripts/diagnose-memory-embedding-worker.mjs';

test('E5 log categories are fixed and never return log text', () => {
  assert.equal(classifyWorkerLogTail('ENOENT C:\\private\\secret\\model.onnx'), 'model_cache_incomplete_possible');
  assert.equal(classifyWorkerLogTail('ERR_DLOPEN_FAILED sensitive path'), 'local_runtime_initialization_possible');
  assert.equal(classifyWorkerLogTail('EADDRINUSE named pipe'), 'local_ipc_or_permissions_possible');
  assert.equal(classifyWorkerLogTail('Unexpected error: TOKEN=secret'), 'other_worker_error_possible');
  assert.equal(classifyWorkerLogTail('ready'), 'no_recognized_error');
});

test('E5 diagnostic only checks cache and pinned local worker, never downloads or runs judges', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agenthub-e5-health-'));
  const cacheDir = join(dir, 'e5');
  const logFile = join(dir, 'embedding-worker.log');
  let calls = 0;
  try {
    const missing = await diagnoseE5Worker({
      cacheDir,
      async checkReady({ timeoutMs }) { calls += 1; assert.equal(timeoutMs, 1000); return false; },
    });
    assert.deepEqual(missing, {
      worker_ready: false,
      cache_status: 'missing',
      log_classification: 'missing',
      startup_lock_present: false,
      lexical_recall_available_when_worker_unready: true,
    });

    mkdirSync(cacheDir);
    const empty = await diagnoseE5Worker({ cacheDir, async checkReady() { return false; } });
    assert.equal(empty.cache_status, 'empty');

    mkdirSync(join(cacheDir, 'models'));
    writeFileSync(logFile, 'private token: abc123\\nCould not locate file C:\\private\\data\\model.onnx');
    const populated = await diagnoseE5Worker({
      cacheDir, async checkReady() { calls += 1; return true; },
    });
    assert.equal(populated.cache_status, 'present_not_verified');
    assert.equal(populated.worker_ready, true);
    assert.equal(populated.log_classification, 'model_cache_incomplete_possible');
    assert.equal(JSON.stringify(populated).includes('abc123'), false);
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('E5 diagnostic requires an explicit cache flag to override the pinned default', () => {
  assert.equal(typeof parseArgs([]).cacheDir, 'string');
  assert.deepEqual(parseArgs(['--cache-dir', '/tmp/e5']), { cacheDir: '/tmp/e5' });
  assert.throws(() => parseArgs(['--download']), /Usage/);
  assert.throws(() => parseArgs(['--cache-dir']), /Usage/);
});
