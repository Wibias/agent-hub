import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseReindexSemanticArgs,
  reindexMemorySemantic,
  defaultSemanticOfflineCacheDir,
  ordinarySemanticCacheDirectory,
} from '../../scripts/reindex-memory-semantic.mjs';

test('semantic reindex CLI parses the explicit repair scope', () => {
  assert.deepEqual(
    parseReindexSemanticArgs([
      '--db-path',
      '/tmp/memory.sqlite3',
      '--project-id',
      'github.com/example/project',
      '--branch',
      'main',
      '--socket-path',
      '/tmp/embedding.sock',
    ]),
    {
      dbPath: '/tmp/memory.sqlite3',
      projectId: 'github.com/example/project',
      branch: 'main',
      socketPath: '/tmp/embedding.sock',
      cacheDir: null,
    },
  );

  assert.throws(
    () => parseReindexSemanticArgs(['--db-path', '/tmp/memory.sqlite3']),
    /--project-id is required/,
  );
});

test('semantic reindex probes the worker once and indexes every canonical Claim document', async () => {
  const calls = [];
  const memory = {
    getProject(projectId) {
      calls.push(['getProject', projectId]);
      return { project_id: projectId };
    },
    listEmbeddingDocuments(scope) {
      calls.push(['listEmbeddingDocuments', scope]);
      return [
        { claim_id: 'claim-a' },
        { claim_id: 'claim-b' },
      ];
    },
    close() {
      calls.push(['close']);
    },
  };

  const embedder = {
    modelId: 'intfloat/multilingual-e5-small',
    modelRevision: '6a0d452a575215f80b8f66276dd4ee5d504942c6',
    dimensions: 384,
    async embedQuery(text) {
      calls.push(['probe', text]);
      return new Float32Array(384);
    },
    async embedPassages() {
      throw new Error('not used by fake hybrid');
    },
  };

  const indexed = [];
  const result = await reindexMemorySemantic({
    dbPath: '/tmp/memory.sqlite3',
    projectId: 'github.com/example/project',
    branch: 'main',
    socketPath: '/tmp/embedding.sock',
    createEngine(options) {
      calls.push(['createEngine', options]);
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
      return {
        async indexClaim(claimId) {
          indexed.push(claimId);
          return { indexed: true };
        },
      };
    },
    log(value) {
      calls.push(['log', JSON.parse(value)]);
    },
  });

  assert.deepEqual(indexed, ['claim-a', 'claim-b']);
  assert.deepEqual(result, {
    projectId: 'github.com/example/project',
    branch: 'main',
    candidates: 2,
    indexed: 2,
    failed: 0,
    modelId: 'intfloat/multilingual-e5-small',
    modelRevision: '6a0d452a575215f80b8f66276dd4ee5d504942c6',
    dimensions: 384,
  });
  assert.equal(
    calls.filter(([name]) => name === 'probe').length,
    1,
  );
  assert.deepEqual(calls.at(-1), ['close']);
});

test('offline cache default is repo-local and missing cache is rejected', () => {
  assert.match(defaultSemanticOfflineCacheDir(), /[\\/][.]cache[\\/]memory-engine[\\/]e5$/);
  assert.equal(ordinarySemanticCacheDirectory('/missing/agenthub/e5'), false);
});

test('Windows reindex performs offline E5 fallback only when IPC unavailable and cache exists', async () => {
  const steps = [];
  const model = {
    modelId: 'intfloat/multilingual-e5-small',
    modelRevision: '6a0d452a575215f80b8f66276dd4ee5d504942c6',
    dimensions: 384,
    async embedQuery() { steps.push('offline_probe'); return new Float32Array(384); },
  };
  const result = await reindexMemorySemantic({
    dbPath: '/tmp/test.sqlite3', projectId: 'github.com/example/project', branch: 'main',
    platform: 'win32', cacheDir: '/cached-e5',
    createEngine() {
      return {
        getProject() { return { project_id: 'github.com/example/project' }; },
        listEmbeddingDocuments() { return [{ claim_id: 'claim-1' }]; },
        close() { steps.push('closed'); },
      };
    },
    createEmbeddingClient() { return {
      async embedQuery() { throw new Error('embedding worker unavailable'); },
    }; },
    offlineCacheExists(path) { assert.equal(path, '/cached-e5'); return true; },
    async createOfflineEmbedder(options) {
      assert.deepEqual(options, { cacheDir: '/cached-e5', allowRemoteModels: false });
      steps.push('offline_load');
      return model;
    },
    createHybridRetriever({ embedder }) {
      assert.equal(embedder, model);
      return { async indexClaim(id) {
        assert.equal(id, 'claim-1');
        steps.push('indexed');
        return { indexed: true };
      } };
    },
    log() {},
  });
  assert.equal(result.indexed, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(steps, ['offline_load', 'offline_probe', 'indexed', 'closed']);
});

test('Windows without E5 cache never downloads, creates pipe or indexes a Claim', async () => {
  let loaded = false;
  let closed = false;
  await assert.rejects(() => reindexMemorySemantic({
    dbPath: '/tmp/test.sqlite3', projectId: 'github.com/example/project', branch: 'main',
    platform: 'win32', cacheDir: '/no-e5',
    createEngine() { return {
      getProject() { return {}; },
      close() { closed = true; },
    }; },
    createEmbeddingClient() { return {
      async embedQuery() { throw new Error('embedding worker unavailable'); },
    }; },
    offlineCacheExists() { return false; },
    createOfflineEmbedder() { loaded = true; throw new Error('must not run'); },
  }), /offline E5 cache missing/);
  assert.equal(loaded, false);
  assert.equal(closed, true);
});

test('semantic fallback never masks model mismatch or bypasses a rejected IPC response', async () => {
  for (const platform of ['win32', 'linux']) {
    let fallback = false;
    await assert.rejects(() => reindexMemorySemantic({
      dbPath: '/tmp/test.sqlite3', projectId: 'github.com/example/project', branch: 'main',
      platform,
      createEngine() { return {
        getProject() { return {}; }, close() {},
      }; },
      createEmbeddingClient() { return {
        async embedQuery() { throw new Error('embedding worker model identity mismatch'); },
      }; },
      offlineCacheExists() { fallback = true; return true; },
    }), /embedding worker model identity mismatch/);
    assert.equal(fallback, false);
  }
});

test('Linux with unavailable pipe keeps existing failure behavior', async () => {
  let fallback = false;
  await assert.rejects(() => reindexMemorySemantic({
    dbPath: '/tmp/test.sqlite3', projectId: 'github.com/example/project', branch: 'main',
    platform: 'linux',
    createEngine() { return { getProject() { return {}; }, close() {} }; },
    createEmbeddingClient() { return {
      async embedQuery() { throw new Error('embedding worker unavailable'); },
    }; },
    offlineCacheExists() { fallback = true; return true; },
  }), /embedding worker unavailable/);
  assert.equal(fallback, false);
});
