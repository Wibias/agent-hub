import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RecallSelectorTelemetryStore } from '../../memory-engine/recall-selector-telemetry-store.mjs';
import { createRecallSelectorTelemetryRecorder } from '../../memory-engine/recall-selector-telemetry-recorder.mjs';

test('selector telemetry persists only content-free route and count data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'recall-selector-telemetry-'));
  const dbPath = join(root, 'memory.sqlite3');
  const recorder = createRecallSelectorTelemetryRecorder({
    dbPath,
    projectId: 'project-a',
    branch: 'main',
    clock: () => '2026-10-12T00:00:00.000Z',
    idFactory: () => 'selector-run-1',
  });
  try {
    await recorder.record({
      route: 'fast_v2',
      failed: false,
      local_duration_ms: 12,
      total_duration_ms: 12,
      candidate_count: 5,
      selected_count: 1,
      judge_called: false,
      query: 'must never persist',
    });
  } finally {
    recorder.close();
  }

  const store = new RecallSelectorTelemetryStore({ dbPath });
  try {
    const rows = store.list({ projectId: 'project-a', branch: 'main' });
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      id: 'selector-run-1',
      project_id: 'project-a',
      branch: 'main',
      observed_at: '2026-10-12T00:00:00.000Z',
      route: 'fast_v2',
      status: 'success',
      local_duration_ms: 12,
      total_duration_ms: 12,
      candidate_count: 5,
      selected_count: 1,
      judge_called: false,
    });
    assert.equal(JSON.stringify(rows[0]).includes('must never persist'), false);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('selector telemetry summary separates local routes from judge fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'recall-selector-summary-'));
  const dbPath = join(root, 'memory.sqlite3');
  const store = new RecallSelectorTelemetryStore({ dbPath });
  try {
    for (const row of [
      { id: 'a', route: 'fast_v1', judgeCalled: false, localDurationMs: 10, totalDurationMs: 10 },
      { id: 'b', route: 'judge', judgeCalled: true, localDurationMs: 12, totalDurationMs: 7000 },
    ]) {
      store.record({
        ...row,
        projectId: 'project-a',
        branch: 'main',
        observedAt: '2026-10-12T00:00:00.000Z',
        status: 'success',
        candidateCount: 5,
        selectedCount: 1,
      });
    }
    const summary = store.summary({ projectId: 'project-a', branch: 'main' });
    assert.equal(summary.calls, 2);
    assert.equal(summary.judge_calls, 1);
    assert.equal(summary.by_route.fast_v1.calls, 1);
    assert.equal(summary.by_route.judge.total_duration_ms, 7000);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
