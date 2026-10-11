import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import * as proposalStoreModule from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  EVIDENCE_EXTRACTION_POLICY_VERSION,
  evidenceExtractionFingerprint,
} from '../../memory-engine/evidence-bound-extraction.mjs';

function safeSensitivity(value) {
  return { containsSecret: /SECRET|sk-[A-Za-z0-9_-]{8,}/u.test(String(value)) };
}

async function seedCanonicalDb() {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-evidence-store-runtime-'));
  const dbPath = join(root, 'memory.sqlite3');
  const db = new DatabaseSync(dbPath, {
    timeout: 5_000,
    enableForeignKeyConstraints: true,
  });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE project_registry (
      project_id TEXT PRIMARY KEY,
      repo_identity TEXT
    ) STRICT;
    CREATE TABLE evidence (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      branch TEXT,
      sensitivity TEXT NOT NULL,
      authority_class TEXT NOT NULL,
      content_redacted TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare(
    'INSERT INTO project_registry (project_id, repo_identity) VALUES (?, ?)',
  ).run('project-a', 'project-a');
  db.prepare(`
    INSERT INTO evidence (
      id, project_id, branch, sensitivity, authority_class, content_redacted
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'e-user',
    'project-a',
    'main',
    'normal',
    'user_direct',
    'Use Postgres for concurrent writers.',
  );
  db.close();
  return dbPath;
}

test('EvidenceBoundProposalStore opens the shared memory database and owns only proposal tables', async () => {
  assert.equal(
    typeof proposalStoreModule.EvidenceBoundProposalStore,
    'function',
    'runtime proposal store must be exported',
  );

  const dbPath = await seedCanonicalDb();
  const store = new proposalStoreModule.EvidenceBoundProposalStore({
    dbPath,
    inspectTextSensitivity: safeSensitivity,
    clock: () => '2026-10-11T12:01:00.000Z',
  });
  try {
    const canonicalFact = 'Use Postgres for concurrent writers.';
    const fingerprint = evidenceExtractionFingerprint({
      kind: 'procedure',
      canonicalFact,
    });
    const proposal = store.record({
      id: 'proposal-1',
      projectId: 'project-a',
      branch: 'main',
      kind: 'procedure',
      canonicalFact,
      evidenceIds: ['e-user'],
      fingerprint,
      policyVersion: EVIDENCE_EXTRACTION_POLICY_VERSION,
      evaluatorId: 'memory-extractor:test',
    });

    assert.equal(proposal.id, 'proposal-1');
    assert.equal(store.get('proposal-1')?.fingerprint, fingerprint);
  } finally {
    store.close();
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.ok(db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='memory_evidence_proposals'",
    ).get());
    assert.ok(db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='evidence'",
    ).get());
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM evidence').get().count,
      1,
      'proposal store must not rewrite canonical evidence',
    );
  } finally {
    db.close();
  }
});

test('EvidenceBoundProposalStore can reopen read-only without attempting schema mutation', async () => {
  const dbPath = await seedCanonicalDb();
  const writable = new proposalStoreModule.EvidenceBoundProposalStore({
    dbPath,
    inspectTextSensitivity: safeSensitivity,
  });
  const canonicalFact = 'Use Postgres for concurrent writers.';
  const fingerprint = evidenceExtractionFingerprint({
    kind: 'procedure',
    canonicalFact,
  });
  writable.record({
    id: 'proposal-1',
    projectId: 'project-a',
    branch: 'main',
    kind: 'procedure',
    canonicalFact,
    evidenceIds: ['e-user'],
    fingerprint,
    policyVersion: EVIDENCE_EXTRACTION_POLICY_VERSION,
    evaluatorId: 'memory-extractor:test',
    createdAt: '2026-10-11T12:01:00.000Z',
  });
  writable.close();

  const readonly = new proposalStoreModule.EvidenceBoundProposalStore({
    dbPath,
    readOnly: true,
    inspectTextSensitivity: safeSensitivity,
  });
  try {
    assert.equal(readonly.get('proposal-1')?.canonical_fact, canonicalFact);
    assert.throws(
      () => readonly.record({
        id: 'proposal-2',
        projectId: 'project-a',
        branch: 'main',
        kind: 'procedure',
        canonicalFact: 'Another fact.',
        evidenceIds: ['e-user'],
        fingerprint: evidenceExtractionFingerprint({
          kind: 'procedure',
          canonicalFact: 'Another fact.',
        }),
        policyVersion: EVIDENCE_EXTRACTION_POLICY_VERSION,
        evaluatorId: 'memory-extractor:test',
      }),
      /read-only/i,
    );
  } finally {
    readonly.close();
  }
});
