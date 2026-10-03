import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  MemoryEngine,
  evaluateReliance,
} from '../../memory-engine/index.mjs';
import { hashEmbeddingText } from '../../memory-engine/semantic-vectors.mjs';

async function createEngine(name) {
  const root = await mkdtemp(join(tmpdir(), `memory-engine-hybrid-${name}-`));
  return new MemoryEngine({
    dbPath: join(root, 'memory.sqlite3'),
    clock: () => '2026-01-02T12:00:00Z',
  });
}

test('embedding document uses deterministic redacted passage text', async (t) => {
  const engine = await createEngine('document');
  t.after(() => engine.close());

  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  engine.ingest({
    evidence: {
      id: 'e-postgres',
      projectId: 'project-a',
      harness: 'codex',
      sessionId: 'session-1',
      sourceKind: 'session',
      sourceRef: 'session:session-1',
      capturedAt: '2026-01-02T09:00:00Z',
      branch: 'main',
      commitSha: null,
      path: null,
      blobOid: null,
      content: 'Use   Postgres. password=supersecret123',
      authorityClass: 'user_direct',
      metadata: { fixture: true },
    },
    claim: {
      id: 'c-postgres',
      kind: 'decision',
      subject: 'database',
      predicate: 'uses',
      value: 'Postgres',
      branchScope: 'main',
      createdAt: '2026-01-02T09:00:00Z',
    },
  });

  const document = engine.embeddingDocument({ claimId: 'c-postgres' });
  const text = 'passage: decision database uses Postgres Use Postgres. [REDACTED_SECRET]';

  assert.deepEqual(document, {
    claim_id: 'c-postgres',
    project_id: 'project-a',
    branch_scope: 'main',
    created_at: '2026-01-02T09:00:00Z',
    text,
    text_hash: hashEmbeddingText(text),
  });
  assert.equal(document.text.includes('supersecret123'), false);
});

test('embedding document listing is deterministic and branch scoped while retaining history', async (t) => {
  const engine = await createEngine('document-list');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  const ingest = ({ evidenceId, claimId, branch, value, createdAt, lifecycle = {} }) => {
    engine.ingest({
      evidence: {
        id: evidenceId,
        projectId: 'project-a',
        harness: 'codex',
        sessionId: evidenceId,
        sourceKind: 'session',
        sourceRef: `session:${evidenceId}`,
        capturedAt: createdAt,
        branch,
        commitSha: null,
        path: null,
        blobOid: null,
        content: `Use ${value}.`,
        authorityClass: 'user_direct',
        metadata: {},
      },
      claim: {
        id: claimId,
        kind: 'decision',
        subject: 'database',
        predicate: 'uses',
        value,
        branchScope: branch,
        createdAt,
      },
      lifecycle,
    });
  };

  ingest({
    evidenceId: 'e-b',
    claimId: 'claim-b',
    branch: 'main',
    value: 'SQLite',
    createdAt: '2026-01-02T09:00:00Z',
  });
  ingest({
    evidenceId: 'e-a',
    claimId: 'claim-a',
    branch: 'main',
    value: 'Postgres',
    createdAt: '2026-01-02T09:10:00Z',
    lifecycle: { supersedes: ['claim-b'] },
  });
  ingest({
    evidenceId: 'e-feature',
    claimId: 'claim-feature',
    branch: 'feature/search',
    value: 'DuckDB',
    createdAt: '2026-01-02T09:20:00Z',
  });

  const documents = engine.listEmbeddingDocuments({
    projectId: 'project-a',
    branch: 'main',
  });

  assert.deepEqual(documents.map((row) => row.claim_id), ['claim-a', 'claim-b']);
});


function ingestSemanticClaim(engine, {
  projectId = 'project-a',
  evidenceId,
  claimId,
  branch = 'main',
  state = 'active',
  value,
  createdAt,
  path = null,
  blobOid = null,
  lifecycle = {},
}) {
  engine.ingest({
    evidence: {
      id: evidenceId,
      projectId,
      harness: 'codex',
      sessionId: evidenceId,
      sourceKind: path ? 'repository' : 'session',
      sourceRef: path ?? `session:${evidenceId}`,
      capturedAt: createdAt,
      branch,
      commitSha: path ? 'a'.repeat(40) : null,
      path,
      blobOid,
      content: `Memory says ${value}.`,
      authorityClass: 'user_direct',
      metadata: {},
    },
    claim: {
      id: claimId,
      kind: 'decision',
      subject: 'storage',
      predicate: 'uses',
      value,
      state,
      branchScope: branch,
      createdAt,
    },
    lifecycle,
  });

  const document = engine.embeddingDocument({ claimId });
  engine.putClaimEmbedding({
    claimId,
    modelId: 'fake-e5',
    modelRevision: 'rev-1',
    textHash: document.text_hash,
    dimensions: 3,
    vector: new Float32Array([1, 0, 0]),
  });
}

