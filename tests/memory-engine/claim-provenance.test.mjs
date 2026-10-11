import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { createMemoryProtocol } from '../../memory-engine/protocol.mjs';

async function createEngine(name) {
  const root = await mkdtemp(join(tmpdir(), `memory-claim-provenance-${name}-`));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  return {
    root,
    dbPath,
    memory,
    close() {
      memory.close();
      return rm(root, { recursive: true, force: true });
    },
  };
}

function register(memory, projectId = 'project-a') {
  return memory.registerProject({
    projectId,
    repoIdentity: projectId,
    createdAt: '2026-10-11T00:00:00.000Z',
  });
}

function record(memory, {
  id,
  projectId = 'project-a',
  branch = 'main',
  authorityClass = 'user_direct',
  content = id,
}) {
  return memory.recordEvidence({
    id,
    projectId,
    harness: 'codex',
    sessionId: 'session-a',
    sourceKind: authorityClass === 'tool_observation' ? 'tool' : 'session',
    sourceRef: `source:${id}`,
    capturedAt: '2026-10-11T00:00:00.000Z',
    branch,
    commitSha: 'abc123',
    path: null,
    blobOid: null,
    content,
    authorityClass,
    metadata: {},
  });
}

function claim({
  id = 'claim-a',
  project = 'database',
  value = 'Postgres',
  branchScope = 'main',
} = {}) {
  return {
    id,
    kind: 'knowledge',
    subject: project,
    predicate: 'uses',
    value,
    state: 'active',
    branchScope,
    createdAt: '2026-10-11T00:01:00.000Z',
  };
}

