import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RecallSelectorTelemetryStore } from '../../memory-engine/recall-selector-telemetry-store.mjs';

console.log('SHADOW_SOURCE_VALIDATION_TEST_LOADED');

const SHADOW_STATUSES = [
  'no_candidates',
  'fast_v1_match',
  'fast_v1_mismatch',
  'fast_v2_match',
  'fast_v2_mismatch',
  'fast_path_fallback',
  'fast_path_failed',
  'judge_unavailable',
];

const NORMAL_ROUTES = ['fast_v1', 'fast_v2', 'judge', 'legacy'];

function withStore(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-shadow-source-validation-'));
  const dbPath = path.join(dir, 'memory.sqlite3');
  const store = new RecallSelectorTelemetryStore({ dbPath });

  try {
    return fn(store);
  } finally {
    if (typeof store.close === 'function') {
      store.close();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function event({
  id,
  route,
  status,
}) {
  return {
    id,
    projectId: 'project-shadow-source-validation',
    branch: 'main',
    observedAt: '2026-10-13T21:00:00.000Z',
    route,
    status,
    localDurationMs: 1,
    totalDurationMs: 2,
    candidateCount: 3,
    selectedCount: 0,
    judgeCalled: route === 'shadow',
  };
}

test('shadow route accepts exactly the eight shadow statuses', () => {
  withStore((store) => {
    SHADOW_STATUSES.forEach((status, index) => {
      assert.doesNotThrow(() => {
        store.record(event({
          id: `shadow-ok-${index}`,
          route: 'shadow',
          status,
        }));
      }, status);
    });
  });
});

test('shadow route rejects success and failed at source validation before SQLite', () => {
  withStore((store) => {
    for (const status of ['success', 'failed']) {
      assert.throws(
        () => store.record(event({
          id: `shadow-invalid-${status}`,
          route: 'shadow',
          status,
        })),
        (error) => (
          error instanceof TypeError
          && /status/i.test(error.message)
        ),
        `shadow/${status} must be rejected by source validation as TypeError`,
      );
    }
  });
});

test('non-shadow routes reject every shadow-only status at source validation', () => {
  withStore((store) => {
    for (const route of NORMAL_ROUTES) {
      for (const [index, status] of SHADOW_STATUSES.entries()) {
        assert.throws(
          () => store.record(event({
            id: `${route}-invalid-${index}`,
            route,
            status,
          })),
          (error) => (
            error instanceof TypeError
            && /status/i.test(error.message)
          ),
          `${route}/${status} must be rejected as TypeError`,
        );
      }
    }
  });
});