test('semantic candidates reuse current recall eligibility and preserve historical scope', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-hybrid-candidates-'));
  const dbPath = join(root, 'memory.sqlite3');
  const engine = new MemoryEngine({
    dbPath,
    clock: () => '2026-01-02T12:00:00Z',
  });
  t.after(() => engine.close());

  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  engine.registerProject({ projectId: 'project-b', repoIdentity: 'project-b' });

  ingestSemanticClaim(engine, {
    evidenceId: 'e-old',
    claimId: 'c-old',
    value: 'SQLite',
    createdAt: '2026-01-02T08:00:00Z',
  });
  ingestSemanticClaim(engine, {
    evidenceId: 'e-current',
    claimId: 'c-current',
    value: 'Postgres',
    createdAt: '2026-01-02T09:00:00Z',
    lifecycle: { supersedes: ['c-old'] },
  });
  ingestSemanticClaim(engine, {
    evidenceId: 'e-candidate',
    claimId: 'c-candidate',
    state: 'candidate',
    value: 'CockroachDB proposal',
    createdAt: '2026-01-02T09:05:00Z',
  });
  ingestSemanticClaim(engine, {
    evidenceId: 'e-feature',
    claimId: 'c-feature',
    branch: 'feature/search',
    value: 'DuckDB',
    createdAt: '2026-01-02T09:10:00Z',
  });
  ingestSemanticClaim(engine, {
    projectId: 'project-b',
    evidenceId: 'e-other',
    claimId: 'c-other',
    value: 'MySQL',
    createdAt: '2026-01-02T09:15:00Z',
  });
  ingestSemanticClaim(engine, {
    evidenceId: 'e-fresh',
    claimId: 'c-repo-fresh',
    value: 'fresh repository policy',
    createdAt: '2026-01-02T09:20:00Z',
    path: 'docs/fresh.md',
    blobOid: '1'.repeat(40),
  });
  ingestSemanticClaim(engine, {
    evidenceId: 'e-stale',
    claimId: 'c-repo-stale',
    value: 'stale repository policy',
    createdAt: '2026-01-02T09:25:00Z',
    path: 'docs/stale.md',
    blobOid: '2'.repeat(40),
  });

  const revisionSha = 'b'.repeat(40);
  engine.recordRepositoryPathState({
    projectId: 'project-a',
    branch: 'main',
    path: 'docs/fresh.md',
    commitSha: revisionSha,
    blobOid: '1'.repeat(40),
  });
  engine.recordRepositoryPathState({
    projectId: 'project-a',
    branch: 'main',
    path: 'docs/stale.md',
    commitSha: revisionSha,
    blobOid: '3'.repeat(40),
  });

  engine.putClaimEmbedding({
    claimId: 'c-current',
    modelId: 'fake-e5',
    modelRevision: 'rev-2',
    textHash: engine.embeddingDocument({ claimId: 'c-current' }).text_hash,
    dimensions: 3,
    vector: new Float32Array([0, 1, 0]),
  });

  const current = engine.semanticCandidates({
    projectId: 'project-a',
    branch: 'main',
    revisionSha,
    mode: 'current',
    modelId: 'fake-e5',
    modelRevision: 'rev-1',
  });

  assert.deepEqual(
    current.map((row) => row.claim_id).sort(),
    ['c-current', 'c-repo-fresh'],
  );
  assert.ok(current.every((row) => row.vector instanceof Float32Array));
  assert.ok(current.every((row) => row.dimensions === 3));

  const historical = engine.semanticCandidates({
    projectId: 'project-a',
    branch: 'main',
    revisionSha,
    mode: 'historical',
    modelId: 'fake-e5',
    modelRevision: 'rev-1',
  });

  assert.deepEqual(
    historical.map((row) => row.claim_id).sort(),
    ['c-candidate', 'c-current', 'c-old', 'c-repo-fresh', 'c-repo-stale'],
  );
});

test('semantic candidates skip corrupt derived vectors instead of failing recall', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-hybrid-corrupt-'));
  const dbPath = join(root, 'memory.sqlite3');
  const engine = new MemoryEngine({ dbPath });
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  ingestSemanticClaim(engine, {
    evidenceId: 'e-good',
    claimId: 'c-good',
    value: 'Postgres',
    createdAt: '2026-01-02T09:00:00Z',
  });
  ingestSemanticClaim(engine, {
    evidenceId: 'e-bad',
    claimId: 'c-bad',
    value: 'SQLite',
    createdAt: '2026-01-02T09:01:00Z',
  });

  const tamper = new DatabaseSync(dbPath);
  t.after(() => tamper.close());
  tamper.prepare(`
    UPDATE claim_embeddings
    SET vector_blob = ?
    WHERE claim_id = ? AND model_id = ? AND model_revision = ?
  `).run(Buffer.alloc(4), 'c-bad', 'fake-e5', 'rev-1');

  const candidates = engine.semanticCandidates({
    projectId: 'project-a',
    branch: 'main',
    mode: 'current',
    modelId: 'fake-e5',
    modelRevision: 'rev-1',
  });

  assert.deepEqual(candidates.map((row) => row.claim_id), ['c-good']);
});


