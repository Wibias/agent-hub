import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  ensureTypedRelationSchema, saveTypedRelation,
  exportTypedRelationSidecar, importTypedRelationSidecar,
} from '../../memory-engine/claim-relations-ledger.mjs';

const scope = { projectId: 'project', branch: 'main' };
const first = '2026-11-04T18:00:00.000Z';
const later = '2026-11-04T19:00:00.000Z';
const proposal = { ...scope, sourceClaimId: 'a', targetClaimId: 'b',
  relation: 'supports', confidence: 'high', reason: 'A specifically supports B.' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE project_registry (project_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE evidence (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      branch TEXT, authority_class TEXT NOT NULL, content_redacted TEXT NOT NULL
    ) STRICT;
    CREATE TABLE claims (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      branch_scope TEXT NOT NULL, state TEXT NOT NULL, kind TEXT NOT NULL,
      subject TEXT NOT NULL, predicate TEXT NOT NULL, value_text TEXT NOT NULL,
      created_from_evidence_id TEXT NOT NULL REFERENCES evidence(id),
      valid_from TEXT, valid_until TEXT
    ) STRICT;
    INSERT INTO project_registry VALUES ('project');
    INSERT INTO evidence VALUES
      ('e-a', 'project', 'main', 'agent_inference', 'A source text'),
      ('e-b', 'project', 'main', 'agent_inference', 'B source text');
    INSERT INTO claims VALUES
      ('a', 'project', 'main', 'active', 'decision', 'dispatch', 'uses', 'A text', 'e-a', NULL, NULL),
      ('b', 'project', 'main', 'active', 'decision', 'dispatch', 'uses', 'B text', 'e-b', NULL, NULL);
  `);
  ensureTypedRelationSchema(db);
  return db;
}

function archive() {
  const db = fixture();
  try {
    saveTypedRelation(db, proposal, {
      evaluatorId: 'codex:semantic-relation-v1', policyVersion: 'semantic-relation-v1', at: first,
    });
    return exportTypedRelationSidecar(db, { ...scope, at: first });
  } finally { db.close(); }
}

test('D1b sidecar v2 binds claim content, not only claim/evidence IDs', () => {
  const snap = archive();
  assert.equal(snap.version, 2);
  const db = fixture();
  try {
    db.prepare("UPDATE claims SET value_text = 'CHANGED statement' WHERE id = 'a'").run();
    assert.throws(() => importTypedRelationSidecar(db, snap, { ...scope, at: later }), /content changed/i);
    assert.equal(db.prepare('SELECT count(*) AS n FROM claim_relations').get().n, 0);
  } finally { db.close(); }
});

test('D1b sidecar v2 binds primary evidence content and authority', () => {
  const snap = archive();
  for (const update of [
    "UPDATE evidence SET content_redacted = 'DIFFERENT observation' WHERE id = 'e-b'",
    "UPDATE evidence SET authority_class = 'tool_observation' WHERE id = 'e-b'",
  ]) {
    const db = fixture();
    try {
      db.exec(update);
      assert.throws(() => importTypedRelationSidecar(db, snap, { ...scope, at: later }), /content changed/i);
      assert.equal(db.prepare('SELECT count(*) AS n FROM claim_relations').get().n, 0);
    } finally { db.close(); }
  }
});

test('D1b sidecar v2 restores exact audit timestamps and stable digest after rebuild', () => {
  const snap = archive();
  const db = fixture();
  try {
    const restored = importTypedRelationSidecar(db, snap, { ...scope, at: later });
    assert.equal(restored.imported, 1);
    const again = exportTypedRelationSidecar(db, { ...scope, at: later });
    assert.deepEqual(again, snap);
    assert.equal(again.relations[0].validated_at, first);
  } finally { db.close(); }
});

test('D1b sidecar v2 refuses future audited validation time without writing rows', () => {
  const snap = archive();
  const db = fixture();
  try {
    assert.throws(() => importTypedRelationSidecar(db, snap, { ...scope, at: '2026-11-04T17:00:00Z' }), /future|audit|validation|created/i);
    assert.equal(db.prepare('SELECT count(*) AS n FROM claim_relations').get().n, 0);
  } finally { db.close(); }
});
