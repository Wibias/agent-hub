import { RECALL_RELEVANCE_POLICY_VERSION } from './recall-relevance-selector.mjs';
import { runInstrumentedMemoryJudge } from './model-judge-telemetry.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function createRecallRelevanceJudgeRuntime({
  createJsonJudge,
  model = null,
  reasoningEffort = 'low',
  env = process.env,
  timeoutMs = 8_000,
  onUsage = null,
  clockMs = Date.now,
} = {}) {
  if (typeof createJsonJudge !== 'function') {
    throw new TypeError('createJsonJudge must be a function');
  }
  if (model !== null && !nonEmpty(model)) {
    throw new TypeError('model must be null or a non-empty string');
  }
  if (!['low', 'medium', 'high'].includes(reasoningEffort)) {
    throw new TypeError('reasoningEffort must be low, medium, or high');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('timeoutMs must be a positive integer');
  }
  if (onUsage !== null && typeof onUsage !== 'function') {
    throw new TypeError('onUsage must be a function or null');
  }
  if (typeof clockMs !== 'function') {
    throw new TypeError('clockMs must be a function');
  }

  const runner = await createJsonJudge({
    workspaceLabel: 'recall-relevance',
    policyVersion: RECALL_RELEVANCE_POLICY_VERSION,
    model,
    reasoningEffort,
    env,
    timeoutMs,
  });
  if (!runner || typeof runner.judge !== 'function') {
    throw new TypeError('createJsonJudge must return an object with judge()');
  }

  const evaluatorId = 'codex:' + (model || 'default') + ':' + RECALL_RELEVANCE_POLICY_VERSION;
  const getUsage = typeof runner.lastUsage === 'function'
    ? () => runner.lastUsage()
    : () => null;

  return {
    evaluatorId,
    async judge({ prompt } = {}) {
      if (!nonEmpty(prompt)) {
        throw new TypeError('recall relevance judge prompt must be a non-empty string');
      }
      return runInstrumentedMemoryJudge({
        stage: 'recall_relevance',
        evaluatorId,
        prompt,
        judge: (value) => runner.judge(value),
        getUsage,
        onUsage,
        clockMs,
      });
    },
    async close() {
      if (typeof runner.close === 'function') await runner.close();
    },
  };
}