test('materialize recall preserves requested eligible order and rechecks lifecycle state', async (t) => {
  const engine = await createEngine('materialize-order');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  ingestSemanticClaim(engine, {
    evidenceId: 'e-old-materialize',
    claimId: 'c-old-materialize',
    value: 'SQLite',
    createdAt: '2026-01-02T08:00:00Z',
  });
  ingestSemanticClaim(engine, {
    evidenceId: 'e-current-materialize',
    claimId: 'c-current-materialize',
    value: 'Postgres',
    createdAt: '2026-01-02T09:00:00Z',
    lifecycle: { supersedes: ['c-old-materialize'] },
  });
  ingestSemanticClaim(engine, {
    evidenceId: 'e-secondary-materialize',
    claimId: 'c-secondary-materialize',
    value: 'Redis',
    createdAt: '2026-01-02T09:10:00Z',
  });

  const materialized = engine.materializeRecall({
    projectId: 'project-a',
    branch: 'main',
    mode: 'current',
    claimIds: [
      'c-secondary-materialize',
      'c-old-materialize',
      'c-current-materialize',
    ],
  });

  assert.deepEqual(
    materialized.items.map((item) => item.claim.id),
    ['c-secondary-materialize', 'c-current-materialize'],
  );

  const lexical = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'Postgres',
    mode: 'current',
  });
  assert.deepEqual(
    Object.keys(materialized.items[1]).sort(),
    Object.keys(lexical.items[0]).sort(),
  );
  assert.deepEqual(
    Object.keys(materialized.items[1].claim).sort(),
    Object.keys(lexical.items[0].claim).sort(),
  );
  assert.deepEqual(
    Object.keys(materialized.items[1].evidence).sort(),
    Object.keys(lexical.items[0].evidence).sort(),
  );
});

test('materialize recall keeps unresolved conflict visible when counterpart is omitted', async (t) => {
  const engine = await createEngine('materialize-conflict');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  ingestSemanticClaim(engine, {
    evidenceId: 'e-conflict-a',
    claimId: 'c-conflict-a',
    value: 'retry 3 times',
    createdAt: '2026-01-02T09:00:00Z',
  });

  engine.ingest({
    evidence: {
      id: 'e-conflict-b',
      projectId: 'project-a',
      harness: 'codex',
      sessionId: 'e-conflict-b',
      sourceKind: 'session',
      sourceRef: 'session:e-conflict-b',
      capturedAt: '2026-01-02T09:10:00Z',
      branch: 'main',
      commitSha: null,
      path: null,
      blobOid: null,
      content: 'Memory says retry 5 times.',
      authorityClass: 'user_direct',
      metadata: {},
    },
    claim: {
      id: 'c-conflict-b',
      kind: 'decision',
      subject: 'retry',
      predicate: 'count',
      value: '5',
      branchScope: 'main',
      createdAt: '2026-01-02T09:10:00Z',
    },
    lifecycle: { conflictsWith: ['c-conflict-a'] },
  });

  const materialized = engine.materializeRecall({
    projectId: 'project-a',
    branch: 'main',
    mode: 'current',
    claimIds: ['c-conflict-a'],
  });

  assert.deepEqual(materialized.items.map((item) => item.claim.id), ['c-conflict-a']);
  assert.equal(materialized.conflicts.length, 1);
  assert.deepEqual(
    [materialized.conflicts[0].claim_a, materialized.conflicts[0].claim_b],
    ['c-conflict-a', 'c-conflict-b'],
  );

  const reliance = evaluateReliance({
    items: materialized.items,
    conflicts: materialized.conflicts,
    use: 'answer',
  });

  assert.deepEqual(reliance.selected, []);
  assert.equal(
    reliance.blocked.find((entry) => entry.item.claim.id === 'c-conflict-a')?.reason,
    'unresolved_conflict_counterpart_not_retrieved',
  );
  assert.equal(reliance.conflict_resolutions[0].status, 'unresolved_missing_counterpart');
});


test('reciprocal rank fusion rewards agreement and uses deterministic tie breakers', async () => {
  const { reciprocalRankFuse } = await import('../../memory-engine/hybrid-retrieval.mjs');

  assert.deepEqual(
    reciprocalRankFuse({
      lexicalIds: ['a', 'b'],
      semanticIds: ['b', 'c'],
      createdAtById: new Map([
        ['a', '2026-01-01T00:00:00Z'],
        ['b', '2026-01-02T00:00:00Z'],
        ['c', '2026-01-03T00:00:00Z'],
      ]),
    }),
    ['b', 'a', 'c'],
  );

  assert.deepEqual(
    reciprocalRankFuse({
      lexicalIds: ['z'],
      semanticIds: ['a'],
      createdAtById: new Map([
        ['z', '2026-01-01T00:00:00Z'],
        ['a', '2026-01-01T00:00:00Z'],
      ]),
    }),
    ['a', 'z'],
    'claim id is the final ascending tie breaker',
  );
});

test('reciprocal rank fusion defaults to k=60', async () => {
  const { reciprocalRankFuse } = await import('../../memory-engine/hybrid-retrieval.mjs');

  const lexicalIds = ['a', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'b'];
  const semanticIds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 'b'];
  const ids = [...new Set([...lexicalIds, ...semanticIds])];
  const createdAtById = new Map(ids.map((id) => [id, '2026-01-01T00:00:00Z']));

  const defaults = reciprocalRankFuse({ lexicalIds, semanticIds, createdAtById });
  const explicit60 = reciprocalRankFuse({
    lexicalIds,
    semanticIds,
    createdAtById,
    k: 60,
  });
  const explicit1 = reciprocalRankFuse({
    lexicalIds,
    semanticIds,
    createdAtById,
    k: 1,
  });

  assert.deepEqual(defaults, explicit60);
  assert.ok(defaults.indexOf('b') < defaults.indexOf('a'));
  assert.ok(explicit1.indexOf('a') < explicit1.indexOf('b'));
});

