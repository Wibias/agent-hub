import { randomUUID } from 'node:crypto';
import { ModelJudgeTelemetryStore } from './model-judge-telemetry-store.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function createModelJudgeTelemetryRecorder({
  dbPath,
  projectId,
  branch,
  clock = () => new Date().toISOString(),
  idFactory = randomUUID,
  createStore = (options) => new ModelJudgeTelemetryStore(options),
} = {}) {
  if (!nonEmpty(dbPath)) throw new TypeError('dbPath must be a non-empty string');
  if (!nonEmpty(projectId)) throw new TypeError('projectId must be a non-empty string');
  if (!nonEmpty(branch)) throw new TypeError('branch must be a non-empty string');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function');
  if (typeof createStore !== 'function') throw new TypeError('createStore must be a function');

  let store = null;
  try {
    store = createStore({ dbPath });
  } catch {
    store = null;
  }

  return {
    async onUsage(event) {
      if (!store) return;
      try {
        store.record({
          id: String(idFactory()),
          projectId,
          branch,
          observedAt: clock(),
          stage: event?.stage,
          evaluatorId: event?.evaluator_id,
          status: event?.status,
          durationMs: event?.duration_ms,
          inputTokens: event?.input_tokens ?? null,
          cachedInputTokens: event?.cached_input_tokens ?? null,
          cacheWriteInputTokens: event?.cache_write_input_tokens ?? null,
          outputTokens: event?.output_tokens ?? null,
          reasoningOutputTokens: event?.reasoning_output_tokens ?? null,
        });
      } catch {
        // Operational telemetry must never affect memory decisions.
      }
    },
    close() {
      if (!store) return;
      try { store.close(); } catch {}
      store = null;
    },
  };
}
