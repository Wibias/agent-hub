import { randomUUID } from 'node:crypto';
import { RecallSelectorTelemetryStore } from './recall-selector-telemetry-store.mjs';

function nonEmpty(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(name + ' must be a non-empty string');
  }
  return value.trim();
}

export function createRecallSelectorTelemetryRecorder({
  dbPath,
  projectId,
  branch,
  clock = () => new Date().toISOString(),
  idFactory = randomUUID,
  createStore = (options) => new RecallSelectorTelemetryStore(options),
} = {}) {
  nonEmpty(dbPath, 'dbPath');
  nonEmpty(projectId, 'projectId');
  nonEmpty(branch, 'branch');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function');
  if (typeof createStore !== 'function') throw new TypeError('createStore must be a function');

  let store = null;
  try { store = createStore({ dbPath }); } catch { store = null; }

  return {
    async record(event) {
      if (!store) return;
      try {
        store.record({
          id: String(idFactory()),
          projectId,
          branch,
          observedAt: clock(),
          route: event?.route,
          status: typeof event?.status === 'string' && event.status.trim().length > 0
            ? event.status.trim()
            : (event?.failed === true ? 'failed' : 'success'),
          localDurationMs: event?.local_duration_ms ?? 0,
          totalDurationMs: event?.total_duration_ms ?? 0,
          candidateCount: event?.candidate_count ?? 0,
          selectedCount: event?.selected_count ?? 0,
          judgeCalled: event?.judge_called === true,
        });
      } catch {
        // Selector telemetry is operational and must never affect recall.
      }
    },
    close() {
      if (!store) return;
      try { store.close(); } catch {}
      store = null;
    },
  };
}