test('recall budget enforces item and serialized byte caps in fused order', async () => {
  const { enforceRecallBudget } = await import('../../memory-engine/hybrid-retrieval.mjs');

  const result = {
    items: Array.from({ length: 12 }, (_, index) => ({
      claim: { id: `c-${String(index).padStart(2, '0')}` },
      evidence: { content_redacted: 'x'.repeat(4_000) },
      freshness: null,
      rank: index,
    })),
    conflicts: [],
  };

  const bounded = enforceRecallBudget(result, {
    maxItems: 10,
    maxSerializedBytes: 16_384,
  });

  assert.ok(bounded.items.length <= 10);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= 16_384);
  assert.deepEqual(
    bounded.items.map((item) => item.claim.id),
    result.items.slice(0, bounded.items.length).map((item) => item.claim.id),
  );
});

test('recall budget preserves conflicts attached to retained items', async () => {
  const { enforceRecallBudget } = await import('../../memory-engine/hybrid-retrieval.mjs');

  const result = {
    items: [
      { claim: { id: 'a' }, evidence: {}, freshness: null, rank: 0 },
      { claim: { id: 'b' }, evidence: {}, freshness: null, rank: 1 },
      { claim: { id: 'c' }, evidence: {}, freshness: null, rank: 2 },
    ],
    conflicts: [
      { claim_a: 'a', claim_b: 'b', state: 'open' },
      { claim_a: 'b', claim_b: 'c', state: 'open' },
    ],
  };

  const bounded = enforceRecallBudget(result, {
    maxItems: 1,
    maxSerializedBytes: 16_384,
  });

  assert.deepEqual(bounded.items.map((item) => item.claim.id), ['a']);
  assert.deepEqual(bounded.conflicts, [
    { claim_a: 'a', claim_b: 'b', state: 'open' },
  ]);
});

test('recall budget rejects limits outside the architecture contract', async () => {
  const { enforceRecallBudget } = await import('../../memory-engine/hybrid-retrieval.mjs');
  const result = { items: [], conflicts: [] };

  assert.throws(
    () => enforceRecallBudget(result, { maxItems: 11, maxSerializedBytes: 16_384 }),
    /maxItems/i,
  );
  assert.throws(
    () => enforceRecallBudget(result, { maxItems: 10, maxSerializedBytes: 16_385 }),
    /maxSerializedBytes/i,
  );
});


function createFakeEmbedder({
  failQuery = false,
  failPassages = false,
} = {}) {
  const calls = {
    queries: [],
    passages: [],
  };

  return {
    modelId: 'fake-e5',
    modelRevision: 'rev-1',
    dimensions: 3,
    calls,
    async embedQuery(text) {
      calls.queries.push(text);
      if (failQuery) throw new Error('forced query embedding failure');
      if (/multiple processes writing|paralleler Schreibzugriffe/i.test(text)) {
        return new Float32Array([1, 0, 0]);
      }
      return new Float32Array([0, 1, 0]);
    },
    async embedPassages(texts) {
      calls.passages.push([...texts]);
      if (failPassages) throw new Error('forced passage embedding failure');
      return texts.map((text) => (
        /Postgres/i.test(text)
          ? new Float32Array([1, 0, 0])
          : new Float32Array([0, 1, 0])
      ));
    },
  };
}

function ingestRawHybridClaim(engine, {
  evidenceId,
  claimId,
  value,
  createdAt = '2026-01-02T09:00:00Z',
  branch = 'main',
}) {
  engine.ingest({
    evidence: {
      id: evidenceId,
      projectId: 'project-a',
      harness: 'codex',
      sessionId: evidenceId,
      sourceKind: 'session',
      sourceRef: `session:${evidenceId}`,
      capturedAt: createdAt,
      branch,
      commitSha: null,
      path: null,
      blobOid: null,
      content: `Use ${value}.`,
      authorityClass: 'user_direct',
      metadata: {},
    },
    claim: {
      id: claimId,
      kind: 'decision',
      subject: 'database',
      predicate: 'uses',
      value,
      branchScope: branch,
      createdAt,
    },
  });
}

test('hybrid retriever indexes one canonical claim with exact embedder identity', async (t) => {
  const { HybridMemoryRetriever } = await import('../../memory-engine/hybrid-retrieval.mjs');
  const engine = await createEngine('index-one');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  ingestRawHybridClaim(engine, {
    evidenceId: 'e-index-postgres',
    claimId: 'c-index-postgres',
    value: 'Postgres for concurrent writers',
  });

  const embedder = createFakeEmbedder();
  const hybrid = new HybridMemoryRetriever({ memory: engine, embedder });
  const result = await hybrid.indexClaim('c-index-postgres');

  assert.deepEqual(result, { indexed: true });
  assert.deepEqual(embedder.calls.passages, [[
    engine.embeddingDocument({ claimId: 'c-index-postgres' }).text,
  ]]);

  const stored = engine.getClaimEmbedding({
    claimId: 'c-index-postgres',
    modelId: 'fake-e5',
    modelRevision: 'rev-1',
  });
  assert.equal(stored.text_hash, engine.embeddingDocument({
    claimId: 'c-index-postgres',
  }).text_hash);
  assert.equal(stored.dimensions, 3);
  assert.deepEqual([...stored.vector], [1, 0, 0]);
});

