import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import * as pipelineModule from '../../memory-engine/evidence-bound-pipeline.mjs';

function safeSensitivity(value) {
  return { containsSecret: /SECRET|sk-[A-Za-z0-9_-]{8,}/u.test(String(value)) };
}

async function seedDb() {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-evidence-pipeline-'));
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
      source_kind TEXT,
      sensitivity TEXT NOT NULL,
      authority_class TEXT NOT NULL,
      content_redacted TEXT NOT NULL
    ) STRICT;
    CREATE TABLE claims (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      branch_scope TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare(
    'INSERT INTO project_registry (project_id, repo_identity) VALUES (?, ?)',
  ).run('project-a', 'project-a');
  const insert = db.prepare(`
    INSERT INTO evidence (
      id, project_id, branch, source_kind, sensitivity,
      authority_class, content_redacted
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    'e-user', 'project-a', 'main', 'session', 'normal', 'user_direct',
    'We use Postgres for concurrent writers.',
  );
  insert.run(
    'e-tool', 'project-a', 'main', 'tool', 'normal', 'tool_observation',
    'Concurrent write verification succeeded with Postgres.',
  );
  db.close();
  return dbPath;
}

function evidenceRows() {
  return [
    {
      id: 'e-user',
      project_id: 'project-a',
      branch: 'main',
      source_kind: 'session',
      sensitivity: 'normal',
      authority_class: 'user_direct',
      content_redacted: 'We use Postgres for concurrent writers.',
    },
    {
      id: 'e-tool',
      project_id: 'project-a',
      branch: 'main',
      source_kind: 'tool',
      sensitivity: 'normal',
      authority_class: 'tool_observation',
      content_redacted: 'Concurrent write verification succeeded with Postgres.',
    },
  ];
}

test('runEvidenceBoundExtractionPipeline extracts and persists proposals without claims', async () => {
  assert.equal(
    typeof pipelineModule.runEvidenceBoundExtractionPipeline,
    'function',
    'pipeline runner must be exported',
  );
  const dbPath = await seedDb();
  let judgeCalls = 0;
  const result = await pipelineModule.runEvidenceBoundExtractionPipeline({
    dbPath,
    projectId: 'project-a',
    branch: 'main',
    evidence: evidenceRows(),
    evaluatorId: 'memory-extractor:test',
    inspectTextSensitivity: safeSensitivity,
    clock: () => '2026-10-11T12:05:00.000Z',
    async judge() {
      judgeCalls += 1;
      return {
        memories: [{
          kind: 'knowledge',
          canonical_fact: 'Postgres supports the verified concurrent-write workflow.',
          evidence_ids: ['e-user', 'e-tool'],
        }],
      };
    },
  });

  assert.equal(judgeCalls, 1);
  assert.equal(result.proposals.length, 1);
  assert.deepEqual(result.proposals[0].evidence_ids, ['e-tool', 'e-user']);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM claims').get().count, 0);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM memory_evidence_proposals').get().count,
      1,
    );
  } finally {
    db.close();
  }
});

test('pipeline is idempotent for the same fact and merges later supporting evidence', async () => {
  const dbPath = await seedDb();
  const canonical = 'Postgres supports the verified concurrent-write workflow.';
  const judge = async ({ evidence }) => ({
    memories: [{
      kind: 'knowledge',
      canonical_fact: canonical,
      evidence_ids: evidence.some((item) => item.id === 'e-tool')
        ? ['e-user', 'e-tool']
        : ['e-user'],
    }],
  });

  await pipelineModule.runEvidenceBoundExtractionPipeline({
    dbPath,
    projectId: 'project-a',
    branch: 'main',
    evidence: [evidenceRows()[0]],
    evaluatorId: 'memory-extractor:test',
    inspectTextSensitivity: safeSensitivity,
    judge,
  });
  const second = await pipelineModule.runEvidenceBoundExtractionPipeline({
    dbPath,
    projectId: 'project-a',
    branch: 'main',
    evidence: evidenceRows(),
    evaluatorId: 'memory-extractor:test',
    inspectTextSensitivity: safeSensitivity,
    judge,
  });

  assert.equal(second.proposals.length, 1);
  assert.deepEqual(second.proposals[0].evidence_ids, ['e-tool', 'e-user']);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM memory_evidence_proposals').get().count,
      1,
    );
  } finally {
    db.close();
  }
});

test('pipeline skips model and persistence when no eligible evidence is supplied', async () => {
  const dbPath = await seedDb();
  let judgeCalls = 0;
  const result = await pipelineModule.runEvidenceBoundExtractionPipeline({
    dbPath,
    projectId: 'project-a',
    branch: 'main',
    evidence: [{
      id: 'e-agent',
      project_id: 'project-a',
      branch: 'main',
      source_kind: 'agent',
      sensitivity: 'normal',
      authority_class: 'agent_inference',
      content_redacted: 'Assistant-only conclusion.',
    }],
    evaluatorId: 'memory-extractor:test',
    inspectTextSensitivity: safeSensitivity,
    async judge() {
      judgeCalls += 1;
      return { memories: [] };
    },
  });

  assert.equal(judgeCalls, 0);
  assert.deepEqual(result.proposals, []);
});
