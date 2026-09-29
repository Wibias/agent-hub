import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';

async function createEngine(name) {
  const root = await mkdtemp(join(tmpdir(), `memory-engine-export-${name}-`));
  return new MemoryEngine({
    dbPath: join(root, 'memory.sqlite3'),
    clock: () => '2026-01-02T12:00:00Z',
  });
}

function ingestDecision(engine, {
  evidenceId,
  claimId,
  content,
  createdAt,
  lifecycle = {},
}) {
  return engine.ingest({
    evidence: {
      id: evidenceId,
      projectId: 'project-a',
      harness: 'codex',
      sessionId: evidenceId,
      sourceKind: 'session',
      sourceRef: `session:${evidenceId}`,
      capturedAt: createdAt,
      branch: 'main',
      commitSha: null,
      path: null,
      blobOid: null,
      content,
      authorityClass: 'user_direct',
      metadata: { event_id: evidenceId },
    },
    claim: {
      id: claimId,
      kind: 'decision',
      subject: 'database',
      predicate: 'uses',
      value: content,
      branchScope: 'main',
      createdAt,
    },
    lifecycle,
  });
}

test('canonical export excludes derived state and round-trips lifecycle plus provenance', async (t) => {
  const source = await createEngine('source');
  const target = await createEngine('target');
  t.after(() => source.close());
  t.after(() => target.close());

  source.registerProject({
    projectId: 'project-a',
    repoIdentity: 'project-a',
    createdAt: '2026-01-01T00:00:00Z',
  });

  ingestDecision(source, {
    evidenceId: 'e-sqlite',
    claimId: 'c-sqlite',
    content: 'Use SQLite first.',
    createdAt: '2026-01-02T09:00:00Z',
  });
  ingestDecision(source, {
    evidenceId: 'e-postgres',
    claimId: 'c-postgres',
    content: 'Use Postgres for concurrent writers.',
    createdAt: '2026-01-02T09:10:00Z',
    lifecycle: { supersedes: ['c-sqlite'] },
  });

  source.recordApproval({
    id: 'approval-deploy',
    projectId: 'project-a',
    action: 'deploy',
    target: 'build-42',
    environment: 'staging',
    issuedAt: '2026-01-02T09:10:00Z',
    expiresAt: '2026-01-02T23:59:59Z',
    maxUses: 1,
    sourceEvidenceId: 'e-postgres',
  });

  source.recordRepositoryPathState({
    projectId: 'project-a',
    branch: 'main',
    path: 'docs/runtime.md',
    commitSha: '1'.repeat(40),
    blobOid: 'a'.repeat(40),
  });

  const exported = source.exportCanonical();

  assert.equal(exported.format, 'agent-hub-memory-canonical');
  assert.equal(exported.version, 1);
  assert.equal(Object.hasOwn(exported, 'claim_fts'), false);
  assert.equal(Object.hasOwn(exported, 'repository_path_state'), false);
  assert.equal(exported.claims.find((row) => row.id === 'c-sqlite').state, 'superseded');
  assert.equal(
    exported.claims.find((row) => row.id === 'c-sqlite').superseded_by_claim_id,
    'c-postgres',
  );
  assert.equal(exported.approvals.length, 1);

  target.registerProject({
    projectId: 'project-a',
    repoIdentity: 'project-a',
    createdAt: '2099-01-01T00:00:00Z',
  });

  const rebuilt = target.importCanonical(exported);
  assert.deepEqual(rebuilt, {
    indexed_claims: 2,
    repository_path_snapshots: 0,
  });

  assert.deepEqual(target.exportCanonical(), exported);

  const current = target.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'SQLite Postgres concurrent writers',
    mode: 'current',
  });
  assert.deepEqual(current.items.map((item) => item.claim.id), ['c-postgres']);
  assert.equal(current.items[0].evidence.id, 'e-postgres');
  assert.equal(current.items[0].evidence.source_ref, 'session:e-postgres');

  const historical = target.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'SQLite Postgres concurrent writers',
    mode: 'historical',
  });
  assert.equal(historical.items.length, 2);
  assert.equal(
    historical.items.find((item) => item.claim.id === 'c-sqlite').claim.state,
    'superseded',
  );
  assert.equal(
    historical.items.find((item) => item.claim.id === 'c-sqlite').claim.superseded_by_claim_id,
    'c-postgres',
  );
});

test('canonical import refuses to merge into an occupied memory store', async (t) => {
  const source = await createEngine('occupied-source');
  const target = await createEngine('occupied-target');
  t.after(() => source.close());
  t.after(() => target.close());

  for (const engine of [source, target]) {
    engine.registerProject({
      projectId: 'project-a',
      repoIdentity: 'project-a',
      createdAt: '2026-01-01T00:00:00Z',
    });
  }

  ingestDecision(source, {
    evidenceId: 'e-source',
    claimId: 'c-source',
    content: 'Source memory.',
    createdAt: '2026-01-02T09:00:00Z',
  });
  ingestDecision(target, {
    evidenceId: 'e-target',
    claimId: 'c-target',
    content: 'Existing target memory.',
    createdAt: '2026-01-02T09:00:00Z',
  });

  assert.throws(
    () => target.importCanonical(source.exportCanonical()),
    /requires an empty memory store/,
  );
});
