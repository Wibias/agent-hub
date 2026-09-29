import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';

async function createEngine(root, name) {
  return new MemoryEngine({
    dbPath: join(root, name),
    clock: () => '2026-02-01T12:00:00Z',
  });
}

function ingestDecision(engine, {
  evidenceId,
  claimId,
  content,
  createdAt,
  supersedes = [],
}) {
  return engine.ingest({
    evidence: {
      id: evidenceId,
      projectId: 'project-a',
      harness: 'codex',
      sessionId: 'S1',
      sourceKind: 'session',
      sourceRef: 'session:S1',
      capturedAt: createdAt,
      branch: 'main',
      commitSha: null,
      path: null,
      blobOid: null,
      content,
      authorityClass: 'user_direct',
      metadata: { trace: evidenceId },
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
    lifecycle: { supersedes },
  });
}

test('portable export rebuild preserves canonical state and regenerates FTS', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-export-roundtrip-'));
  const source = await createEngine(root, 'source.sqlite3');
  const rebuilt = await createEngine(root, 'rebuilt.sqlite3');
  t.after(() => {
    source.close();
    rebuilt.close();
  });

  source.registerProject({
    projectId: 'project-a',
    repoIdentity: 'project-a',
    createdAt: '2026-01-01T00:00:00Z',
  });
  ingestDecision(source, {
    evidenceId: 'e-sqlite',
    claimId: 'c-sqlite',
    content: 'Use SQLite as the project database.',
    createdAt: '2026-01-02T09:00:00Z',
  });
  ingestDecision(source, {
    evidenceId: 'e-postgres',
    claimId: 'c-postgres',
    content: 'Supersede SQLite. Use Postgres for concurrent writers.',
    createdAt: '2026-01-02T09:10:00Z',
    supersedes: ['c-sqlite'],
  });

  const portable = source.exportMemory({ projectId: 'project-a' });
  assert.equal(portable.format, 'agent-hub-memory-export');
  assert.equal(portable.version, 1);
  assert.deepEqual(Object.keys(portable.canonical).sort(), [
    'approvals',
    'claims',
    'conflicts',
    'evidence',
    'lifecycle_events',
    'projects',
  ]);
  assert.equal(JSON.stringify(portable).includes('claim_fts'), false);
  assert.equal(JSON.stringify(portable).includes('repository_path_state'), false);

  const imported = rebuilt.importMemory(portable);
  assert.deepEqual(imported, {
    projects: 1,
    evidence: 2,
    claims: 2,
    lifecycle_events: 1,
    conflicts: 0,
    approvals: 0,
  });

  assert.equal(rebuilt.getClaim('c-sqlite').state, 'superseded');
  assert.equal(rebuilt.getClaim('c-sqlite').superseded_by_claim_id, 'c-postgres');
  assert.equal(rebuilt.getClaim('c-postgres').state, 'active');
  assert.equal(rebuilt.getEvidence('e-postgres').metadata.trace, 'e-postgres');

  const current = rebuilt.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'database Postgres SQLite concurrent writers',
    mode: 'current',
  });
  assert.deepEqual(current.items.map((item) => item.claim.id), ['c-postgres']);

  const historical = rebuilt.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'database Postgres SQLite concurrent writers',
    mode: 'historical',
  });
  assert.deepEqual(
    new Set(historical.items.map((item) => item.claim.id)),
    new Set(['c-sqlite', 'c-postgres']),
  );

  const reexported = rebuilt.exportMemory({ projectId: 'project-a' });
  assert.deepEqual(reexported.canonical, portable.canonical);
});

test('failed export rolls back its read transaction', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-export-rollback-'));
  const engine = new MemoryEngine({
    dbPath: join(root, 'memory.sqlite3'),
    clock: () => {
      throw new Error('clock failed');
    },
  });
  t.after(() => engine.close());

  engine.registerProject({
    projectId: 'project-a',
    repoIdentity: 'project-a',
    createdAt: '2026-01-01T00:00:00Z',
  });
  ingestDecision(engine, {
    evidenceId: 'e-before',
    claimId: 'c-before',
    content: 'Use Postgres.',
    createdAt: '2026-01-02T09:00:00Z',
  });

  assert.throws(
    () => engine.exportMemory(),
    /clock failed/,
  );

  assert.doesNotThrow(() => ingestDecision(engine, {
    evidenceId: 'e-after',
    claimId: 'c-after',
    content: 'Keep audit logs.',
    createdAt: '2026-01-03T09:00:00Z',
  }));
  assert.equal(engine.getClaim('c-after').state, 'active');
});

