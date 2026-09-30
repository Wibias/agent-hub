import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseCodexHookCliOptions,
  runCodexMemoryHook,
} from '../../memory-engine/adapters/codex-hook-cli.mjs';
import {
  createEmbeddingIpcClient,
  startEmbeddingIpcServer,
} from '../../memory-engine/embedding-ipc.mjs';
import {
  E5_DIMENSIONS,
  E5_MODEL_ID,
  E5_MODEL_REVISION,
} from '../../memory-engine/e5-embedder.mjs';
import { HybridMemoryRetriever } from '../../memory-engine/hybrid-retrieval.mjs';
import { MemoryEngine } from '../../memory-engine/index.mjs';

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


test('real Codex hybrid hook recovers a lexical-miss memory through the warm IPC worker', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agent-hub-codex-hybrid-e2e-'));
  const repoDir = join(root, 'repo');
  const dbPath = join(root, 'memory.sqlite3');
  const socketPath = join(root, 'embedding.sock');
  const projectId = 'github.com/example/hybrid-e2e';

  mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['init', '-b', 'main', repoDir], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'Memory Test']);
  execFileSync('git', [
    '-C',
    repoDir,
    'remote',
    'add',
    'origin',
    'git@github.com:example/hybrid-e2e.git',
  ]);
  writeFileSync(join(repoDir, 'README.md'), '# hybrid e2e\n');
  execFileSync('git', ['-C', repoDir, 'add', 'README.md']);
  execFileSync('git', ['-C', repoDir, 'commit', '-m', 'smoke'], {
    stdio: 'ignore',
  });

  const semanticVector = () => {
    const value = new Float32Array(E5_DIMENSIONS);
    value[0] = 1;
    return value;
  };

  const worker = await startEmbeddingIpcServer({
    socketPath,
    embedder: {
      modelId: E5_MODEL_ID,
      modelRevision: E5_MODEL_REVISION,
      dimensions: E5_DIMENSIONS,
      async embedQuery() {
        return semanticVector();
      },
      async embedPassages(texts) {
        return texts.map(() => semanticVector());
      },
    },
    platform: 'linux',
  });

  t.after(async () => {
    await worker.close();
    rmSync(root, { recursive: true, force: true });
  });

  const seed = new MemoryEngine({ dbPath });
  seed.registerProject({
    projectId,
    repoIdentity: projectId,
    canonicalRemote: projectId,
  });
  seed.ingest({
    evidence: {
      id: 'e-semantic',
      projectId,
      harness: 'codex',
      sessionId: 'seed',
      sourceKind: 'session',
      sourceRef: 'session:seed',
      capturedAt: '2026-09-30T18:00:00.000Z',
      branch: 'main',
      commitSha: null,
      path: null,
      blobOid: null,
      content: 'memory: database is Postgres',
      authorityClass: 'user_direct',
      metadata: {
        event_type: 'user_prompt',
        explicit_memory: true,
      },
    },
    claim: {
      id: 'c-semantic',
      kind: 'user_direct',
      subject: 'user memory',
      predicate: 'states',
      value: 'memory: database is Postgres',
      branchScope: 'main',
      createdAt: '2026-09-30T18:00:00.000Z',
    },
  });

  const seedEmbedder = createEmbeddingIpcClient({
    socketPath,
    modelId: E5_MODEL_ID,
    modelRevision: E5_MODEL_REVISION,
    dimensions: E5_DIMENSIONS,
    timeoutMs: 1_000,
  });
  const seedHybrid = new HybridMemoryRetriever({
    memory: seed,
    embedder: seedEmbedder,
  });
  assert.deepEqual(
    await seedHybrid.indexClaim('c-semantic'),
    { indexed: true },
  );

  const lexicalOnly = seed.recall({
    projectId,
    branch: 'main',
    query: 'Which storage engine handles several processes writing at the same time?',
    mode: 'current',
    limit: 10,
  });
  assert.equal(lexicalOnly.items.length, 0);
  seed.close();

  const output = await runCodexMemoryHook({
    event: {
      session_id: 'thr-hybrid-e2e',
      transcript_path: null,
      cwd: repoDir,
      hook_event_name: 'UserPromptSubmit',
      model: 'gpt-5.6-sol',
      permission_mode: 'default',
      turn_id: 'turn-hybrid-e2e',
      prompt: 'Which storage engine handles several processes writing at the same time?',
    },
    env: {
      ...process.env,
      AGENT_HUB_MEMORY_DB: dbPath,
      AGENT_HUB_MEMORY_PROJECT_ID: projectId,
      AGENT_HUB_MEMORY_REPO_IDENTITY: projectId,
    },
    configOptions: {
      hybridRecall: true,
      embeddingSocketPath: socketPath,
      embeddingTimeoutMs: 1_000,
    },
  });

  assert.equal(output.decision, undefined);
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /memory: database is Postgres/,
  );
});


