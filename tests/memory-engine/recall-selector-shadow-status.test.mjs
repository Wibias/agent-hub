import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { RecallSelectorTelemetryStore } from '../../memory-engine/recall-selector-telemetry-store.mjs';
import { createRecallSelectorTelemetryRecorder } from '../../memory-engine/recall-selector-telemetry-recorder.mjs';

async function withDb(prefix, fn) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const dbPath = join(root, 'memory.sqlite3');
  try {
    await fn(dbPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('fresh schema persists normal fast_v1 telemetry', async () => {
  await withDb('selector-fast-v1-', async (dbPath) => {
    const recorder = createRecallSelectorTelemetryRecorder({
      dbPath,
      projectId: 'project-a',
      branch: 'main',
      clock: () => '2026-10-13T00:00:00.000Z',
      idFactory: () => 'fast-v1-run',
    });
    try {
      await recorder.record({
        route: 'fast_v1',
        failed: false,
        local_duration_ms: 5,
        total_duration_ms: 5,
        candidate_count: 3,
        selected_count: 1,
        judge_called: false,
      });
    } finally {
      recorder.close();
    }

    const store = new RecallSelectorTelemetryStore({ dbPath });
    try {
      const rows = store.list({ projectId: 'project-a', branch: 'main' });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].route, 'fast_v1');
      assert.equal(rows[0].status, 'success');
    } finally {
      store.close();
    }
  });
});

test('fresh schema persists explicit shadow match telemetry', async () => {
  await withDb('selector-shadow-', async (dbPath) => {
    const recorder = createRecallSelectorTelemetryRecorder({
      dbPath,
      projectId: 'project-a',
      branch: 'main',
      clock: () => '2026-10-13T00:00:00.000Z',
      idFactory: () => 'shadow-run',
    });
    try {
      await recorder.record({
        route: 'shadow',
        status: 'fast_v1_match',
        failed: false,
        local_duration_ms: 9,
        total_duration_ms: 109,
        candidate_count: 3,
        selected_count: 1,
        judge_called: true,
        query: 'must never persist',
        selected_ids: ['must-never-persist'],
      });
    } finally {
      recorder.close();
    }

    const store = new RecallSelectorTelemetryStore({ dbPath });
    try {
      const rows = store.list({ projectId: 'project-a', branch: 'main' });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].route, 'shadow');
      assert.equal(rows[0].status, 'fast_v1_match');
      const serialized = JSON.stringify(rows[0]);
      assert.equal(serialized.includes('must never persist'), false);
      assert.equal(serialized.includes('must-never-persist'), false);
    } finally {
      store.close();
    }
  });
});

test('fresh schema rejects shadow-only status on judge route', async () => {
  await withDb('selector-shadow-boundary-', async (dbPath) => {
    const store = new RecallSelectorTelemetryStore({ dbPath });
    try {
      assert.throws(() => store.record({
        id: 'bad-run',
        projectId: 'project-a',
        branch: 'main',
        observedAt: '2026-10-13T00:00:00.000Z',
        route: 'judge',
        status: 'fast_v1_match',
        localDurationMs: 1,
        totalDurationMs: 1,
        candidateCount: 1,
        selectedCount: 1,
        judgeCalled: true,
      }), /status must be success or failed/);
    } finally {
      store.close();
    }
  });
});

test('fresh SQLite constraints independently reject invalid route/status combinations', async () => {
  await withDb('selector-db-check-', async (dbPath) => {
    const store = new RecallSelectorTelemetryStore({ dbPath });
    store.close();

    const db = new DatabaseSync(dbPath);
    try {
      const insert = db.prepare(`
        INSERT INTO memory_recall_selector_runs (
          id, project_id, branch, observed_at, route, status,
          local_duration_ms, total_duration_ms, candidate_count,
          selected_count, judge_called
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      assert.throws(() => insert.run(
        'bad-db-run', 'p', 'main', '2026-10-13T00:00:00.000Z',
        'judge', 'fast_v1_match', 1, 1, 1, 1, 1,
      ));
    } finally {
      db.close();
    }
  });
});