test('portable rebuild does not import derived repository freshness', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-export-freshness-'));
  const source = await createEngine(root, 'source.sqlite3');
  const rebuilt = await createEngine(root, 'rebuilt.sqlite3');
  t.after(() => {
    source.close();
    rebuilt.close();
  });

  source.registerProject({
    projectId: 'project-a',
    repoIdentity: 'project-a',
    createdAt: '2026-01-01T00:00:00Z',
  });
  source.ingest({
    evidence: {
      id: 'e-adr',
      projectId: 'project-a',
      harness: 'codex',
      sessionId: 'S2',
      sourceKind: 'repository',
      sourceRef: 'docs/adr/0001-database.md',
      capturedAt: '2026-01-02T09:11:00Z',
      branch: 'main',
      commitSha: '1'.repeat(40),
      path: 'docs/adr/0001-database.md',
      blobOid: 'a'.repeat(40),
      content: 'ADR says Postgres is active.',
      authorityClass: 'repo_trusted',
      metadata: {},
    },
    claim: {
      id: 'c-adr',
      kind: 'document_read',
      subject: 'database policy',
      predicate: 'states',
      value: 'Postgres',
      branchScope: 'main',
      createdAt: '2026-01-02T09:11:00Z',
    },
  });
  source.recordRepositoryPathState({
    projectId: 'project-a',
    branch: 'main',
    path: 'docs/adr/0001-database.md',
    commitSha: '2'.repeat(40),
    blobOid: 'a'.repeat(40),
  });

  rebuilt.importMemory(source.exportMemory());

  const beforeRefresh = rebuilt.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'Postgres database policy',
    revisionSha: '2'.repeat(40),
    mode: 'current',
  });
  assert.deepEqual(beforeRefresh.items, []);

  rebuilt.recordRepositoryPathState({
    projectId: 'project-a',
    branch: 'main',
    path: 'docs/adr/0001-database.md',
    commitSha: '2'.repeat(40),
    blobOid: 'a'.repeat(40),
  });

  const afterRefresh = rebuilt.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'Postgres database policy',
    revisionSha: '2'.repeat(40),
    mode: 'current',
  });
  assert.deepEqual(afterRefresh.items.map((item) => item.claim.id), ['c-adr']);
});

test('portable export preserves consumed approval state', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-export-approval-'));
  const source = new MemoryEngine({
    dbPath: join(root, 'source.sqlite3'),
    clock: () => '2026-01-11T10:00:00Z',
  });
  const rebuilt = new MemoryEngine({
    dbPath: join(root, 'rebuilt.sqlite3'),
    clock: () => '2026-01-11T10:01:00Z',
  });
  t.after(() => {
    source.close();
    rebuilt.close();
  });

  source.registerProject({
    projectId: 'project-a',
    repoIdentity: 'project-a',
    createdAt: '2026-01-01T00:00:00Z',
  });
  source.ingest({
    evidence: {
      id: 'e-approval',
      projectId: 'project-a',
      harness: 'codex',
      sessionId: 'S3',
      sourceKind: 'session',
      sourceRef: 'session:S3',
      capturedAt: '2026-01-11T09:00:00Z',
      branch: 'main',
      commitSha: null,
      path: null,
      blobOid: null,
      content: 'Approved staging deploy.',
      authorityClass: 'user_direct',
      metadata: {},
    },
    claim: {
      id: 'c-approval',
      kind: 'approval',
      subject: 'deploy approval',
      predicate: 'states',
      value: 'staging',
      state: 'candidate',
      branchScope: 'main',
      createdAt: '2026-01-11T09:00:00Z',
      validFrom: '2026-01-11T09:00:00Z',
      validUntil: '2026-01-11T23:59:59Z',
    },
  });
  source.recordApproval({
    id: 'approval-1',
    projectId: 'project-a',
    action: 'deploy',
    target: 'build-42',
    environment: 'staging',
    issuedAt: '2026-01-11T09:00:00Z',
    expiresAt: '2026-01-11T23:59:59Z',
    maxUses: 2,
    sourceEvidenceId: 'e-approval',
  });
  source.authorizeAction({
    projectId: 'project-a',
    action: 'deploy',
    target: 'build-42',
    environment: 'staging',
  });

  rebuilt.importMemory(source.exportMemory());
  const approval = rebuilt.getApproval('approval-1');
  assert.equal(approval.uses, 1);
  assert.equal(approval.max_uses, 2);

  const secondUse = rebuilt.authorizeAction({
    projectId: 'project-a',
    action: 'deploy',
    target: 'build-42',
    environment: 'staging',
  });
  assert.equal(secondUse.authorized, true);
  assert.equal(secondUse.approval.uses, 2);

  const exhausted = rebuilt.authorizeAction({
    projectId: 'project-a',
    action: 'deploy',
    target: 'build-42',
    environment: 'staging',
  });
  assert.equal(exhausted.authorized, false);
});

