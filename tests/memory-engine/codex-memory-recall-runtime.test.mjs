import test from 'node:test';
import assert from 'node:assert/strict';

import {
  prepareCodexMemoryRecallRuntime,
} from '../../memory-engine/adapters/codex-memory-recall-runtime.mjs';

test('standard recall runtime composes temporal memory and disabled relevance selector', async () => {
  const rawMemory = { marker: 'raw' };
  const temporalMemory = { marker: 'temporal' };
  const calls = [];
  const runtime = prepareCodexMemoryRecallRuntime({
    memory: rawMemory,
    dbPath: '/tmp/memory.sqlite3',
    projectId: 'project-a',
    cwd: '/repo',
    relevanceSelectorEnabled: false,
    prepareTemporalRuntime(options) {
      calls.push(['temporal', options]);
      return {
        memory: temporalMemory,
        git: { repoPath: '/repo', branch: 'main', revisionSha: 'abc' },
        expiration: { evaluated: 1, expired: 1, claim_ids: ['old'] },
      };
    },
    createRelevanceRuntime(options) {
      calls.push(['relevance', options]);
      return { judge: null, evaluatorId: () => null, close: async () => {} };
    },
  });

  assert.equal(runtime.memory, temporalMemory);
  assert.equal(runtime.relevanceJudge, null);
  assert.equal(calls[1][1].enabled, false);
  assert.equal(calls[1][1].branch, 'main');
  await runtime.close();
});

test('standard recall runtime forwards isolated judge factory only when selector is enabled', async () => {
  const createJsonJudge = async () => ({});
  let relevanceOptions = null;
  const runtime = prepareCodexMemoryRecallRuntime({
    memory: {},
    dbPath: '/tmp/memory.sqlite3',
    projectId: 'project-a',
    cwd: '/repo',
    relevanceSelectorEnabled: true,
    createJsonJudge,
    relevanceModel: 'gpt-test',
    relevanceReasoningEffort: 'low',
    relevanceTimeoutMs: 7_000,
    prepareTemporalRuntime() {
      return {
        memory: { temporal: true },
        git: { repoPath: '/repo', branch: 'dev', revisionSha: 'abc' },
        expiration: { evaluated: 0, expired: 0, claim_ids: [] },
      };
    },
    createRelevanceRuntime(options) {
      relevanceOptions = options;
      return { judge: async () => ({}), evaluatorId: () => 'eval', close: async () => {} };
    },
  });

  assert.equal(relevanceOptions.enabled, true);
  assert.equal(relevanceOptions.createJsonJudge, createJsonJudge);
  assert.equal(relevanceOptions.model, 'gpt-test');
  assert.equal(relevanceOptions.reasoningEffort, 'low');
  assert.equal(relevanceOptions.timeoutMs, 7_000);
  assert.equal(runtime.relevanceEvaluatorId(), 'eval');
  await runtime.close();
});

test('temporal recall capability requires the full recall surface', async () => {
  const { supportsCodexMemoryRecallRuntime } = await import('../../memory-engine/adapters/codex-memory-recall-runtime.mjs');

  assert.equal(supportsCodexMemoryRecallRuntime({
    getProject() {},
    close() {},
  }), false);

  assert.equal(supportsCodexMemoryRecallRuntime({
    recall() {},
    materializeRecall() {},
    semanticCandidates() {},
    getClaim() {},
  }), true);
});

test('recall runtime is skipped for explicit memory mutation commands but kept for reads', async () => {
  const {
    shouldPrepareCodexMemoryRecallRuntime,
  } = await import('../../memory-engine/adapters/codex-memory-recall-runtime.mjs');

  const memory = {
    recall() {},
    materializeRecall() {},
    semanticCandidates() {},
    getClaim() {},
  };

  for (const mode of [
    'remember',
    'replace',
    'forget',
    'candidate_confirm',
    'candidate_reject',
  ]) {
    assert.equal(
      shouldPrepareCodexMemoryRecallRuntime(memory, { explicitMemoryMode: mode }),
      false,
      mode,
    );
  }

  for (const mode of [null, 'list', 'inspect', 'explain', 'health']) {
    assert.equal(
      shouldPrepareCodexMemoryRecallRuntime(memory, { explicitMemoryMode: mode }),
      true,
      String(mode),
    );
  }
});