test('hybrid retriever leaves canonical memory intact when semantic indexing is unavailable', async (t) => {
  const { HybridMemoryRetriever } = await import('../../memory-engine/hybrid-retrieval.mjs');
  const engine = await createEngine('index-fallback');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  ingestRawHybridClaim(engine, {
    evidenceId: 'e-index-sqlite',
    claimId: 'c-index-sqlite',
    value: 'SQLite',
  });

  const withoutEmbedder = new HybridMemoryRetriever({ memory: engine });
  assert.deepEqual(
    await withoutEmbedder.indexClaim('c-index-sqlite'),
    { indexed: false, reason: 'no_embedder' },
  );

  const before = engine.getClaim('c-index-sqlite');
  const failing = new HybridMemoryRetriever({
    memory: engine,
    embedder: createFakeEmbedder({ failPassages: true }),
  });
  await assert.rejects(
    () => failing.indexClaim('c-index-sqlite'),
    /forced passage embedding failure/,
  );
  assert.deepEqual(engine.getClaim('c-index-sqlite'), before);
  assert.equal(
    engine.getClaimEmbedding({
      claimId: 'c-index-sqlite',
      modelId: 'fake-e5',
      modelRevision: 'rev-1',
    }),
    null,
  );
});

test('semantic rebuild replaces only the current model revision for one branch', async (t) => {
  const { HybridMemoryRetriever } = await import('../../memory-engine/hybrid-retrieval.mjs');
  const engine = await createEngine('rebuild');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  ingestRawHybridClaim(engine, {
    evidenceId: 'e-rebuild-postgres',
    claimId: 'c-rebuild-postgres',
    value: 'Postgres',
  });
  ingestRawHybridClaim(engine, {
    evidenceId: 'e-rebuild-feature',
    claimId: 'c-rebuild-feature',
    value: 'DuckDB',
    branch: 'feature/search',
    createdAt: '2026-01-02T09:10:00Z',
  });

  const mainDoc = engine.embeddingDocument({ claimId: 'c-rebuild-postgres' });
  engine.putClaimEmbedding({
    claimId: 'c-rebuild-postgres',
    modelId: 'fake-e5',
    modelRevision: 'rev-1',
    textHash: mainDoc.text_hash,
    dimensions: 3,
    vector: new Float32Array([0, 0, 1]),
  });
  engine.putClaimEmbedding({
    claimId: 'c-rebuild-postgres',
    modelId: 'fake-e5',
    modelRevision: 'rev-old',
    textHash: mainDoc.text_hash,
    dimensions: 3,
    vector: new Float32Array([0, 0, 1]),
  });

  const embedder = createFakeEmbedder();
  const hybrid = new HybridMemoryRetriever({ memory: engine, embedder });
  assert.deepEqual(
    await hybrid.rebuildSemanticIndex({
      projectId: 'project-a',
      branch: 'main',
    }),
    { indexed: 1, failed: 0 },
  );

  assert.deepEqual(
    [...engine.getClaimEmbedding({
      claimId: 'c-rebuild-postgres',
      modelId: 'fake-e5',
      modelRevision: 'rev-1',
    }).vector],
    [1, 0, 0],
  );
  assert.notEqual(
    engine.getClaimEmbedding({
      claimId: 'c-rebuild-postgres',
      modelId: 'fake-e5',
      modelRevision: 'rev-old',
    }),
    null,
  );
  assert.equal(
    engine.getClaimEmbedding({
      claimId: 'c-rebuild-feature',
      modelId: 'fake-e5',
      modelRevision: 'rev-1',
    }),
    null,
  );
});


test('hybrid recall recovers a lexical-light Postgres paraphrase through semantic ranking', async (t) => {
  const { HybridMemoryRetriever } = await import('../../memory-engine/hybrid-retrieval.mjs');
  const engine = await createEngine('semantic-recall');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  ingestRawHybridClaim(engine, {
    evidenceId: 'e-semantic-postgres',
    claimId: 'c-semantic-postgres',
    value: 'Postgres for concurrent writers',
    createdAt: '2026-01-02T09:00:00Z',
  });
  ingestRawHybridClaim(engine, {
    evidenceId: 'e-semantic-sqlite',
    claimId: 'c-semantic-sqlite',
    value: 'SQLite for embedded tests',
    createdAt: '2026-01-02T09:05:00Z',
  });

  const hybrid = new HybridMemoryRetriever({
    memory: engine,
    embedder: createFakeEmbedder(),
  });
  await hybrid.rebuildSemanticIndex({ projectId: 'project-a', branch: 'main' });

  const lexical = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'Which storage engine did we choose to handle multiple processes writing at once?',
    mode: 'current',
    limit: 10,
  });
  assert.equal(
    lexical.items.some((item) => item.claim.id === 'c-semantic-postgres'),
    false,
  );

  const result = await hybrid.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'Which storage engine did we choose to handle multiple processes writing at once?',
    mode: 'current',
  });

  assert.equal(result.items[0].claim.id, 'c-semantic-postgres');
});

test('hybrid recall preserves lexical exact matches that semantic ranking omits', async (t) => {
  const { HybridMemoryRetriever } = await import('../../memory-engine/hybrid-retrieval.mjs');
  const engine = await createEngine('lexical-preserved');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  ingestRawHybridClaim(engine, {
    evidenceId: 'e-lexical-token',
    claimId: 'c-lexical-token',
    value: 'ZXQ-991 exact deployment marker',
    createdAt: '2026-01-02T09:00:00Z',
  });
  ingestRawHybridClaim(engine, {
    evidenceId: 'e-semantic-other',
    claimId: 'c-semantic-other',
    value: 'Postgres for concurrent writers',
    createdAt: '2026-01-02T09:05:00Z',
  });

  const embedder = createFakeEmbedder();
  const hybrid = new HybridMemoryRetriever({ memory: engine, embedder });
  await hybrid.indexClaim('c-semantic-other');

  const result = await hybrid.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'ZXQ-991',
    mode: 'current',
  });

  assert.ok(result.items.some((item) => item.claim.id === 'c-lexical-token'));
});

