import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MemoryEngine } from '../../memory-engine/index.mjs';
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
