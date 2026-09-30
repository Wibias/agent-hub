import test from 'node:test';
import assert from 'node:assert/strict';

import { HybridMemoryRetriever } from '../../memory-engine/hybrid-retrieval.mjs';
import {
  createCodexMemoryHookAdapter,
  memoryClaimRef,
  parseExplicitMemoryPrompt,
} from '../../memory-engine/adapters/codex-hooks.mjs';
import {
  runCodexMemoryHook,
} from '../../memory-engine/adapters/codex-hook-cli.mjs';

function recallItem(id, {
  authority = 'user_direct',
  createdAt = '2026-09-30T20:00:00.000Z',
  value = id,
} = {}) {
  return {
    claim: {
      id,
      project_id: 'project-a',
      kind: 'user_direct',
      subject: 'user memory',
      predicate: 'states',
      value,
      state: 'active',
      branch_scope: 'main',
      created_from_evidence_id: `e-${id}`,
      created_at: createdAt,
      valid_from: null,
      valid_until: null,
      superseded_by_claim_id: null,
      rejected_by_evidence_id: null,
    },
    evidence: {
      id: `e-${id}`,
      project_id: 'project-a',
      harness: 'codex',
      session_id: 'seed',
      source_kind: 'session',
      source_ref: 'session:seed',
      captured_at: createdAt,
      branch: 'main',
      commit_sha: null,
      path: null,
      blob_oid: null,
      content_redacted: value,
      sensitivity: 'normal',
      authority_class: authority,
      metadata: {},
    },
    freshness: null,
    rank: 0,
  };
}

function diagnosticMemory() {
  const items = new Map([
    ['a', recallItem('a', { value: 'memory: exact lexical token' })],
    ['b', recallItem('b', { value: 'memory: database is Postgres' })],
    ['c', recallItem('c', { value: 'memory: storage uses SQLite' })],
  ]);

  return {
    recall() {
      return {
        items: [items.get('a'), items.get('b')],
        conflicts: [],
      };
    },
    semanticCandidates() {
      return [
        {
          claim_id: 'b',
          created_at: '2026-09-30T20:00:00.000Z',
          dimensions: 2,
          vector: new Float32Array([1, 0]),
        },
        {
          claim_id: 'c',
          created_at: '2026-09-30T19:00:00.000Z',
          dimensions: 2,
          vector: new Float32Array([0.8, 0.2]),
        },
      ];
    },
    materializeRecall({ claimIds }) {
      return {
        items: claimIds.map((id, index) => ({
          ...items.get(id),
          rank: index,
        })),
        conflicts: [],
      };
    },
  };
}

function fakeEmbedder({ failQuery = false } = {}) {
  return {
    modelId: 'fake-e5',
    modelRevision: 'rev-1',
    dimensions: 2,
    async embedQuery() {
      if (failQuery) throw new Error('offline');
      return new Float32Array([1, 0]);
    },
    async embedPassages(texts) {
      return texts.map(() => new Float32Array([1, 0]));
    },
  };
}

test('hybrid recall diagnostics expose lexical, semantic, and fused ranks', async () => {
  const retriever = new HybridMemoryRetriever({
    memory: diagnosticMemory(),
    embedder: fakeEmbedder(),
  });

  const result = await retriever.diagnoseRecall({
    projectId: 'project-a',
    branch: 'main',
    query: 'Which storage engine handles concurrent writers?',
    maxItems: 10,
  });

  assert.equal(result.retrievalMode, 'hybrid');
  assert.equal(result.fallbackReason, null);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.item.claim.id),
    ['b', 'a', 'c'],
  );

  const [first, second, third] = result.candidates;
  assert.deepEqual(
    {
      lexicalRank: first.lexicalRank,
      semanticRank: first.semanticRank,
      finalRank: first.finalRank,
    },
    {
      lexicalRank: 2,
      semanticRank: 1,
      finalRank: 1,
    },
  );
  assert.equal(first.semanticSimilarity, 1);
  assert.ok(first.rrfScore > second.rrfScore);
  assert.equal(second.lexicalRank, 1);
  assert.equal(second.semanticRank, null);
  assert.equal(third.lexicalRank, null);
  assert.equal(third.semanticRank, 2);
});

test('recall diagnostics report query embedding fallback without changing lexical order', async () => {
  const retriever = new HybridMemoryRetriever({
    memory: diagnosticMemory(),
    embedder: fakeEmbedder({ failQuery: true }),
  });

  const result = await retriever.diagnoseRecall({
    projectId: 'project-a',
    branch: 'main',
    query: 'Which storage engine handles concurrent writers?',
    maxItems: 10,
  });

  assert.equal(result.retrievalMode, 'lexical');
  assert.equal(result.fallbackReason, 'query_embedding_failed');
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.item.claim.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.semanticRank),
    [null, null],
  );
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.rrfScore),
    [null, null],
  );
});

