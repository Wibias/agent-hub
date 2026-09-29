import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { runRecallCase } from '../memory-ratchet/adapter-contract.mjs';
import { createReferenceMemoryAdapter } from '../memory-ratchet/reference-adapter.mjs';

async function createEngine() {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-git-freshness-'));
  const engine = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  return engine;
}

function ingestRepositoryClaim(engine) {
  engine.ingest({
    evidence: {
      id: 'e-auth',
      projectId: 'project-a',
      harness: 'codex',
      sessionId: 'session-1',
      sourceKind: 'repository',
      sourceRef: 'src/auth.ts',
      capturedAt: '2026-01-03T10:00:00Z',
      branch: 'main',
      commitSha: 'a'.repeat(40),
      path: 'src/auth.ts',
      blobOid: '1'.repeat(40),
      content: 'src/auth.ts authenticates by calling verifyJwt(token).',
      authorityClass: 'unclassified',
      metadata: {},
    },
    claim: {
      id: 'c-auth',
      kind: 'code_observation',
      subject: 'authentication',
      predicate: 'implements',
      value: 'JWT authentication',
      branchScope: 'main',
      createdAt: '2026-01-03T10:00:00Z',
    },
  });
}

test('repository freshness is fail-closed and follows path blob identity, not commit identity', async (t) => {
  const engine = await createEngine();
  t.after(() => engine.close());
  ingestRepositoryClaim(engine);

  const request = {
    projectId: 'project-a',
    branch: 'main',
    query: 'authentication JWT',
    mode: 'current',
  };

  assert.deepEqual(engine.repositoryPaths({
    projectId: 'project-a',
    branch: 'main',
  }), ['src/auth.ts']);

  assert.deepEqual(engine.recall(request).items, []);

  engine.recordRepositoryPathState({
    projectId: 'project-a',
    branch: 'main',
    path: 'src/auth.ts',
    commitSha: 'b'.repeat(40),
    blobOid: '1'.repeat(40),
    checkedAt: '2026-01-04T10:00:00Z',
  });

  const unchanged = engine.recall({
    ...request,
    revisionSha: 'b'.repeat(40),
  });
  assert.deepEqual(unchanged.items.map((item) => item.claim.id), ['c-auth']);
  assert.equal(unchanged.items[0].freshness.status, 'fresh');
  assert.equal(unchanged.items[0].freshness.current_commit_sha, 'b'.repeat(40));

  const staleSnapshot = engine.recall({
    ...request,
    revisionSha: 'c'.repeat(40),
  });
  assert.deepEqual(
    staleSnapshot.items,
    [],
    'a freshness snapshot from another revision must fail closed',
  );

  engine.recordRepositoryPathState({
    projectId: 'project-a',
    branch: 'main',
    path: 'src/auth.ts',
    commitSha: 'c'.repeat(40),
    blobOid: '2'.repeat(40),
    checkedAt: '2026-01-05T10:00:00Z',
  });

  assert.deepEqual(engine.recall({
    ...request,
    revisionSha: 'c'.repeat(40),
  }).items, []);

  const staleHistory = engine.recall({
    ...request,
    mode: 'historical',
    revisionSha: 'c'.repeat(40),
  });
  assert.deepEqual(staleHistory.items.map((item) => item.claim.id), ['c-auth']);
  assert.equal(staleHistory.items[0].freshness.status, 'stale');
  assert.equal(staleHistory.items[0].freshness.observed_blob_oid, '1'.repeat(40));
  assert.equal(staleHistory.items[0].freshness.current_blob_oid, '2'.repeat(40));

  engine.recordRepositoryPathState({
    projectId: 'project-a',
    branch: 'main',
    path: 'src/auth.ts',
    commitSha: 'd'.repeat(40),
    blobOid: null,
    checkedAt: '2026-01-06T10:00:00Z',
  });

  const deletedHistory = engine.recall({
    ...request,
    mode: 'historical',
    revisionSha: 'd'.repeat(40),
  });
  assert.equal(deletedHistory.items[0].freshness.status, 'stale');
  assert.equal(deletedHistory.items[0].freshness.current_blob_oid, null);
});

test('M05 withholds the old JWT code observation after the file blob changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-m05-'));
  const result = await runRecallCase(createReferenceMemoryAdapter(), 'M05', root);

  assert.ok(
    result.raw_recall.items.every(
      (item) => !/JWT|verifyJwt/i.test(item.evidence.content_redacted),
    ),
    JSON.stringify(result.raw_recall, null, 2),
  );

  const stale = result.raw_recall.history.find(
    (item) => /verifyJwt/i.test(item.evidence.content_redacted),
  );
  assert.ok(stale, JSON.stringify(result.raw_recall, null, 2));
  assert.equal(stale.freshness.status, 'stale');
  assert.match(stale.freshness.observed_blob_oid, /^[0-9a-f]{40}$/);
  assert.match(stale.freshness.current_blob_oid, /^[0-9a-f]{40}$/);
  assert.notEqual(stale.freshness.observed_blob_oid, stale.freshness.current_blob_oid);
});