test('hybrid recall cannot surface semantically similar claims outside correctness scope', async (t) => {
  const { HybridMemoryRetriever } = await import('../../memory-engine/hybrid-retrieval.mjs');
  const engine = await createEngine('semantic-scope');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  engine.registerProject({ projectId: 'project-b', repoIdentity: 'project-b' });

  ingestRawHybridClaim(engine, {
    evidenceId: 'e-scope-current',
    claimId: 'c-scope-current',
    value: 'Postgres for concurrent writers',
    createdAt: '2026-01-02T09:00:00Z',
  });
  ingestSemanticClaim(engine, {
    evidenceId: 'e-scope-old',
    claimId: 'c-scope-old',
    value: 'Postgres old duplicate',
    createdAt: '2026-01-02T08:00:00Z',
  });
  engine.ingest({
    evidence: {
      id: 'e-scope-new',
      projectId: 'project-a',
      harness: 'codex',
      sessionId: 'e-scope-new',
      sourceKind: 'session',
      sourceRef: 'session:e-scope-new',
      capturedAt: '2026-01-02T09:10:00Z',
      branch: 'main',
      commitSha: null,
      path: null,
      blobOid: null,
      content: 'Use Redis now.',
      authorityClass: 'user_direct',
      metadata: {},
    },
    claim: {
      id: 'c-scope-new',
      kind: 'decision',
      subject: 'storage',
      predicate: 'uses',
      value: 'Redis',
      branchScope: 'main',
      createdAt: '2026-01-02T09:10:00Z',
    },
    lifecycle: { supersedes: ['c-scope-old'] },
  });
  ingestSemanticClaim(engine, {
    projectId: 'project-b',
    evidenceId: 'e-scope-other-project',
    claimId: 'c-scope-other-project',
    value: 'Postgres for concurrent writers',
    createdAt: '2026-01-02T09:15:00Z',
  });
  ingestSemanticClaim(engine, {
    evidenceId: 'e-scope-feature',
    claimId: 'c-scope-feature',
    value: 'Postgres for concurrent writers',
    branch: 'feature/search',
    createdAt: '2026-01-02T09:20:00Z',
  });

  const hybrid = new HybridMemoryRetriever({
    memory: engine,
    embedder: createFakeEmbedder(),
  });
  await hybrid.indexClaim('c-scope-current');

  const result = await hybrid.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'Which storage engine did we choose to handle multiple processes writing at once?',
    mode: 'current',
  });

  const ids = result.items.map((item) => item.claim.id);
  assert.ok(ids.includes('c-scope-current'));
  assert.equal(ids.includes('c-scope-old'), false);
  assert.equal(ids.includes('c-scope-other-project'), false);
  assert.equal(ids.includes('c-scope-feature'), false);
});

test('hybrid recall materializes fused ids in deterministic RRF order', async (t) => {
  const { HybridMemoryRetriever } = await import('../../memory-engine/hybrid-retrieval.mjs');
  const engine = await createEngine('fused-order');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  ingestRawHybridClaim(engine, {
    evidenceId: 'e-fused-a',
    claimId: 'c-fused-a',
    value: 'Postgres alpha',
    createdAt: '2026-01-02T09:00:00Z',
  });
  ingestRawHybridClaim(engine, {
    evidenceId: 'e-fused-b',
    claimId: 'c-fused-b',
    value: 'Postgres beta ZXQ-991',
    createdAt: '2026-01-02T09:10:00Z',
  });

  const hybrid = new HybridMemoryRetriever({
    memory: engine,
    embedder: createFakeEmbedder(),
    lexicalCandidateLimit: 32,
    semanticCandidateLimit: 32,
  });
  await hybrid.rebuildSemanticIndex({ projectId: 'project-a', branch: 'main' });

  const result = await hybrid.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'ZXQ-991 multiple processes writing at once',
    mode: 'current',
  });

  assert.equal(result.items[0].claim.id, 'c-fused-b');
  assert.ok(result.items.some((item) => item.claim.id === 'c-fused-a'));
});


test('hybrid recall falls back to bounded lexical recall when no embedder is configured', async (t) => {
  const { HybridMemoryRetriever } = await import('../../memory-engine/hybrid-retrieval.mjs');
  const engine = await createEngine('fallback-no-embedder');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  ingestRawHybridClaim(engine, {
    evidenceId: 'e-fallback-no-embedder',
    claimId: 'c-fallback-no-embedder',
    value: 'ZXQ-991 lexical marker',
  });

  const hybrid = new HybridMemoryRetriever({ memory: engine });
  const result = await hybrid.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'ZXQ-991',
    maxItems: 10,
    maxSerializedBytes: 16_384,
  });

  assert.deepEqual(
    result.items.map((item) => item.claim.id),
    ['c-fallback-no-embedder'],
  );
  assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 16_384);
});

