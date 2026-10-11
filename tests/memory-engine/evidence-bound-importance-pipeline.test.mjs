import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import * as importancePipeline from '../../memory-engine/evidence-bound-importance-pipeline.mjs';
import {
  EvidenceBoundProposalStore,
} from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  EVIDENCE_EXTRACTION_POLICY_VERSION,
  evidenceExtractionFingerprint,
} from '../../memory-engine/evidence-bound-extraction.mjs';

function safeSensitivity() {
  return { containsSecret: false };
}

async function seedDb() {
  const root = await mkdtemp(join(tmpdir(), 'evidence-importance-pipeline-'));
  const dbPath = join(root, 'memory.sqlite3');
  const db = new DatabaseSync(dbPath, {
    timeout: 5_000,
    enableForeignKeyConstraints: true,
  });
  db.exec(`
    PRAGMA journal_mode = WAL;
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
  `);
  db.prepare('INSERT INTO project_registry (project_id) VALUES (?)').run('project-a');
  db.prepare(`
    INSERT INTO evidence (
      id, project_id, branch, sensitivity, authority_class, content_redacted
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run('e-user', 'project-a', 'main', 'normal', 'user_direct', 'Use Postgres.');
  db.close();

  const store = new EvidenceBoundProposalStore({
    dbPath,
    inspectTextSensitivity: safeSensitivity,
  });
  const canonicalFact = 'Use Postgres for concurrent writers.';
  store.record({
    id: 'proposal-1',
    projectId: 'project-a',
    branch: 'main',
    kind: 'procedure',
    canonicalFact,
    evidenceIds: ['e-user'],
    fingerprint: evidenceExtractionFingerprint({
      kind: 'procedure',
      canonicalFact,
    }),
    policyVersion: EVIDENCE_EXTRACTION_POLICY_VERSION,
    evaluatorId: 'extractor:test',
    createdAt: '2026-10-11T12:00:00.000Z',
  });
  store.close();
  return dbPath;
}

const promote = {
  decision: 'promote',
  durability: 'long',
  future_utility: 'high',
  confidence: 'high',
  meaning_preserved: true,
  reason: 'Durable and likely to prevent repeated work.',
  risk_flags: [],
};

test('runEvidenceBoundImportancePipeline evaluates pending proposals without creating claims', async () => {
  assert.equal(typeof importancePipeline.runEvidenceBoundImportancePipeline, 'function');
  const dbPath = await seedDb();
  let calls = 0;
  const result = await importancePipeline.runEvidenceBoundImportancePipeline({
    dbPath,
    projectId: 'project-a',
    branch: 'main',
    evaluatorId: 'importance:test',
    inspectTextSensitivity: safeSensitivity,
    clock: () => '2026-10-11T12:02:00.000Z',
    async judge({ prompt }) {
      calls += 1;
      assert.match(prompt, /Use Postgres for concurrent writers/);
      return promote;
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.evaluated, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.results[0].decision, 'promote');

  const store = new EvidenceBoundProposalStore({
    dbPath,
    readOnly: true,
    inspectTextSensitivity: safeSensitivity,
  });
  try {
    assert.deepEqual(store.get('proposal-1')?.importance, promote);
    assert.equal(store.get('proposal-1')?.status, 'pending');
  } finally {
    store.close();
  }
});

test('importance pipeline isolates invalid model output per proposal and leaves it unevaluated', async () => {
  const dbPath = await seedDb();
  const result = await importancePipeline.runEvidenceBoundImportancePipeline({
    dbPath,
    projectId: 'project-a',
    branch: 'main',
    evaluatorId: 'importance:test',
    inspectTextSensitivity: safeSensitivity,
    async judge() {
      return '{not json';
    },
  });

  assert.equal(result.evaluated, 0);
  assert.equal(result.failed, 1);
  assert.match(result.results[0].error, /must be JSON/i);

  const store = new EvidenceBoundProposalStore({
    dbPath,
    readOnly: true,
    inspectTextSensitivity: safeSensitivity,
  });
  try {
    assert.equal(store.get('proposal-1')?.importance, null);
    assert.deepEqual(
      store.listUnevaluated({ projectId: 'project-a', branch: 'main' })
        .map((item) => item.id),
      ['proposal-1'],
    );
  } finally {
    store.close();
  }
});

test('importance pipeline performs no judge calls when no proposal is ready', async () => {
  const dbPath = await seedDb();
  let calls = 0;
  await importancePipeline.runEvidenceBoundImportancePipeline({
    dbPath,
    projectId: 'project-a',
    branch: 'main',
    evaluatorId: 'importance:test',
    inspectTextSensitivity: safeSensitivity,
    judge: async () => {
      calls += 1;
      return promote;
    },
  });
  const second = await importancePipeline.runEvidenceBoundImportancePipeline({
    dbPath,
    projectId: 'project-a',
    branch: 'main',
    evaluatorId: 'importance:test',
    inspectTextSensitivity: safeSensitivity,
    judge: async () => {
      calls += 1;
      return promote;
    },
  });
  assert.equal(calls, 1);
  assert.equal(second.total, 0);
});
