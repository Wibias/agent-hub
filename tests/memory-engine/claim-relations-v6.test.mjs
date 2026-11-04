import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { typedRelationKey } from '../../memory-engine/claim-relations.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ensureTypedRelationSchema,
  saveTypedRelation,
  listTypedRelations,
  exportTypedRelationSidecar,
  importTypedRelationSidecar,
} from '../../memory-engine/claim-relations-ledger.mjs';

const NOW = '2026-11-04T18:00:00.000Z';
const audit = { evaluatorId: 'codex:model:semantic-relation-v1', policyVersion: 'semantic-relation-v1', at: NOW };
const proposal = { projectId: 'project-a', branch: 'main', sourceClaimId: 'a', targetClaimId: 'b', relation: 'supports', confidence: 'high', reason: 'A provides evidence for B.' };

function fixture(fn, { legacy = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agent-hub-d1b-v6-'));
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
    INSERT INTO project_registry VALUES ('project-a'), ('other');
    INSERT INTO evidence VALUES
      ('e-a','project-a','main','agent_inference'),
      ('e-b','project-a','main','agent_inference'),
      ('e-next','project-a','main','agent_inference'),
      ('e-c','project-a','main','agent_inference');
    INSERT INTO claims VALUES
      ('a','project-a','main','active','decision','e-a',NULL,NULL),
      ('b','project-a','main','active','decision','e-b',NULL,NULL),
      ('c','project-a','main','active','decision','e-c',NULL,NULL);
  `);
  if (legacy) {
    db.exec(`CREATE TABLE claim_relations (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      branch_scope TEXT NOT NULL,
      source_claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      target_claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      relation TEXT NOT NULL, origin TEXT NOT NULL, confidence TEXT NOT NULL,
      reason TEXT NOT NULL,
      source_evidence_id TEXT NOT NULL REFERENCES evidence(id),
      target_evidence_id TEXT NOT NULL REFERENCES evidence(id),
      evaluator_id TEXT NOT NULL, policy_version TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT;`);
  }
  try { return fn(db); } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
}

test('v6 redacts secrets in newly inserted reason and rejects sensitive metadata', () => fixture(db => {
  ensureTypedRelationSchema(db);
  const row = saveTypedRelation(db, { ...proposal, reason: 'Access token: access_token=abcdefghijklmnopq, and Bearer abcdefghijklmnop.' }, audit);
  assert.doesNotMatch(row.reason, /abcdefghijklmnopq|Bearer abcdefghijklmnop/);
  assert.match(row.reason, /\[REDACTED_SECRET\]/);
  assert.equal(db.prepare('SELECT reason FROM claim_relations').get().reason, row.reason);
  assert.throws(() => saveTypedRelation(db, { ...proposal, relation: 'depends_on' }, { ...audit, evaluatorId: 'Bearer abcdefghijklmnop' }), /sensitive|secret/i);
}));

test('v6 revalidates changed primary evidence, reason and policy without duplicating the edge', () => fixture(db => {
  ensureTypedRelationSchema(db);
  const first = saveTypedRelation(db, proposal, audit);
  db.prepare("UPDATE claims SET created_from_evidence_id = 'e-next' WHERE id = 'b'").run();
  assert.equal(listTypedRelations(db, { projectId: 'project-a', branch: 'main' }).length, 0);
  const updated = saveTypedRelation(db, { ...proposal, reason: 'Both directly support the same behavior.' }, { ...audit, policyVersion: 'semantic-relation-v2', at: '2026-11-04T19:00:00.000Z' });
  assert.equal(updated.id, first.id);
  assert.equal(updated.created_at, first.created_at);
  assert.equal(updated.validated_at, '2026-11-04T19:00:00.000Z');
  assert.equal(updated.target_evidence_id, 'e-next');
  assert.equal(updated.policy_version, 'semantic-relation-v2');
  assert.equal(listTypedRelations(db, { projectId: 'project-a', branch: 'main' }).length, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM claim_relations').get().n, 1);
  const idempotent = saveTypedRelation(db, { ...proposal, reason: updated.reason }, { ...audit, policyVersion: 'semantic-relation-v2', at: '2026-11-04T20:00:00.000Z' });
  assert.deepEqual(idempotent, updated);
}));

test('v6 migrates v5 schema inside existing transaction, scrubs legacy reasons, backfills validated_at', () => fixture(db => {
  db.prepare(`INSERT INTO claim_relations VALUES (?, 'project-a', 'main', 'a', 'b', 'supports', 'inferred', 'high', 'password=verysecretpassword123', 'e-a', 'e-b', 'codex:v5', 'semantic-relation-v1', ?)`).run(typedRelationKey(proposal), NOW);
  db.exec('BEGIN IMMEDIATE');
  ensureTypedRelationSchema(db);
  db.exec('COMMIT');
  const row = db.prepare('SELECT * FROM claim_relations').get();
  assert.equal(row.validated_at, NOW);
  assert.match(row.reason, /\[REDACTED_SECRET\]/);
  assert.doesNotMatch(row.reason, /verysecretpassword123/);
  ensureTypedRelationSchema(db);
  assert.equal(listTypedRelations(db, { projectId: 'project-a', branch: 'main', at: NOW }).length, 1);
}, { legacy: true }));

test('v6 sidecar roundtrip on independently seeded canonical DB, no canonical writes', () => {
  let archive;
  fixture(db => {
    ensureTypedRelationSchema(db);
    saveTypedRelation(db, proposal, audit);
    archive = exportTypedRelationSidecar(db, { projectId: 'project-a', branch: 'main', at: NOW });
    assert.equal(archive.format, 'agent-hub-typed-relations-sidecar');
    assert.equal(archive.version, 2);
    assert.equal(archive.relations.length, 1);
    assert.match(archive.digest_sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(archive, exportTypedRelationSidecar(db, { projectId: 'project-a', branch: 'main', at: NOW }));
  });
  fixture(db => {
    const before = db.prepare('SELECT * FROM claims ORDER BY id').all();
    const restored = importTypedRelationSidecar(db, archive, { projectId: 'project-a', branch: 'main', at: NOW });
    assert.equal(restored.imported, 1);
    assert.deepEqual(db.prepare('SELECT * FROM claims ORDER BY id').all(), before);
    const list = listTypedRelations(db, { projectId: 'project-a', branch: 'main', at: NOW });
    assert.equal(list.length, 1);
    assert.equal(list[0].id, archive.relations[0].id);
    assert.equal(list[0].source_evidence_id, 'e-a');
    assert.equal(list[0].target_evidence_id, 'e-b');
    assert.throws(() => importTypedRelationSidecar(db, archive, { projectId: 'project-a', branch: 'main', at: NOW }), /empty|existing|populated/);
  });
});

test('v6 sidecar fails closed on tampering and stale provenance with no partial writes', () => {
  let archive;
  fixture(db => {
    ensureTypedRelationSchema(db);
    saveTypedRelation(db, proposal, audit);
    saveTypedRelation(db, { ...proposal, sourceClaimId: 'b', targetClaimId: 'c', relation: 'implements', reason: 'B implements C.' }, audit);
    archive = exportTypedRelationSidecar(db, { projectId: 'project-a', branch: 'main', at: NOW });
  });
  fixture(db => {
    const tampered = structuredClone(archive);
    tampered.relations[1].reason = 'changed without integrity update';
    assert.throws(() => importTypedRelationSidecar(db, tampered, { projectId: 'project-a', branch: 'main', at: NOW }), /integrity|digest/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'claim_relations'").get().n, 0);
    db.prepare("UPDATE claims SET created_from_evidence_id = 'e-next' WHERE id = 'c'").run();
    assert.throws(() => importTypedRelationSidecar(db, archive, { projectId: 'project-a', branch: 'main', at: NOW }), /provenance|evidence/i);
    const table = db.prepare("SELECT name FROM sqlite_master WHERE name = 'claim_relations'").get();
    if (table) assert.equal(db.prepare('SELECT count(*) AS n FROM claim_relations').get().n, 0);
  });
});

test('v6 sidecar rejects project/branch mismatch and unsupported versions', () => fixture(db => {
  ensureTypedRelationSchema(db);
  saveTypedRelation(db, proposal, audit);
  const archive = exportTypedRelationSidecar(db, { projectId: 'project-a', branch: 'main', at: NOW });
  assert.throws(() => importTypedRelationSidecar(db, archive, { projectId: 'other', branch: 'main', at: NOW }), /scope/i);
  assert.throws(() => importTypedRelationSidecar(db, { ...archive, version: 1 }, { projectId: 'project-a', branch: 'main', at: NOW }), /version/i);
}));


test('v6 sidecar digest is stable across JSON object-key permutations', () => {
  let archive;
  fixture(db => {
    ensureTypedRelationSchema(db);
    saveTypedRelation(db, proposal, audit);
    archive = exportTypedRelationSidecar(db, { projectId: 'project-a', branch: 'main', at: NOW });
  });
  const reversed = Object.fromEntries(Object.entries(archive).reverse());
  reversed.relations = archive.relations.map(row => Object.fromEntries(Object.entries(row).reverse()));
  fixture(db => {
    const result = importTypedRelationSidecar(db, reversed, { projectId: 'project-a', branch: 'main', at: NOW });
    assert.equal(result.imported, 1);
  });
});