test('hybrid UserPromptSubmit self-heals a missing worker from the prepared local cache', async () => {
  const memory = {
    getProject() {
      return { project_id: 'github.com/example/project' };
    },
    close() {},
  };

  const calls = [];
  const embedder = {
    modelId: E5_MODEL_ID,
    modelRevision: E5_MODEL_REVISION,
    dimensions: E5_DIMENSIONS,
    async embedQuery() {
      return new Float32Array(E5_DIMENSIONS);
    },
    async embedPassages() {
      return [new Float32Array(E5_DIMENSIONS)];
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

  await runCodexMemoryHook({
    event: event(),
    env: {},
    configOptions: {
      hybridRecall: true,
      embeddingCacheDir: 'C:/agent-hub/.cache/memory-engine/e5',
      embeddingSocketPath: 'test-pipe',
      embeddingStartupTimeoutMs: 4_000,
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
    embeddingCacheAvailable(cacheDir) {
      calls.push(['cache', cacheDir]);
      return true;
    },
    async ensureEmbeddingWorker(options) {
      calls.push(['ensure', options]);
      return {
        status: 'started',
        pid: 4242,
        socketPath: options.socketPath,
      };
    },
    createEmbeddingClient(options) {
      calls.push(['client', options]);
      return embedder;
    },
    createHybridRetriever(options) {
      calls.push(['retriever', options]);
      return hybridRetriever;
    },
    createProtocol() {
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

  assert.deepEqual(calls[0], [
    'cache',
    'C:/agent-hub/.cache/memory-engine/e5',
  ]);
  assert.equal(calls[1][0], 'ensure');
  assert.equal(calls[1][1].cacheDir, 'C:/agent-hub/.cache/memory-engine/e5');
  assert.equal(calls[1][1].socketPath, 'test-pipe');
  assert.equal(calls[1][1].startupTimeoutMs, 4_000);
  assert.equal(calls.some(([name]) => name === 'client'), true);
  assert.equal(calls.some(([name]) => name === 'retriever'), true);
});

test('hybrid UserPromptSubmit skips worker startup when the prepared cache is absent', async () => {
  const memory = {
    getProject() {
      return { project_id: 'github.com/example/project' };
    },
    close() {},
  };

  let ensureCalls = 0;
  await runCodexMemoryHook({
    event: event(),
    env: {},
    configOptions: {
      hybridRecall: true,
      embeddingCacheDir: 'C:/agent-hub/.cache/memory-engine/e5',
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
    embeddingCacheAvailable() {
      return false;
    },
    async ensureEmbeddingWorker() {
      ensureCalls += 1;
      throw new Error('must not be called without a prepared local cache');
    },
    createEmbeddingClient() {
      return {
        modelId: E5_MODEL_ID,
        modelRevision: E5_MODEL_REVISION,
        dimensions: E5_DIMENSIONS,
        async embedQuery() {
          throw new Error('worker unavailable');
        },
        async embedPassages() {
          throw new Error('worker unavailable');
        },
      };
    },
    createHybridRetriever() {
      return {
        async recall() {
          return { items: [], conflicts: [] };
        },
        async indexClaim() {
          return { indexed: false };
        },
      };
    },
    createProtocol() {
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

  assert.equal(ensureCalls, 0);
});
