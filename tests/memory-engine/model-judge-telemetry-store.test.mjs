import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ModelJudgeTelemetryStore,
} from '../../memory-engine/model-judge-telemetry-store.mjs';

async function dbPath() {
  const root = await mkdtemp(join(tmpdir(), 'judge-telemetry-'));
  return join(root, 'memory.sqlite3');
}

function event(overrides = {}) {
  return {
    id: 'run-1',
    projectId: 'project-a',
    branch: 'main',
    observedAt: '2026-10-11T14:00:00.000Z',
    stage: 'evidence_extraction',
    evaluatorId: 'codex:test:evidence-extraction-v1',
    status: 'success',
    durationMs: 50,
    inputTokens: 1000,
    cachedInputTokens: 600,
    cacheWriteInputTokens: null,
    outputTokens: 40,
    reasoningOutputTokens: 10,
    ...overrides,
  };
}

test('telemetry store records content-free model usage idempotently', async () => {
  const path = await dbPath();
  const store = new ModelJudgeTelemetryStore({ dbPath: path });
  try {
    const first = store.record(event());
    const retry = store.record(event());
    assert.deepEqual(retry, first);
    assert.equal(store.list({ projectId: 'project-a', branch: 'main' }).length, 1);
    assert.equal(JSON.stringify(first).includes('prompt'), false);

    assert.throws(
      () => store.record(event({ durationMs: 51 })),
      /collision/u,
    );
  } finally { store.close(); }
});

test('telemetry summary aggregates usage by stage and failure count', async () => {
  const path = await dbPath();
  const store = new ModelJudgeTelemetryStore({ dbPath: path });
  try {
    store.record(event());
    store.record(event({
      id: 'run-2', stage: 'recall_relevance', status: 'failed', durationMs: 25,
      inputTokens: 300, cachedInputTokens: 100, outputTokens: 12,
      reasoningOutputTokens: 4,
    }));
    store.record(event({ id: 'other', projectId: 'project-b' }));

    assert.deepEqual(store.summary({ projectId: 'project-a', branch: 'main' }), {
      calls: 2,
      failures: 1,
      duration_ms: 75,
      input_tokens: 1300,
      cached_input_tokens: 700,
      cache_write_input_tokens: 0,
      output_tokens: 52,
      reasoning_output_tokens: 14,
      by_stage: {
        evidence_extraction: { calls: 1, failures: 0, duration_ms: 50 },
        recall_relevance: { calls: 1, failures: 1, duration_ms: 25 },
      },
    });
  } finally { store.close(); }
});

test('telemetry summary aggregates every matching run beyond the list cap', async () => {
  const path = await dbPath();
  const store = new ModelJudgeTelemetryStore({ dbPath: path });
  try {
    for (let index = 0; index < 1001; index += 1) {
      store.record(event({
        id: `run-${index}`,
        observedAt: new Date(Date.UTC(2026, 9, 11, 14, 0, 0, index)).toISOString(),
        stage: index % 2 === 0 ? 'evidence_extraction' : 'evidence_support',
        status: index % 10 === 0 ? 'failed' : 'success',
        durationMs: 1,
        inputTokens: 2,
        cachedInputTokens: 1,
        cacheWriteInputTokens: null,
        outputTokens: 3,
        reasoningOutputTokens: 1,
      }));
    }

    assert.equal(
      store.list({ projectId: 'project-a', branch: 'main', limit: 1000 }).length,
      1000,
    );
    assert.deepEqual(store.summary({ projectId: 'project-a', branch: 'main' }), {
      calls: 1001,
      failures: 101,
      duration_ms: 1001,
      input_tokens: 2002,
      cached_input_tokens: 1001,
      cache_write_input_tokens: 0,
      output_tokens: 3003,
      reasoning_output_tokens: 1001,
      by_stage: {
        evidence_extraction: { calls: 501, failures: 101, duration_ms: 501 },
        evidence_support: { calls: 500, failures: 0, duration_ms: 500 },
      },
    });
  } finally { store.close(); }
});

test('read-only telemetry store does not require write migration', async () => {
  const path = await dbPath();
  const writable = new ModelJudgeTelemetryStore({ dbPath: path });
  writable.close();
  const readonly = new ModelJudgeTelemetryStore({ dbPath: path, readOnly: true });
  try {
    assert.deepEqual(readonly.list({ projectId: 'p', branch: 'main' }), []);
  } finally { readonly.close(); }
});
