import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCodexHookCliOptions,
  runCodexMemoryHook,
} from '../../memory-engine/adapters/codex-hook-cli.mjs';

function event() {
  return {
    session_id: 'thr-hybrid',
    transcript_path: null,
    cwd: '/repo/project',
    hook_event_name: 'UserPromptSubmit',
    model: 'gpt-5.6-sol',
    permission_mode: 'default',
    turn_id: 'turn-hybrid',
    prompt: 'Which storage engine handles multiple writers?',
  };
}

test('Codex hook CLI parses hybrid recall as an explicit opt-in', () => {
  assert.deepEqual(
    parseCodexHookCliOptions([
      '--ignore-memory-env',
      '--explicit-memory-requests',
      '--hybrid-recall',
    ]),
    {
      ignoreMemoryEnv: true,
      explicitMemoryRequests: true,
      hybridRecall: true,
    },
  );

  assert.deepEqual(parseCodexHookCliOptions([]), {
    ignoreMemoryEnv: false,
    explicitMemoryRequests: false,
    hybridRecall: false,
  });
});

test('runCodexMemoryHook wires the embedding IPC proxy into HybridMemoryRetriever', async () => {
  const memory = {
    getProject() {
      return { project_id: 'github.com/example/project' };
    },
    close() {},
  };
  const embedder = {
    modelId: 'test/model',
    modelRevision: 'test-revision',
    dimensions: 3,
    async embedQuery() {
      return new Float32Array([1, 0, 0]);
    },
    async embedPassages() {
      return [new Float32Array([1, 0, 0])];
    },
  };
  const hybridRetriever = {
    async recall() {
      return { items: [], conflicts: [] };
    },
    async indexClaim() {
      return { indexed: true };
    },
  };

  const calls = [];
  const output = await runCodexMemoryHook({
    event: event(),
    env: {},
    configOptions: {
      hybridRecall: true,
    },
    resolveProjectScope() {
      return {
        projectId: 'github.com/example/project',
        repoIdentity: 'github.com/example/project',
        canonicalRemote: 'github.com/example/project',
      };
    },
    ensureDbDirectory() {},
    createEngine() {
      return memory;
    },
    createEmbeddingClient(options) {
      calls.push(['createEmbeddingClient', options]);
      return embedder;
    },
    createHybridRetriever(options) {
      calls.push(['createHybridRetriever', options]);
      assert.equal(options.memory, memory);
      assert.equal(options.embedder, embedder);
      return hybridRetriever;
    },
    createProtocol(options) {
      calls.push(['createProtocol', options]);
      assert.equal(options.hybridRetriever, hybridRetriever);
      return { handle() {} };
    },
    createAdapter() {
      return {
        async handle() {
          return null;
        },
      };
    },
  });

  assert.equal(output, null);
  assert.equal(
    calls.some(([name]) => name === 'createEmbeddingClient'),
    true,
  );
  assert.equal(
    calls.some(([name]) => name === 'createHybridRetriever'),
    true,
  );
});

test('hybrid recall stays disabled unless explicitly requested', async () => {
  const memory = {
    getProject() {
      return { project_id: 'github.com/example/project' };
    },
    close() {},
  };

  let embeddingClientCreated = false;
  let protocolHybrid = 'unset';

  await runCodexMemoryHook({
    event: event(),
    env: {},
    configOptions: {
      hybridRecall: false,
    },
    resolveProjectScope() {
      return {
        projectId: 'github.com/example/project',
        repoIdentity: 'github.com/example/project',
        canonicalRemote: 'github.com/example/project',
      };
    },
    ensureDbDirectory() {},
    createEngine() {
      return memory;
    },
    createEmbeddingClient() {
      embeddingClientCreated = true;
      throw new Error('must not be called');
    },
    createHybridRetriever() {
      throw new Error('must not be called');
    },
    createProtocol(options) {
      protocolHybrid = options.hybridRetriever ?? null;
      return { handle() {} };
    },
    createAdapter() {
      return {
        async handle() {
          return null;
        },
      };
    },
  });

  assert.equal(embeddingClientCreated, false);
  assert.equal(protocolHybrid, null);
});
