import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { runRecallCase } from '../memory-ratchet/adapter-contract.mjs';
import { createReferenceMemoryAdapter } from '../memory-ratchet/reference-adapter.mjs';
import { prepareCase } from '../memory-ratchet/runner.mjs';

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

test('repositoryPaths keeps paths that are only referenced by historical claims', async (t) => {
  const engine = await createEngine();
  t.after(() => engine.close());
  ingestRepositoryClaim(engine);

  engine.ingest({
    evidence: {
      id: 'e-session',
      projectId: 'project-a',
      harness: 'codex',
      sessionId: 'session-2',
      sourceKind: 'session',
      sourceRef: 'session:2',
      capturedAt: '2026-01-04T10:00:00Z',
      branch: 'main',
      content: 'Authentication changed after the repository observation.',
      authorityClass: 'unclassified',
      metadata: {},
    },
    claim: {
      id: 'c-session',
      kind: 'session_observation',
      subject: 'authentication',
      predicate: 'changed',
      value: 'session-based authentication',
      branchScope: 'main',
      createdAt: '2026-01-04T10:00:00Z',
    },
    lifecycle: {
      supersedes: ['c-auth'],
    },
  });

  assert.equal(engine.getClaim('c-auth').state, 'superseded');
  assert.deepEqual(
    engine.repositoryPaths({ projectId: 'project-a', branch: 'main' }),
    ['src/auth.ts'],
  );
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
  assert.match(stale.freshness.observed_blob_oid, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
  assert.match(stale.freshness.current_blob_oid, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
  assert.notEqual(stale.freshness.observed_blob_oid, stale.freshness.current_blob_oid);
});


test('reference adapter treats repository-root files as repository evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-root-path-'));
  const prepared = await prepareCase('M05', root);
  const adapter = createReferenceMemoryAdapter();

  await adapter.reset();
  try {
    await adapter.setup(prepared);

    const observed = prepared.events[0];
    await adapter.ingest({
      ...observed,
      id: 'EV-A-ROOT-README',
      type: 'document_read',
      content: 'README identifies Memory Ratchet Project A.',
      source: 'README.md',
    });

    const recall = await adapter.recall({
      project_id: prepared.current.project_id,
      branch: prepared.current.branch,
      revision_sha: prepared.current.revision_sha,
      repo_path: prepared.current.repo_path,
      query: 'README Memory Ratchet Project A',
      limit: 10,
    });

    const item = recall.items.find(
      (candidate) => candidate.evidence.source_ref === 'README.md',
    );
    assert.ok(item, JSON.stringify(recall, null, 2));
    assert.equal(item.evidence.source_kind, 'repository');
    assert.equal(item.evidence.path, 'README.md');
    assert.match(item.evidence.blob_oid, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
    assert.equal(item.freshness.status, 'fresh');
  } finally {
    await adapter.teardown();
  }
});


test('reference adapter never stores a Git tree object as a file blob', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-tree-path-'));
  const prepared = await prepareCase('M05', root);
  const adapter = createReferenceMemoryAdapter();

  await adapter.reset();
  try {
    await adapter.setup(prepared);

    const observed = prepared.events[0];
    const result = await adapter.ingest({
      ...observed,
      id: 'EV-A-ROOT-DIRECTORY',
      type: 'document_read',
      content: 'Source names the repository directory, not a file.',
      source: 'src',
    });

    assert.equal(result.evidence.source_kind, 'event');
    assert.equal(result.evidence.path, null);
    assert.equal(result.evidence.blob_oid, null);
  } finally {
    await adapter.teardown();
  }
});