test('portable import cannot detach approval actor from source provenance', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-export-approval-actor-'));
  const source = new MemoryEngine({
    dbPath: join(root, 'source.sqlite3'),
    clock: () => '2026-01-11T10:00:00Z',
  });
  const rebuilt = new MemoryEngine({
    dbPath: join(root, 'rebuilt.sqlite3'),
    clock: () => '2026-01-11T10:00:00Z',
  });
  t.after(() => {
    source.close();
    rebuilt.close();
  });

  source.registerProject({
    projectId: 'project-a',
    repoIdentity: 'project-a',
    createdAt: '2026-01-01T00:00:00Z',
  });
  source.ingest({
    evidence: {
      id: 'e-approval',
      projectId: 'project-a',
      harness: 'codex',
      sessionId: 'S4',
      sourceKind: 'session',
      sourceRef: 'session:S4',
      capturedAt: '2026-01-11T09:00:00Z',
      branch: 'main',
      commitSha: null,
      path: null,
      blobOid: null,
      content: 'Approved staging deploy.',
      authorityClass: 'user_direct',
      metadata: {},
    },
    claim: {
      id: 'c-approval',
      kind: 'approval',
      subject: 'deploy approval',
      predicate: 'states',
      value: 'staging',
      state: 'candidate',
      branchScope: 'main',
      createdAt: '2026-01-11T09:00:00Z',
    },
  });
  source.recordApproval({
    id: 'approval-1',
    projectId: 'project-a',
    action: 'deploy',
    target: 'build-42',
    environment: 'staging',
    issuedAt: '2026-01-11T09:00:00Z',
    expiresAt: '2026-01-11T23:59:59Z',
    sourceEvidenceId: 'e-approval',
  });

  const portable = structuredClone(source.exportMemory());
  portable.canonical.approvals[0].actor = 'session:forged';

  assert.throws(
    () => rebuilt.importMemory(portable),
    /invalid approval in portable export/,
  );
  assert.equal(rebuilt.getProject('project-a'), null);
});

test('portable import rejects unredacted secrets before canonical storage', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-export-secret-'));
  const source = await createEngine(root, 'source.sqlite3');
  const rebuilt = await createEngine(root, 'rebuilt.sqlite3');
  t.after(() => {
    source.close();
    rebuilt.close();
  });

  source.registerProject({
    projectId: 'project-a',
    repoIdentity: 'project-a',
    createdAt: '2026-01-01T00:00:00Z',
  });
  ingestDecision(source, {
    evidenceId: 'e-safe',
    claimId: 'c-safe',
    content: 'Use Postgres.',
    createdAt: '2026-01-02T09:00:00Z',
  });

  const portable = structuredClone(source.exportMemory());
  portable.canonical.evidence[0].content_redacted = 'api_key=abcdefghijklmnopqrstuvwxyz';

  assert.throws(
    () => rebuilt.importMemory(portable),
    /unredacted secret/,
  );
  assert.equal(rebuilt.getProject('project-a'), null);
});

test('portable import refuses to merge with existing canonical memory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-export-nonempty-'));
  const source = await createEngine(root, 'source.sqlite3');
  const rebuilt = await createEngine(root, 'rebuilt.sqlite3');
  t.after(() => {
    source.close();
    rebuilt.close();
  });

  source.registerProject({
    projectId: 'project-a',
    repoIdentity: 'project-a',
    createdAt: '2026-01-01T00:00:00Z',
  });
  ingestDecision(source, {
    evidenceId: 'e-export',
    claimId: 'c-export',
    content: 'Use Postgres.',
    createdAt: '2026-01-02T09:00:00Z',
  });

  rebuilt.registerProject({
    projectId: 'project-a',
    repoIdentity: 'project-a',
    createdAt: '2026-01-01T00:00:00Z',
  });
  ingestDecision(rebuilt, {
    evidenceId: 'e-existing',
    claimId: 'c-existing',
    content: 'Existing memory.',
    createdAt: '2026-01-03T09:00:00Z',
  });

  assert.throws(
    () => rebuilt.importMemory(source.exportMemory()),
    /non-empty canonical table/,
  );
  assert.equal(rebuilt.getClaim('c-existing').state, 'active');
});