function createLegacyDatabase(dbPath) {
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE project_registry (
      project_id TEXT PRIMARY KEY,
      canonical_remote TEXT,
      repo_identity TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE evidence (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      harness TEXT,
      session_id TEXT,
      source_kind TEXT NOT NULL,
      source_ref TEXT,
      captured_at TEXT NOT NULL,
      branch TEXT,
      commit_sha TEXT,
      path TEXT,
      blob_oid TEXT,
      content_redacted TEXT NOT NULL,
      sensitivity TEXT NOT NULL,
      authority_class TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE claims (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      value_text TEXT NOT NULL,
      state TEXT NOT NULL,
      branch_scope TEXT NOT NULL,
      created_from_evidence_id TEXT NOT NULL REFERENCES evidence(id),
      created_at TEXT NOT NULL,
      valid_from TEXT,
      valid_until TEXT,
      superseded_by_claim_id TEXT REFERENCES claims(id),
      rejected_by_evidence_id TEXT REFERENCES evidence(id)
    ) STRICT;
  `);
  db.prepare(`
    INSERT INTO project_registry(project_id, repo_identity, created_at)
    VALUES ('project-a', 'project-a', '2026-10-11T00:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO evidence(
      id, project_id, source_kind, captured_at, branch,
      content_redacted, sensitivity, authority_class, metadata_json
    ) VALUES (
      'e-legacy', 'project-a', 'session', '2026-10-11T00:00:00.000Z', 'main',
      'Legacy fact', 'normal', 'user_direct', '{}'
    )
  `).run();
  db.prepare(`
    INSERT INTO claims(
      id, project_id, kind, subject, predicate, value_text, state,
      branch_scope, created_from_evidence_id, created_at
    ) VALUES (
      'c-legacy', 'project-a', 'knowledge', 'legacy', 'states', 'Legacy fact', 'active',
      'main', 'e-legacy', '2026-10-11T00:01:00.000Z'
    )
  `).run();
  db.close();
}

test('migration backfills one primary provenance row for legacy claims idempotently', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-provenance-legacy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dbPath = join(root, 'memory.sqlite3');
  createLegacyDatabase(dbPath);

  let memory = new MemoryEngine({ dbPath });
  assert.deepEqual(memory.getClaimEvidence('c-legacy').map(({ evidence, role }) => ({
    id: evidence.id,
    role,
  })), [{ id: 'e-legacy', role: 'primary' }]);
  memory.close();

  memory = new MemoryEngine({ dbPath });
  assert.equal(memory.getClaimEvidence('c-legacy').length, 1);
  memory.close();
});

test('assertClaim preserves legacy shape and stores complete multi-evidence provenance atomically', async (t) => {
  const ctx = await createEngine('assert');
  t.after(() => ctx.close());
  const { memory } = ctx;
  register(memory);
  register(memory, 'project-b');

  record(memory, { id: 'e-primary', authorityClass: 'user_direct' });
  record(memory, { id: 'e-support', authorityClass: 'repo_trusted' });
  record(memory, { id: 'e-extra', authorityClass: 'tool_observation' });
  record(memory, { id: 'e-other-branch', branch: 'feature/x' });
  record(memory, { id: 'e-other-project', projectId: 'project-b' });

  const inputClaim = claim();
  const asserted = memory.assertClaim({
    evidenceId: 'e-primary',
    evidenceIds: ['e-primary', 'e-support'],
    claim: inputClaim,
  });
  assert.equal(asserted.evidence.id, 'e-primary');
  assert.equal(asserted.claim.created_from_evidence_id, 'e-primary');
  assert.deepEqual(memory.getClaimEvidence('claim-a').map(({ evidence, role }) => ({
    id: evidence.id,
    role,
  })), [
    { id: 'e-primary', role: 'primary' },
    { id: 'e-support', role: 'supporting' },
  ]);

  const retried = memory.assertClaim({
    evidenceId: 'e-primary',
    evidenceIds: ['e-primary', 'e-support'],
    claim: inputClaim,
  });
  assert.equal(retried.claim.id, 'claim-a');
  assert.equal(memory.getClaimEvidence('claim-a').length, 2);

  assert.throws(() => memory.assertClaim({
    evidenceId: 'e-primary',
    evidenceIds: ['e-primary', 'e-support', 'e-extra'],
    claim: inputClaim,
  }), /provenance/i);

  assert.throws(() => memory.assertClaim({
    evidenceId: 'e-primary',
    evidenceIds: ['e-primary', 'e-primary'],
    claim: claim({ id: 'c-duplicate' }),
  }), /unique/i);

  assert.throws(() => memory.assertClaim({
    evidenceId: 'e-primary',
    evidenceIds: ['e-primary', 'e-other-branch'],
    claim: claim({ id: 'c-branch' }),
  }), /branch/i);
  assert.equal(memory.getClaim('c-branch'), null);

  assert.throws(() => memory.assertClaim({
    evidenceId: 'e-primary',
    evidenceIds: ['e-primary', 'e-other-project'],
    claim: claim({ id: 'c-project' }),
  }), /project/i);
  assert.equal(memory.getClaim('c-project'), null);

  const tooMany = ['e-primary'];
  for (let i = 0; i < 10; i += 1) {
    const id = `e-many-${i}`;
    record(memory, { id });
    tooMany.push(id);
  }
  assert.throws(() => memory.assertClaim({
    evidenceId: 'e-primary',
    evidenceIds: tooMany,
    claim: claim({ id: 'c-too-many' }),
  }), /between 1 and 10/i);
});

test('canonical export/import round-trips multi-evidence and reconstructs legacy primary provenance', async (t) => {
  const source = await createEngine('export-source');
  const target = await createEngine('export-target');
  const legacyTarget = await createEngine('export-legacy-target');
  t.after(async () => {
    await source.close();
    await target.close();
    await legacyTarget.close();
  });

  register(source.memory);
  record(source.memory, { id: 'e-primary' });
  record(source.memory, { id: 'e-support', authorityClass: 'repo_trusted' });
  source.memory.assertClaim({
    evidenceId: 'e-primary',
    evidenceIds: ['e-primary', 'e-support'],
    claim: claim(),
  });

  const exported = source.memory.exportCanonical();
  assert.deepEqual(exported.claim_evidence.map(({ claim_id, evidence_id, role }) => ({
    claim_id,
    evidence_id,
    role,
  })), [
    { claim_id: 'claim-a', evidence_id: 'e-primary', role: 'primary' },
    { claim_id: 'claim-a', evidence_id: 'e-support', role: 'supporting' },
  ]);

  target.memory.importCanonical(exported);
  assert.deepEqual(target.memory.exportCanonical(), exported);

  const legacy = structuredClone(exported);
  delete legacy.claim_evidence;
  legacyTarget.memory.importCanonical(legacy);
  assert.deepEqual(legacyTarget.memory.getClaimEvidence('claim-a').map(({ evidence, role }) => ({
    id: evidence.id,
    role,
  })), [{ id: 'e-primary', role: 'primary' }]);
});

test('canonical import rejects malformed provenance atomically', async (t) => {
  const source = await createEngine('invalid-source');
  const target = await createEngine('invalid-target');
  t.after(async () => {
    await source.close();
    await target.close();
  });

  register(source.memory);
  record(source.memory, { id: 'e-primary' });
  record(source.memory, { id: 'e-support', authorityClass: 'repo_trusted' });
  source.memory.assertClaim({
    evidenceId: 'e-primary',
    evidenceIds: ['e-primary', 'e-support'],
    claim: claim(),
  });

  const malformed = source.memory.exportCanonical();
  malformed.claim_evidence = malformed.claim_evidence.map((row) => (
    row.role === 'primary'
      ? { ...row, evidence_id: 'e-support' }
      : row
  ));

  assert.throws(
    () => target.memory.importCanonical(malformed),
    /primary|duplicate|provenance/i,
  );
  const after = target.memory.exportCanonical();
  assert.equal(after.evidence.length, 0);
  assert.equal(after.claims.length, 0);
  assert.equal(after.claim_evidence.length, 0);
});

test('protocol v1 accepts optional evidence_ids and authorizes against the complete evidence set', async (t) => {
  const ctx = await createEngine('protocol');
  t.after(() => ctx.close());
  const { memory } = ctx;
  register(memory);
  record(memory, { id: 'e-primary', authorityClass: 'user_direct' });
  record(memory, { id: 'e-support', authorityClass: 'repo_trusted' });

  const calls = [];
  const protocol = createMemoryProtocol({
    memory,
    authorizeClaim(context) {
      calls.push(context);
      return true;
    },
  });

  const response = await protocol.handle({
    protocol: 'memory.protocol.v1',
    operation: 'assert_claim',
    request_id: 'multi-evidence-claim',
    payload: {
      evidence_id: 'e-primary',
      evidence_ids: ['e-primary', 'e-support'],
      claim: {
        id: 'claim-protocol',
        kind: 'knowledge',
        subject: 'runtime',
        predicate: 'uses',
        value: 'Node',
        branch_scope: 'main',
        created_at: '2026-10-11T00:01:00.000Z',
      },
    },
  });

  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].evidence.id, 'e-primary');
  assert.deepEqual(calls[0].evidenceSet.map((row) => row.id), [
    'e-primary',
    'e-support',
  ]);
  assert.equal(memory.getClaimEvidence('claim-protocol').length, 2);

  const duplicate = await protocol.handle({
    protocol: 'memory.protocol.v1',
    operation: 'assert_claim',
    request_id: 'duplicate-evidence-ids',
    payload: {
      evidence_id: 'e-primary',
      evidence_ids: ['e-primary', 'e-primary'],
      claim: {
        id: 'claim-invalid',
        kind: 'knowledge',
        subject: 'runtime',
        predicate: 'uses',
        value: 'Node',
        branch_scope: 'main',
        created_at: '2026-10-11T00:01:00.000Z',
      },
    },
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'invalid_request');
});
