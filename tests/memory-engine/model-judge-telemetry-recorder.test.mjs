import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createModelJudgeTelemetryRecorder,
} from '../../memory-engine/model-judge-telemetry-recorder.mjs';
import { ModelJudgeTelemetryStore } from '../../memory-engine/model-judge-telemetry-store.mjs';

async function makeDb() {
  const root = await mkdtemp(join(tmpdir(), 'judge-recorder-'));
  return join(root, 'memory.sqlite3');
}

test('recorder maps instrumented judge telemetry into operational store rows', async () => {
  const dbPath = await makeDb();
  const ids = ['usage-1', 'usage-2'];
  const times = ['2026-10-11T14:00:00.000Z', '2026-10-11T14:00:01.000Z'];
  const recorder = createModelJudgeTelemetryRecorder({
    dbPath,
    projectId: 'project-a',
    branch: 'main',
    idFactory: () => ids.shift(),
    clock: () => times.shift(),
  });
  try {
    await recorder.onUsage({
      stage: 'evidence_extraction',
      evaluator_id: 'eval:extract',
      status: 'success',
      duration_ms: 33,
      input_tokens: 100,
      cached_input_tokens: 50,
      cache_write_input_tokens: null,
      output_tokens: 10,
      reasoning_output_tokens: 4,
    });
    await recorder.onUsage({
      stage: 'recall_relevance',
      evaluator_id: 'eval:recall',
      status: 'failed',
      duration_ms: 12,
      input_tokens: null,
      cached_input_tokens: null,
      cache_write_input_tokens: null,
      output_tokens: null,
      reasoning_output_tokens: null,
    });
  } finally { recorder.close(); }

  const store = new ModelJudgeTelemetryStore({ dbPath, readOnly: true });
  try {
    const rows = store.list({ projectId: 'project-a', branch: 'main' });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.id).sort(), ['usage-1', 'usage-2']);
    assert.equal(JSON.stringify(rows).includes('prompt'), false);
  } finally { store.close(); }
});

test('recorder telemetry failure is fail-soft to callers', async () => {
  const recorder = createModelJudgeTelemetryRecorder({
    dbPath: '/definitely/not/available/memory.sqlite3',
    projectId: 'p',
    branch: 'main',
    createStore: () => ({
      record() { throw new Error('disk full'); },
      close() {},
    }),
  });
  await assert.doesNotReject(() => recorder.onUsage({
    stage: 'support', evaluator_id: 'eval', status: 'success', duration_ms: 1,
    input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: null,
    output_tokens: 1, reasoning_output_tokens: null,
  }));
  recorder.close();
});
