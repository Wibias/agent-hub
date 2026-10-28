import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  buildMemoryGraph,
  expandMemoryGraph,
} from '../../memory-engine/memory-graph.mjs';

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-graph-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  memory.registerProject({
    projectId: 'github.com/example/graph',
    repoIdentity: 'github.com/example/graph',
    createdAt: '2026-10-28T10:00:00.000Z',
  });
  return { root, memory };
}

function ingest(memory, {
  claimId,
  value,
  createdAt,
  branch = 'main',
  lifecycle = {},
} = {}) {
  return memory.ingest({
    evidence: {
      id: `e-${claimId}`,
      projectId: 'github.com/example/graph',
      harness: 'codex',
      sessionId: 'graph-fixture',
      sourceKind: 'session',
      sourceRef: 'session:graph-fixture',
      capturedAt: createdAt,
      branch,
      commitSha: null,
      path: null,
      blobOid: null,
      content: value,
      authorityClass: 'user_direct',
      metadata: { event_type: 'user_prompt' },
    },
    claim: {
      id: claimId,
      kind: 'user_direct',
      subject: 'memory graph',
      predicate: 'states',
      value,
      state: 'active',
      branchScope: branch,
      createdAt,
    },
    lifecycle,
  });
}

function indexEmbedding(memory, claimId, vector, {
  modelId = 'test/graph-embed',
  modelRevision = 'r1',
} = {}) {
  const document = memory.embeddingDocument({ claimId });
  memory.putClaimEmbedding({
    claimId,
    modelId,
    modelRevision,
    textHash: document.text_hash,
    dimensions: vector.length,
    vector: Float32Array.from(vector),
    indexedAt: '2026-10-28T12:00:00.000Z',
  });
}

function hasPropertyDeep(value, propertyName) {
  if (Array.isArray(value)) {
    return value.some((item) => hasPropertyDeep(item, propertyName));
  }
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, propertyName)) return true;
  return Object.values(value).some((item) => hasPropertyDeep(item, propertyName));
}

test('memory graph exposes real claims, explicit relations, and bounded inferred similarity without vectors', async (t) => {
  const { root, memory } = await createFixture();
  t.after(async () => {
    memory.close();
    await rm(root, { recursive: true, force: true });
  });

  ingest(memory, {
    claimId: 'claim-old',
    value: 'Old memory about Codex recall.',
    createdAt: '2026-10-28T10:01:00.000Z',
  });
  ingest(memory, {
    claimId: 'claim-new',
    value: 'New memory about Codex recall.',
    createdAt: '2026-10-28T10:02:00.000Z',
    lifecycle: { supersedes: ['claim-old'] },
  });
  ingest(memory, {
    claimId: 'claim-related',
    value: 'Related memory about memory retrieval.',
    createdAt: '2026-10-28T10:03:00.000Z',
    lifecycle: { conflictsWith: ['claim-new'] },
  });
  ingest(memory, {
    claimId: 'claim-other-profile',
    value: 'Same vector but incompatible profile.',
    createdAt: '2026-10-28T10:04:00.000Z',
  });
  ingest(memory, {
    claimId: 'claim-feature',
    value: 'Feature branch memory.',
    branch: 'feature/graph',
    createdAt: '2026-10-28T10:05:00.000Z',
  });

  indexEmbedding(memory, 'claim-new', [1, 0, 0]);
  indexEmbedding(memory, 'claim-related', [0.99, 0.1, 0]);
  indexEmbedding(memory, 'claim-old', [0, 1, 0]);
  indexEmbedding(memory, 'claim-other-profile', [1, 0, 0], {
    modelRevision: 'r2',
  });
  indexEmbedding(memory, 'claim-feature', [1, 0, 0]);

  const graph = buildMemoryGraph(memory, {
    projectId: 'github.com/example/graph',
    branch: 'main',
    semanticThreshold: 0.82,
    maxSemanticNeighbors: 2,
  });

  assert.equal(graph.schemaVersion, 1);
  assert.equal(graph.projectId, 'github.com/example/graph');
  assert.equal(graph.branch, 'main');
  assert.equal(graph.stats.truncated, false);
  assert.deepEqual(
    graph.nodes.map((node) => node.id).sort(),
    ['claim-new', 'claim-old', 'claim-other-profile', 'claim-related'],
  );
  assert.equal(graph.nodes.some((node) => node.id === 'claim-feature'), false);
  assert.equal(
    hasPropertyDeep(graph, 'vector'),
    false,
    'browser-safe graph payload must not expose embedding vector properties',
  );

  const supersedes = graph.edges.find((edge) => edge.relation === 'supersedes');
  assert.deepEqual(
    {
      from: supersedes?.from,
      to: supersedes?.to,
      origin: supersedes?.origin,
      directed: supersedes?.directed,
    },
    {
      from: 'claim-new',
      to: 'claim-old',
      origin: 'explicit',
      directed: true,
    },
  );

  const conflict = graph.edges.find((edge) => edge.relation === 'conflicts_with');
  assert.equal(conflict?.origin, 'explicit');
  assert.equal(conflict?.directed, false);
  assert.deepEqual(
    [conflict?.from, conflict?.to].sort(),
    ['claim-new', 'claim-related'],
  );

  const semantic = graph.edges.filter((edge) => edge.relation === 'semantic_similarity');
  assert.equal(semantic.length, 1);
  assert.deepEqual(
    [semantic[0].from, semantic[0].to].sort(),
    ['claim-new', 'claim-related'],
  );
  assert.equal(semantic[0].origin, 'inferred');
  assert.equal(semantic[0].directed, false);
  assert.equal(semantic[0].weight > 0.98, true);
  assert.equal(semantic[0].provenance.modelId, 'test/graph-embed');
  assert.equal(semantic[0].provenance.modelRevision, 'r1');
});