test('hybrid recall falls back to lexical recall when query embedding fails', async (t) => {
  const { HybridMemoryRetriever } = await import('../../memory-engine/hybrid-retrieval.mjs');
  const engine = await createEngine('fallback-query-failure');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  ingestRawHybridClaim(engine, {
    evidenceId: 'e-fallback-query',
    claimId: 'c-fallback-query',
    value: 'ZXQ-991 lexical marker',
  });

  const hybrid = new HybridMemoryRetriever({
    memory: engine,
    embedder: createFakeEmbedder({ failQuery: true }),
  });
  const result = await hybrid.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'ZXQ-991',
  });

  assert.deepEqual(result.items.map((item) => item.claim.id), ['c-fallback-query']);
});

test('hybrid recall remains lexical when no compatible semantic rows exist', async (t) => {
  const { HybridMemoryRetriever } = await import('../../memory-engine/hybrid-retrieval.mjs');
  const engine = await createEngine('fallback-no-vectors');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  ingestRawHybridClaim(engine, {
    evidenceId: 'e-fallback-no-vectors',
    claimId: 'c-fallback-no-vectors',
    value: 'ZXQ-991 lexical marker',
  });

  const hybrid = new HybridMemoryRetriever({
    memory: engine,
    embedder: createFakeEmbedder(),
  });
  const result = await hybrid.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'ZXQ-991',
  });

  assert.deepEqual(
    result.items.map((item) => item.claim.id),
    ['c-fallback-no-vectors'],
  );
});

test('hybrid recall preserves lexical claims missing from a partial semantic index', async (t) => {
  const { HybridMemoryRetriever } = await import('../../memory-engine/hybrid-retrieval.mjs');
  const engine = await createEngine('fallback-partial-index');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  ingestRawHybridClaim(engine, {
    evidenceId: 'e-partial-lexical',
    claimId: 'c-partial-lexical',
    value: 'ZXQ-991 lexical marker',
    createdAt: '2026-01-02T09:00:00Z',
  });
  ingestRawHybridClaim(engine, {
    evidenceId: 'e-partial-semantic',
    claimId: 'c-partial-semantic',
    value: 'Postgres for concurrent writers',
    createdAt: '2026-01-02T09:10:00Z',
  });

  const hybrid = new HybridMemoryRetriever({
    memory: engine,
    embedder: createFakeEmbedder(),
  });
  await hybrid.indexClaim('c-partial-semantic');

  const result = await hybrid.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'ZXQ-991 multiple processes writing at once',
  });

  assert.ok(result.items.some((item) => item.claim.id === 'c-partial-lexical'));
  assert.ok(result.items.some((item) => item.claim.id === 'c-partial-semantic'));
});


test('semantic candidates ignore vectors whose text hash does not match canonical passage', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-hybrid-hash-mismatch-'));
  const dbPath = join(root, 'memory.sqlite3');
  const engine = new MemoryEngine({ dbPath });
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  ingestSemanticClaim(engine, {
    evidenceId: 'e-hash-mismatch',
    claimId: 'c-hash-mismatch',
    value: 'Postgres',
    createdAt: '2026-01-02T09:00:00Z',
  });

  const tamper = new DatabaseSync(dbPath);
  t.after(() => tamper.close());
  tamper.prepare(`
    UPDATE claim_embeddings
    SET text_hash = ?
    WHERE claim_id = ? AND model_id = ? AND model_revision = ?
  `).run('0'.repeat(64), 'c-hash-mismatch', 'fake-e5', 'rev-1');

  const candidates = engine.semanticCandidates({
    projectId: 'project-a',
    branch: 'main',
    mode: 'current',
    modelId: 'fake-e5',
    modelRevision: 'rev-1',
  });

  assert.deepEqual(candidates, []);
});

test('semantic rebuild is all-or-nothing when any passage embedding fails', async (t) => {
  const { HybridMemoryRetriever } = await import('../../memory-engine/hybrid-retrieval.mjs');
  const engine = await createEngine('atomic-rebuild');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  ingestRawHybridClaim(engine, {
    evidenceId: 'e-atomic-a',
    claimId: 'c-atomic-a',
    value: 'First Postgres choice',
    createdAt: '2026-01-02T09:00:00Z',
  });
  ingestRawHybridClaim(engine, {
    evidenceId: 'e-atomic-b',
    claimId: 'c-atomic-b',
    value: 'Second SQLite choice',
    createdAt: '2026-01-02T09:10:00Z',
  });

  for (const claimId of ['c-atomic-a', 'c-atomic-b']) {
    const document = engine.embeddingDocument({ claimId });
    engine.putClaimEmbedding({
      claimId,
      modelId: 'fake-e5',
      modelRevision: 'rev-1',
      textHash: document.text_hash,
      dimensions: 3,
      vector: new Float32Array([0, 0, 1]),
    });
  }

  const failingEmbedder = {
    modelId: 'fake-e5',
    modelRevision: 'rev-1',
    dimensions: 3,
    async embedQuery() {
      return new Float32Array([1, 0, 0]);
    },
    async embedPassages(texts) {
      if (texts.some((text) => /Second SQLite choice/.test(text))) {
        throw new Error('forced second passage failure');
      }
      return texts.map(() => new Float32Array([1, 0, 0]));
    },
  };

  const hybrid = new HybridMemoryRetriever({
    memory: engine,
    embedder: failingEmbedder,
  });

  assert.deepEqual(
    await hybrid.rebuildSemanticIndex({
      projectId: 'project-a',
      branch: 'main',
    }),
    { indexed: 0, failed: 2 },
  );

  for (const claimId of ['c-atomic-a', 'c-atomic-b']) {
    assert.deepEqual(
      [...engine.getClaimEmbedding({
        claimId,
        modelId: 'fake-e5',
        modelRevision: 'rev-1',
      }).vector],
      [0, 0, 1],
      'failed rebuild must leave the previous complete semantic index intact',
    );
  }
});

