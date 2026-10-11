import {
  createLazyRecallRelevanceJudge,
} from '../lazy-recall-relevance-judge.mjs';
import {
  createRecallRelevanceJudgeRuntime,
} from '../recall-relevance-judge-runtime.mjs';
import {
  createModelJudgeTelemetryRecorder,
} from '../model-judge-telemetry-recorder.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function createCodexRecallRelevanceRuntime({
  enabled = false,
  dbPath,
  projectId,
  branch,
  model = null,
  reasoningEffort = 'low',
  timeoutMs = 8_000,
  env = process.env,
  clock = () => new Date().toISOString(),
  createJsonJudge = null,
  createJudgeRuntime = createRecallRelevanceJudgeRuntime,
  createTelemetryRecorder = createModelJudgeTelemetryRecorder,
} = {}) {
  if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean');
  if (!nonEmpty(dbPath)) throw new TypeError('dbPath must be a non-empty string');
  if (!nonEmpty(projectId)) throw new TypeError('projectId must be a non-empty string');
  if (!nonEmpty(branch)) throw new TypeError('branch must be a non-empty string');
  if (model !== null && !nonEmpty(model)) {
    throw new TypeError('model must be null or a non-empty string');
  }
  if (!['low', 'medium', 'high'].includes(reasoningEffort)) {
    throw new TypeError('reasoningEffort must be low, medium, or high');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('timeoutMs must be a positive integer');
  }
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (enabled && typeof createJsonJudge !== 'function') {
    throw new TypeError('createJsonJudge must be a function when enabled');
  }
  if (typeof createJudgeRuntime !== 'function') {
    throw new TypeError('createJudgeRuntime must be a function');
  }
  if (typeof createTelemetryRecorder !== 'function') {
    throw new TypeError('createTelemetryRecorder must be a function');
  }

  let recorder = null;
  const lazy = createLazyRecallRelevanceJudge({
    enabled,
    runtimeOptions: {
      model,
      reasoningEffort,
      timeoutMs,
      env,
      createJsonJudge,
    },
    createRuntime: async (runtimeOptions) => {
      recorder = createTelemetryRecorder({
        dbPath,
        projectId,
        branch,
        clock,
      });
      try {
        return await createJudgeRuntime({
          ...runtimeOptions,
          onUsage: recorder.onUsage,
        });
      } catch (error) {
        try { recorder.close(); } catch {}
        recorder = null;
        throw error;
      }
    },
  });

  return {
    judge: lazy.judge,
    evaluatorId: lazy.evaluatorId,
    async close() {
      try {
        await lazy.close();
      } finally {
        if (recorder) {
          try { recorder.close(); } catch {}
          recorder = null;
        }
      }
    },
  };
}
