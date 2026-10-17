import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCodexHookCliOptions,
  runCodexMemoryHook,
} from '../../memory-engine/adapters/codex-hook-cli.mjs';

function event() {
  return {
    session_id: 'session-runtime-fast-path',
    transcript_path: null,
    cwd: '/repo/project',
    hook_event_name: 'UserPromptSubmit',
    model: 'gpt-5.6-sol',
    permission_mode: 'default',
    turn_id: 'turn-runtime-fast-path',
    prompt: 'Which database?',
  };
}

function memory() {
  return {
    getProject() { return { project_id: 'project-a' }; },
    registerProject() {},
    recall() { return { items: [], conflicts: [] }; },
    materializeRecall() { return { items: [], conflicts: [] }; },
    semanticCandidates() { return []; },
    getClaim() { return null; },
    close() {},
  };
}

test('CLI exposes relevance and fast path as independent explicit opt-ins', () => {
  assert.deepEqual(
    parseCodexHookCliOptions(['--recall-relevance', '--recall-fast-path']),
    {
      ignoreMemoryEnv: false,
      explicitMemoryRequests: false,
      hybridRecall: false,
      recallRelevance: true,
      recallFastPath: true,
    },
  );
  const disabled = parseCodexHookCliOptions([]);
  assert.equal(disabled.recallRelevance, undefined);
  assert.equal(disabled.recallFastPath, undefined);
});

test('runtime wires v1/v2 selector only when relevance and fast path are both enabled', async () => {
  const rawMemory = memory();
  let recallOptions = null;
  let adapterOptions = null;
  let fastPathOptions = null;
  let recorderOptions = null;
  const embedder = {
    modelId: 'test/model', modelRevision: 'test/rev', dimensions: 1,
    async embedQuery() { return new Float32Array([1]); },
    async embedPassages() { return [new Float32Array([1])]; },
  };

  await runCodexMemoryHook({
    event: event(),
    env: {},
    configOptions: {
      ignoreMemoryEnv: true,
      recallRelevance: true,
      recallFastPath: true,
      embeddingSocketPath: 'test-pipe',
    },
    createEngine() { return rawMemory; },
    resolveProjectScope() {
      return { projectId: 'project-a', repoIdentity: 'project-a', canonicalRemote: null };
    },
    restoreLockExists() { return false; },
    ensureDbDirectory() {},
    prepareRecallRuntime(options) {
      recallOptions = options;
      return {
        memory: rawMemory,
        git: { branch: 'main', revisionSha: 'a'.repeat(40), repoPath: '/repo/project' },
        relevanceJudge: async () => ({ selected_ids: [], reason: 'fallback' }),
        async close() {},
      };
    },
    embeddingCacheAvailable() { return false; },
    createEmbeddingClient() { return embedder; },
    createHybridRetriever() {
      return {
        async recall() { return { items: [], conflicts: [] }; },
        async diagnoseRecall() { return { candidates: [], conflicts: [] }; },
      };
    },
    createRecallFastPath(options) {
      fastPathOptions = options;
      return { async select() { return { route: 'fallback', selected_ids: [], duration_ms: 1 }; } };
    },
    createSelectorTelemetryRecorder(options) {
      recorderOptions = options;
      return { async record() {}, close() {} };
    },
    createRecallJsonJudge: async () => ({ judge: async () => ({ selected_ids: [], reason: 'x' }) }),
    createProtocol() {
      return { async handle() { return { ok: true, result: { items: [], conflicts: [] } }; } };
    },
    createAdapter(options) {
      adapterOptions = options;
      return { async handle() { return null; } };
    },
  });

  assert.equal(recallOptions.relevanceSelectorEnabled, true);
  assert.equal(recallOptions.relevanceTimeoutMs, 12000);
  assert.equal(typeof recallOptions.createJsonJudge, 'function');
  assert.equal(fastPathOptions.embedder, embedder);
  assert.equal(typeof adapterOptions.recallFastPath, 'function');
  assert.equal(typeof adapterOptions.onRecallSelectorTelemetry, 'function');
  assert.equal(recorderOptions.projectId, 'project-a');
  assert.equal(recorderOptions.branch, 'main');
});

test('fast path flag alone does not alter recall selection', async () => {
  const rawMemory = memory();
  let fastPathCreated = false;
  let adapterOptions = null;

  await runCodexMemoryHook({
    event: event(),
    env: {},
    configOptions: { ignoreMemoryEnv: true, recallFastPath: true },
    createEngine() { return rawMemory; },
    resolveProjectScope() {
      return { projectId: 'project-a', repoIdentity: 'project-a', canonicalRemote: null };
    },
    restoreLockExists() { return false; },
    ensureDbDirectory() {},
    prepareRecallRuntime() {
      return {
        memory: rawMemory,
        git: { branch: 'main', revisionSha: 'a'.repeat(40), repoPath: '/repo/project' },
        relevanceJudge: null,
        async close() {},
      };
    },
    createRecallFastPath() { fastPathCreated = true; throw new Error('must not run'); },
    createProtocol() {
      return { async handle() { return { ok: true, result: { items: [], conflicts: [] } }; } };
    },
    createAdapter(options) {
      adapterOptions = options;
      return { async handle() { return null; } };
    },
  });

  assert.equal(fastPathCreated, false);
  assert.equal(adapterOptions.recallFastPath, null);
});