test('hybrid retriever validates embedder identity and fixed dimensions at construction', async (t) => {
  const { HybridMemoryRetriever } = await import('../../memory-engine/hybrid-retrieval.mjs');
  const engine = await createEngine('embedder-contract');
  t.after(() => engine.close());

  const base = {
    modelId: 'fake-e5',
    modelRevision: 'rev-1',
    dimensions: 3,
    async embedQuery() {
      return new Float32Array([1, 0, 0]);
    },
    async embedPassages() {
      return [new Float32Array([1, 0, 0])];
    },
  };

  assert.throws(
    () => new HybridMemoryRetriever({
      memory: engine,
      embedder: { ...base, modelId: '' },
    }),
    /modelId/i,
  );
  assert.throws(
    () => new HybridMemoryRetriever({
      memory: engine,
      embedder: { ...base, modelRevision: '' },
    }),
    /modelRevision/i,
  );
  assert.throws(
    () => new HybridMemoryRetriever({
      memory: engine,
      embedder: { ...base, dimensions: 0 },
    }),
    /dimensions/i,
  );
});

test('malformed query vectors fail closed to lexical recall', async (t) => {
  const { HybridMemoryRetriever } = await import('../../memory-engine/hybrid-retrieval.mjs');
  const engine = await createEngine('query-vector-validation');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  ingestRawHybridClaim(engine, {
    evidenceId: 'e-query-lexical',
    claimId: 'c-query-lexical',
    value: 'ZXQ-991 lexical marker',
    createdAt: '2026-01-02T09:00:00Z',
  });
  ingestRawHybridClaim(engine, {
    evidenceId: 'e-query-semantic',
    claimId: 'c-query-semantic',
    value: 'Postgres for concurrent writers',
    createdAt: '2026-01-02T09:10:00Z',
  });

  const semanticDocument = engine.embeddingDocument({ claimId: 'c-query-semantic' });
  engine.putClaimEmbedding({
    claimId: 'c-query-semantic',
    modelId: 'fake-e5',
    modelRevision: 'rev-1',
    textHash: semanticDocument.text_hash,
    dimensions: 3,
    vector: new Float32Array([1, 0, 0]),
  });

  const hybrid = new HybridMemoryRetriever({
    memory: engine,
    embedder: {
      modelId: 'fake-e5',
      modelRevision: 'rev-1',
      dimensions: 3,
      async embedQuery() {
        return new Float32Array([Number.NaN, 0, 0]);
      },
      async embedPassages(texts) {
        return texts.map(() => new Float32Array([1, 0, 0]));
      },
    },
  });

  const result = await hybrid.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'ZXQ-991',
  });

  assert.deepEqual(
    result.items.map((item) => item.claim.id),
    ['c-query-lexical'],
  );
});


test('reciprocal rank fusion tie breakers use locale-independent code-point order', async () => {
  const { reciprocalRankFuse } = await import('../../memory-engine/hybrid-retrieval.mjs');

  const createdAtById = new Map([
    ['B', '2026-01-01T00:00:00Z'],
    ['a', '2026-01-01T00:00:00Z'],
  ]);

  assert.deepEqual(
    reciprocalRankFuse({
      lexicalIds: ['B'],
      semanticIds: ['a'],
      createdAtById,
    }),
    ['B', 'a'],
    'binary code-point order must win an exact RRF/time tie regardless of ICU locale',
  );
});


test('detailed recall exposes retrieved versus budget-retained candidates in one pass', async (t) => {
  const { HybridMemoryRetriever } = await import(
    '../../memory-engine/hybrid-retrieval.mjs'
  );
  const engine = await createEngine('detailed-telemetry');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  ingestRawHybridClaim(engine, {
    evidenceId: 'e-detail-a',
    claimId: 'c-detail-a',
    value: 'ZXQ-991 alpha memory',
    createdAt: '2026-01-02T09:00:00Z',
  });
  ingestRawHybridClaim(engine, {
    evidenceId: 'e-detail-b',
    claimId: 'c-detail-b',
    value: 'ZXQ-991 beta memory',
    createdAt: '2026-01-02T09:10:00Z',
  });

  const hybrid = new HybridMemoryRetriever({ memory: engine });
  const detailed = await hybrid.recallDetailed({
    projectId: 'project-a',
    branch: 'main',
    query: 'ZXQ-991',
    maxItems: 1,
    maxSerializedBytes: 16_384,
  });

  assert.equal(detailed.result.items.length, 1);
  assert.equal(detailed.telemetry.retrieval_mode, 'lexical');
  assert.equal(detailed.telemetry.fallback_reason, 'embedder_unavailable');
  assert.equal(detailed.telemetry.candidates.length, 2);
  assert.equal(
    detailed.telemetry.candidates.filter(
      (candidate) => candidate.budget_retained,
    ).length,
    1,
  );
  assert.equal(
    detailed.telemetry.candidates.filter(
      (candidate) => !candidate.budget_retained,
    ).length,
    1,
  );
});
