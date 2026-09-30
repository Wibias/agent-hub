import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseReindexSemanticArgs,
  reindexMemorySemantic,
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