test('memory graph truncation is deterministic and reports omitted claims', async (t) => {
  const { root, memory } = await createFixture();
  t.after(async () => {
    memory.close();
    await rm(root, { recursive: true, force: true });
  });

  ingest(memory, {
    claimId: 'claim-a',
    value: 'Old active',
    createdAt: '2026-10-28T10:01:00.000Z',
  });
  ingest(memory, {
    claimId: 'claim-b',
    value: 'Newest active',
    createdAt: '2026-10-28T10:03:00.000Z',
  });
  ingest(memory, {
    claimId: 'claim-c',
    value: 'Middle active',
    createdAt: '2026-10-28T10:02:00.000Z',
  });

  const graph = buildMemoryGraph(memory, {
    projectId: 'github.com/example/graph',
    branch: 'main',
    maxNodes: 2,
    includeSemantic: false,
  });

  assert.deepEqual(graph.nodes.map((node) => node.id), ['claim-b', 'claim-c']);
  assert.equal(graph.stats.truncated, true);
  assert.equal(graph.stats.totalClaims, 3);
  assert.equal(graph.stats.omittedClaims, 1);
});

test('bounded graph expansion respects hops, candidate cap, edge weight, and cycles', () => {
  const graph = {
    schemaVersion: 1,
    nodes: [
      { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' },
    ],
    edges: [
      { id: 'a-b', from: 'a', to: 'b', relation: 'supersedes', origin: 'explicit', directed: true, weight: 1 },
      { id: 'b-c', from: 'b', to: 'c', relation: 'semantic_similarity', origin: 'inferred', directed: false, weight: 0.95 },
      { id: 'c-a', from: 'c', to: 'a', relation: 'conflicts_with', origin: 'explicit', directed: false, weight: 1 },
      { id: 'a-d', from: 'a', to: 'd', relation: 'semantic_similarity', origin: 'inferred', directed: false, weight: 0.7 },
      { id: 'c-e', from: 'c', to: 'e', relation: 'semantic_similarity', origin: 'inferred', directed: false, weight: 0.9 },
    ],
  };

  const oneHop = expandMemoryGraph(graph, {
    anchorIds: ['a'],
    maxHops: 1,
    maxCandidates: 8,
    minWeight: 0.82,
  });
  assert.deepEqual(oneHop.claimIds, ['a', 'b', 'c']);
  assert.equal(oneHop.traversedEdges.some((edge) => edge.id === 'a-d'), false);

  const capped = expandMemoryGraph(graph, {
    anchorIds: ['a'],
    maxHops: 2,
    maxCandidates: 3,
    minWeight: 0.82,
  });
  assert.deepEqual(capped.claimIds, ['a', 'b', 'c']);
  assert.equal(new Set(capped.claimIds).size, capped.claimIds.length);

  const unknown = expandMemoryGraph(graph, {
    anchorIds: ['missing'],
  });
  assert.deepEqual(unknown.claimIds, []);
  assert.deepEqual(unknown.traversedEdges, []);
});
