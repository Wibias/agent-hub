import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ensureTypedRelationSchema,
  saveTypedRelation,
  listTypedRelations,
} from '../../memory-engine/claim-relations-ledger.mjs';

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'agent-hub-d1b-'));
  const db = new DatabaseSync(join(root, 'memory.sqlite3'), { enableForeignKeyConstraints: true });
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE project_registry (project_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE evidence (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      branch TEXT, authority_class TEXT NOT NULL
    ) STRICT;
    CREATE TABLE claims (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      branch_scope TEXT NOT NULL, state TEXT NOT NULL, kind TEXT NOT NULL,
      created_from_evidence_id TEXT NOT NULL REFERENCES evidence(id),
      valid_from TEXT, valid_until TEXT
    ) STRICT;
    INSERT INTO project_registry VALUES ('project'), ('other');
    INSERT INTO evidence VALUES
      ('e-a','project','main','agent_inference'),
      ('e-b','project','main','agent_inference'),
      ('e-branch','project','dev','agent_inference'),
      ('e-project','other','main','agent_inference'),
      ('e-old','project','main','agent_inference');
    INSERT INTO claims VALUES
      ('a','project','main','active','agent_inference','e-a',NULL,NULL),
      ('b','project','main','active','agent_inference','e-b',NULL,NULL),
      ('different-branch','project','dev','active','agent_inference','e-branch',NULL,NULL),
      ('different-project','other','main','active','agent_inference','e-project',NULL,NULL),
      ('inactive','project','main','superseded','agent_inference','e-old',NULL,NULL);
  `);
  try { return fn(db); } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
}

const base = Object.freeze({
  projectId: 'project', branch: 'main', sourceClaimId: 'a', targetClaimId: 'b',
  relation: 'implements', confidence: 'high', reason: 'Both claim texts describe the same implementation.',
});
const audit = Object.freeze({
  evaluatorId: 'codex:fixture:semantic-relation-v1',
  policyVersion: 'semantic-relation-v1',
  at: '2026-11-04T10:00:00.000Z',
});

test('D1b migrates blank DB idempotently without touching canonical claims', () => fixture(db => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM claims').get().n;
  ensureTypedRelationSchema(db);
  ensureTypedRelationSchema(db);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claims').get().n, before);
  assert.equal(listTypedRelations(db, { projectId: 'project', branch: 'main' }).length, 0);
}));

test('D1b saves an advisory inferred edge with provenance and stable id', () => fixture(db => {
  ensureTypedRelationSchema(db);
  const one = saveTypedRelation(db, base, audit);
  assert.match(one.id, /^[0-9a-f]{64}$/);
  assert.equal(one.origin, 'inferred');
  assert.equal(one.source_evidence_id, 'e-a');
  assert.equal(one.target_evidence_id, 'e-b');
  assert.equal(one.policy_version, audit.policyVersion);
  assert.equal(one.evaluator_id, audit.evaluatorId);
  assert.equal(one.advisory, true);
  assert.equal(one.directed, true);
  assert.equal(listTypedRelations(db, { projectId: 'project', branch: 'main' }).length, 1);
  const again = saveTypedRelation(db, base, audit);
  assert.deepEqual(again, one);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claim_relations').get().n, 1);
}));

test('D1b refuses invalid, out-of-scope and lifecycle relation writes atomically', () => fixture(db => {
  ensureTypedRelationSchema(db);
  const before = db.prepare('SELECT COUNT(*) AS n FROM claim_relations').get().n;
  for (const p of [
    { ...base, targetClaimId: 'different-branch' },
    { ...base, targetClaimId: 'different-project' },
    { ...base, targetClaimId: 'inactive' },
    { ...base, targetClaimId: 'missing' },
    { ...base, targetClaimId: 'a' },
    { ...base, relation: 'supersedes' },
    { ...base, confidence: 'medium' },
    { ...base, origin: 'explicit' },
  ]) assert.throws(() => saveTypedRelation(db, p, audit));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claim_relations').get().n, before);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
}));

test('D1b rejects bad authority and missing evidence', () => fixture(db => {
  ensureTypedRelationSchema(db);
  db.prepare("UPDATE evidence SET authority_class = 'user_direct' WHERE id = 'e-b'").run();
  assert.throws(() => saveTypedRelation(db, base, audit), /authority/i);
  db.prepare("UPDATE evidence SET authority_class = 'agent_inference' WHERE id = 'e-b'").run();
  db.prepare("UPDATE evidence SET branch = NULL WHERE id = 'e-b'").run();
  assert.throws(() => saveTypedRelation(db, base, audit), /evidence/i);
}));

test('D1b masks edges after claim lifecycle change, preserving historical inspection', () => fixture(db => {
  ensureTypedRelationSchema(db);
  saveTypedRelation(db, base, audit);
  db.prepare("UPDATE claims SET state = 'superseded' WHERE id = 'b'").run();
  assert.equal(listTypedRelations(db, { projectId: 'project', branch: 'main' }).length, 0);
  assert.equal(listTypedRelations(db, { projectId: 'project', branch: 'main', activeOnly: false }).length, 1);
}));

test('D1b masks temporally expired edges and rejects not-yet-current proposals', () => fixture(db => {
  ensureTypedRelationSchema(db);
  db.prepare("UPDATE claims SET valid_from = '2026-11-05T00:00:00Z' WHERE id = 'b'").run();
  assert.throws(() => saveTypedRelation(db, base, audit), /temporal|current|valid/i);
  db.prepare("UPDATE claims SET valid_from = '2026-11-01T00:00:00Z', valid_until='2026-11-06T00:00:00Z' WHERE id = 'b'").run();
  saveTypedRelation(db, base, audit);
  assert.equal(listTypedRelations(db, { projectId: 'project', branch: 'main', at: '2026-11-04T10:00:00Z' }).length, 1);
  assert.equal(listTypedRelations(db, { projectId: 'project', branch: 'main', at: '2026-11-07T10:00:00Z' }).length, 0);
}));

test('D1b normalizes undirected related_to and preserves direction for depends_on', () => fixture(db => {
  ensureTypedRelationSchema(db);
  const a = saveTypedRelation(db, { ...base, relation: 'related_to' }, audit);
  const b = saveTypedRelation(db, { ...base, relation: 'related_to', sourceClaimId: 'b', targetClaimId: 'a' }, audit);
  assert.equal(a.id, b.id);
  assert.equal(a.directed, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claim_relations').get().n, 1);
  const c = saveTypedRelation(db, { ...base, relation: 'depends_on' }, audit);
  assert.equal(c.directed, true);
  assert.notEqual(c.id, a.id);
}));

test('D1b cascade removes derived relations if canonical endpoints are removed', () => fixture(db => {
  ensureTypedRelationSchema(db);
  saveTypedRelation(db, base, audit);
  db.prepare("DELETE FROM claims WHERE id = 'b'").run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claim_relations').get().n, 0);
}));

test('D1b old read-only DB without projection table returns empty relations', () => fixture(db => {
  assert.deepEqual(listTypedRelations(db, { projectId: 'project', branch: 'main' }), []);
}));


test('D1b temporal filtering honors timezone offsets, not lexical timestamps', () => fixture(db => {
  ensureTypedRelationSchema(db);
  db.prepare("UPDATE claims SET valid_until = '2026-11-04T09:00:00+02:00' WHERE id = 'b'").run();
  // 09:00+02:00 is 07:00Z, so at 10:00Z the claim has expired.
  assert.throws(() => saveTypedRelation(db, base, audit), /temporal/);
  db.prepare("UPDATE claims SET valid_until = '2026-11-04T14:00:00+02:00' WHERE id = 'b'").run();
  saveTypedRelation(db, base, audit);
  assert.equal(listTypedRelations(db, {projectId:'project', branch:'main', at:'2026-11-04T10:00:00Z'}).length, 1);
  assert.equal(listTypedRelations(db, {projectId:'project', branch:'main', at:'2026-11-04T12:00:01Z'}).length, 0);
}));


test('D1b hides derived edge when canonical primary Evidence changes', () => fixture(db => {
  ensureTypedRelationSchema(db);
  saveTypedRelation(db, base, audit);
  db.prepare("UPDATE claims SET created_from_evidence_id = 'e-a' WHERE id = 'b'").run();
  assert.equal(listTypedRelations(db, { projectId: 'project', branch: 'main' }).length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claim_relations').get().n, 1);
}));


test('D1b accepts category-style claim.kind while keeping Evidence as the authority source', () => fixture(db => {
  ensureTypedRelationSchema(db);
  db.prepare("UPDATE claims SET kind = 'decision' WHERE id IN ('a', 'b')").run();
  db.prepare("UPDATE evidence SET authority_class = 'user_direct' WHERE id = 'e-a'").run();
  const stored = saveTypedRelation(db, base, audit);
  assert.equal(stored.source_claim_id, 'a');
  assert.equal(stored.target_claim_id, 'b');
  assert.equal(listTypedRelations(db, { projectId: 'project', branch: 'main' }).length, 1);
}));
