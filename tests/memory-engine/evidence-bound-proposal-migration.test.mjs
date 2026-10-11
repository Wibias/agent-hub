import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  EvidenceBoundProposalStore,
  ensureEvidenceProposalSchema,
} from '../../memory-engine/evidence-bound-proposal-store.mjs';

async function createLegacyV2Db() {
  const root = await mkdtemp(join(tmpdir(), 'evidence-proposal-migration-'));
  const db = new DatabaseSync(join(root, 'memory.sqlite3'), {
    timeout: 5_000,
    enableForeignKeyConstraints: true,
  });
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE project_registry (project_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE evidence (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      branch TEXT,
      sensitivity TEXT NOT NULL,
      authority_class TEXT NOT NULL,
      content_redacted TEXT NOT NULL
    ) STRICT;
    CREATE TABLE memory_evidence_proposals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      branch TEXT NOT NULL,
      kind TEXT NOT NULL,
      canonical_fact TEXT NOT NULL,
      status TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      evaluator_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      importance_policy_version TEXT,
      importance_evaluator_id TEXT,
      importance_evaluated_at TEXT,
      importance_json TEXT,
      UNIQUE (project_id, branch, fingerprint)
    ) STRICT;
    CREATE TABLE memory_evidence_proposal_evidence (
      proposal_id TEXT NOT NULL REFERENCES memory_evidence_proposals(id) ON DELETE CASCADE,
      evidence_id TEXT NOT NULL REFERENCES evidence(id),
      linked_at TEXT NOT NULL,
      PRIMARY KEY (proposal_id, evidence_id)
    ) STRICT;
  `);
  return db;
}

test('ensureEvidenceProposalSchema upgrades legacy v2 proposal tables additively', async (t) => {
  const db = await createLegacyV2Db();
  t.after(() => db.close());

  ensureEvidenceProposalSchema(db);

  const columns = new Set(
    db.prepare('PRAGMA table_info(memory_evidence_proposals)').all()
      .map((row) => row.name),
  );
  for (const name of [
    'support_policy_version',
    'support_evaluator_id',
    'support_evaluated_at',
    'support_json',
  ]) {
    assert.equal(columns.has(name), true, name);
  }

  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      .map((row) => row.name),
  );
  assert.equal(tables.has('memory_evidence_proposal_relations'), true);
  assert.equal(tables.has('memory_evidence_proposal_promotions'), true);
});

test('read-only proposal store can inspect legacy v2 rows before write migration creates relation tables', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-proposal-legacy-readonly-'));
  const dbPath = join(root, 'memory.sqlite3');
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec(`
    CREATE TABLE project_registry (project_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE evidence (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      branch TEXT,
      sensitivity TEXT NOT NULL,
      authority_class TEXT NOT NULL,
      source_kind TEXT,
      content_redacted TEXT NOT NULL
    ) STRICT;
    CREATE TABLE memory_evidence_proposals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      branch TEXT NOT NULL,
      kind TEXT NOT NULL,
      canonical_fact TEXT NOT NULL,
      status TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      evaluator_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      importance_policy_version TEXT,
      importance_evaluator_id TEXT,
      importance_evaluated_at TEXT,
      importance_json TEXT,
      UNIQUE (project_id, branch, fingerprint)
    ) STRICT;
    CREATE TABLE memory_evidence_proposal_evidence (
      proposal_id TEXT NOT NULL REFERENCES memory_evidence_proposals(id),
      evidence_id TEXT NOT NULL REFERENCES evidence(id),
      linked_at TEXT NOT NULL,
      PRIMARY KEY (proposal_id, evidence_id)
    ) STRICT;
  `);
  db.prepare('INSERT INTO project_registry VALUES (?)').run('project-a');
  db.prepare('INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('e-1', 'project-a', 'main', 'normal', 'user_direct', 'session', 'Use Postgres.');
  db.prepare(`INSERT INTO memory_evidence_proposals (
    id, project_id, branch, kind, canonical_fact, status,
    policy_version, evaluator_id, fingerprint, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('p-1', 'project-a', 'main', 'procedure', 'Use Postgres.', 'pending', 'v2', 'test', 'a'.repeat(64), '2026-10-11T10:00:00.000Z');
  db.prepare('INSERT INTO memory_evidence_proposal_evidence VALUES (?, ?, ?)')
    .run('p-1', 'e-1', '2026-10-11T10:00:00.000Z');
  db.close();

  const store = new EvidenceBoundProposalStore({
    dbPath,
    readOnly: true,
    inspectTextSensitivity: () => ({ containsSecret: false }),
  });
  try {
    const rows = store.list({ projectId: 'project-a', branch: 'main', status: 'pending' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].canonical_fact, 'Use Postgres.');
    assert.equal(rows[0].support, null);
    assert.equal(rows[0].relation, null);
    assert.equal(rows[0].promotion, null);
  } finally {
    store.close();
  }
});
