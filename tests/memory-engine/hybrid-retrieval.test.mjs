import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
