import {
  prepareCodexTemporalRecallRuntime,
} from './codex-temporal-recall-runtime.mjs';
import {
  createCodexRecallRelevanceRuntime,
} from './codex-recall-relevance-runtime.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}


export function supportsCodexMemoryRecallRuntime(memory) {
  return Boolean(
    memory
    && typeof memory === 'object'
    && ['recall', 'materializeRecall', 'semanticCandidates', 'getClaim']
      .every((method) => typeof memory[method] === 'function')
  );
}

const MEMORY_MUTATION_MODES = new Set([
  'remember',
  'replace',
  'forget',
  'candidate_confirm',
  'candidate_reject',
]);

export function shouldPrepareCodexMemoryRecallRuntime(memory, {
  explicitMemoryMode = null,
} = {}) {
  return (
    supportsCodexMemoryRecallRuntime(memory)
    && !MEMORY_MUTATION_MODES.has(explicitMemoryMode)
  );
}

export function prepareCodexMemoryRecallRuntime({
  memory,
  dbPath,
  projectId,
  cwd,
  clock = () => new Date().toISOString(),
  resolveGit,
  relevanceSelectorEnabled = false,
  createJsonJudge = null,
  relevanceModel = null,
  relevanceReasoningEffort = 'low',
  relevanceTimeoutMs = 8_000,
  env = process.env,
  prepareTemporalRuntime = prepareCodexTemporalRecallRuntime,
  createRelevanceRuntime = createCodexRecallRelevanceRuntime,
} = {}) {
  if (!memory || typeof memory !== 'object') {
    throw new TypeError('memory must be a MemoryEngine-like object');
  }
  if (!nonEmpty(dbPath)) throw new TypeError('dbPath must be a non-empty string');
  if (!nonEmpty(projectId)) throw new TypeError('projectId must be a non-empty string');
  if (!nonEmpty(cwd)) throw new TypeError('cwd must be a non-empty string');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (typeof relevanceSelectorEnabled !== 'boolean') {
    throw new TypeError('relevanceSelectorEnabled must be a boolean');
  }
  if (typeof prepareTemporalRuntime !== 'function') {
    throw new TypeError('prepareTemporalRuntime must be a function');
  }
  if (typeof createRelevanceRuntime !== 'function') {
    throw new TypeError('createRelevanceRuntime must be a function');
  }

  const temporal = prepareTemporalRuntime({
    memory,
    dbPath,
    projectId,
    cwd,
    clock,
    resolveGit,
  });
  const relevance = createRelevanceRuntime({
    enabled: relevanceSelectorEnabled,
    dbPath,
    projectId,
    branch: temporal.git.branch,
    model: relevanceModel,
    reasoningEffort: relevanceReasoningEffort,
    timeoutMs: relevanceTimeoutMs,
    env,
    clock,
    createJsonJudge,
  });

  return {
    memory: temporal.memory,
    git: temporal.git,
    expiration: temporal.expiration,
    observed_at: temporal.observed_at ?? null,
    relevanceJudge: relevance.judge,
    relevanceEvaluatorId: relevance.evaluatorId,
    async close() {
      await relevance.close();
    },
  };
}