test('memory explain parses as an explicit read-only memory command', () => {
  assert.deepEqual(
    parseExplicitMemoryPrompt(
      'memory explain: Which storage engine handles concurrent writers?',
    ),
    {
      mode: 'explain',
      query: 'Which storage engine handles concurrent writers?',
    },
  );
});

test('memory explain is consumed and shows retrieval plus answer-reliance decisions', async () => {
  const selected = recallItem('selected', {
    authority: 'user_direct',
    value: 'memory: database is Postgres',
  });
  const blocked = recallItem('blocked', {
    authority: 'external_untrusted',
    value: 'memory: database is SQLite',
  });

  const diagnosticCalls = [];
  const adapter = createCodexMemoryHookAdapter({
    protocol: {
      async handle() {
        throw new Error('memory explain must not capture or perform normal recall');
      },
    },
    memory: {},
    projectId: 'project-a',
    explicitMemoryRequests: true,
    diagnoseRecall: async (args) => {
      diagnosticCalls.push(args);
      return {
        retrievalMode: 'hybrid',
        fallbackReason: null,
        candidates: [
          {
            item: selected,
            lexicalRank: 2,
            semanticRank: 1,
            semanticSimilarity: 0.912345,
            finalRank: 1,
            rrfScore: 0.0325,
          },
          {
            item: blocked,
            lexicalRank: 1,
            semanticRank: 2,
            semanticSimilarity: 0.812345,
            finalRank: 2,
            rrfScore: 0.0322,
          },
        ],
        conflicts: [],
      };
    },
    git: {
      resolveContext() {
        return {
          repoPath: '/repo/project',
          branch: 'main',
          revisionSha: 'a'.repeat(40),
        };
      },
      refreshFreshness() {},
    },
  });

  const output = await adapter.handle({
    session_id: 'thr-explain',
    transcript_path: null,
    cwd: '/repo/project',
    hook_event_name: 'UserPromptSubmit',
    model: 'gpt-5.6-sol',
    permission_mode: 'default',
    turn_id: 'turn-explain',
    prompt: 'memory explain: Which storage engine handles concurrent writers?',
  });

  assert.equal(diagnosticCalls.length, 1);
  assert.equal(
    diagnosticCalls[0].query,
    'Which storage engine handles concurrent writers?',
  );
  assert.equal(output.decision, 'block');
  assert.match(output.reason, /Recall diagnostics/i);
  assert.match(output.reason, /Mode: hybrid/i);
  assert.match(output.reason, new RegExp(memoryClaimRef('selected')));
  assert.match(output.reason, /lexical #2/i);
  assert.match(output.reason, /semantic #1/i);
  assert.match(output.reason, /final #1/i);
  assert.match(output.reason, /answer: selected/i);
  assert.match(output.reason, new RegExp(memoryClaimRef('blocked')));
  assert.match(output.reason, /answer: blocked/i);
  assert.match(output.reason, /authority_not_allowed_for_answer/i);
});

test('Codex CLI wires the active retriever into recall diagnostics', async () => {
  const memory = {
    getProject() {
      return { project_id: 'project-a' };
    },
    close() {},
  };

  let adapterOptions = null;
  let diagnosed = false;
  const output = await runCodexMemoryHook({
    event: {
      session_id: 'thr-cli-explain',
      transcript_path: null,
      cwd: '/repo/project',
      hook_event_name: 'UserPromptSubmit',
      model: 'gpt-5.6-sol',
      permission_mode: 'default',
      turn_id: 'turn-cli-explain',
      prompt: 'memory explain: database choice',
    },
    env: {},
    configOptions: {
      hybridRecall: true,
      explicitMemoryRequests: true,
    },
    resolveProjectScope() {
      return {
        projectId: 'project-a',
        repoIdentity: 'project-a',
        canonicalRemote: 'project-a',
      };
    },
    ensureDbDirectory() {},
    createEngine() {
      return memory;
    },
    createEmbeddingClient() {
      return fakeEmbedder();
    },
    createHybridRetriever() {
      return {
        async recall() {
          return { items: [], conflicts: [] };
        },
        async indexClaim() {
          return { indexed: true };
        },
        async diagnoseRecall() {
          diagnosed = true;
          return {
            retrievalMode: 'hybrid',
            fallbackReason: null,
            candidates: [],
            conflicts: [],
          };
        },
      };
    },
    createProtocol() {
      return { handle() {} };
    },
    createAdapter(options) {
      adapterOptions = options;
      return {
        async handle() {
          assert.equal(typeof options.diagnoseRecall, 'function');
          const result = await options.diagnoseRecall({
            projectId: 'project-a',
            branch: 'main',
            query: 'database choice',
          });
          return {
            decision: 'block',
            reason: result.retrievalMode,
          };
        },
      };
    },
  });

  assert.equal(adapterOptions.projectId, 'project-a');
  assert.equal(diagnosed, true);
  assert.deepEqual(output, {
    decision: 'block',
    reason: 'hybrid',
  });
});
