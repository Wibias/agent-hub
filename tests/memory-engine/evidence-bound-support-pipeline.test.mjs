import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import * as supportPipeline from '../../memory-engine/evidence-bound-support-pipeline.mjs';
import { EvidenceBoundProposalStore } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  EVIDENCE_EXTRACTION_POLICY_VERSION,
  evidenceExtractionFingerprint,
} from '../../memory-engine/evidence-bound-extraction.mjs';
import { EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION } from '../../memory-engine/evidence-bound-proposal-judge.mjs';

function safeSensitivity() { return { containsSecret: false }; }

async function seedDb() {
  const root = await mkdtemp(join(tmpdir(), 'evidence-support-pipeline-'));
  const dbPath = join(root, 'memory.sqlite3');
  const db = new DatabaseSync(dbPath, { timeout: 5_000, enableForeignKeyConstraints: true });
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
      source_kind TEXT,
      content_redacted TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare('INSERT INTO project_registry (project_id) VALUES (?)').run('project-a');
  db.prepare(`INSERT INTO evidence (
    id, project_id, branch, sensitivity, authority_class, source_kind, content_redacted
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('e-user', 'project-a', 'main', 'normal', 'user_direct', 'session', 'We use Postgres because several processes write at once.');
  db.close();

  const store = new EvidenceBoundProposalStore({ dbPath, inspectTextSensitivity: safeSensitivity });
  const canonicalFact = 'Use Postgres for concurrent writers.';
  store.record({
    id: 'proposal-1', projectId: 'project-a', branch: 'main', kind: 'procedure',
    canonicalFact, evidenceIds: ['e-user'],
    fingerprint: evidenceExtractionFingerprint({ kind: 'procedure', canonicalFact }),
    policyVersion: EVIDENCE_EXTRACTION_POLICY_VERSION, evaluatorId: 'extractor:test',
    createdAt: '2026-10-11T12:00:00.000Z',
  });
  store.evaluateImportance({
    proposalId: 'proposal-1', evaluatorId: 'importance:test',
    policyVersion: EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION,
    judgment: {
      decision: 'promote', durability: 'long', future_utility: 'high', confidence: 'high',
      meaning_preserved: true, reason: 'Durable.', risk_flags: [],
    }, evaluatedAt: '2026-10-11T12:01:00.000Z',
  });
  store.close();
  return dbPath;
}

const supported = {
  decision: 'supported', confidence: 'high', meaning_preserved: true,
  reason: 'Directly entailed.', risk_flags: [],
};

test('support pipeline judges only support-ready proposals using exact cited evidence', async () => {
  assert.equal(typeof supportPipeline.runEvidenceBoundSupportPipeline, 'function');
  const dbPath = await seedDb();
  let calls = 0;
  const result = await supportPipeline.runEvidenceBoundSupportPipeline({
    dbPath, projectId: 'project-a', branch: 'main', evaluatorId: 'support:test',
    inspectTextSensitivity: safeSensitivity,
    clock: () => '2026-10-11T12:02:00.000Z',
    async judge({ proposal, evidence, prompt }) {
      calls += 1;
      assert.equal(proposal.id, 'proposal-1');
      assert.deepEqual(evidence.map((item) => item.id), ['e-user']);
      assert.match(prompt, /several processes write at once/);
      return supported;
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.evaluated, 1);
  assert.equal(result.failed, 0);

  const store = new EvidenceBoundProposalStore({ dbPath, readOnly: true, inspectTextSensitivity: safeSensitivity });
  try {
    assert.deepEqual(store.get('proposal-1')?.support, supported);
    assert.equal(store.get('proposal-1')?.status, 'pending');
  } finally { store.close(); }
});

test('support pipeline isolates invalid model output and leaves proposal support unevaluated', async () => {
  const dbPath = await seedDb();
  const result = await supportPipeline.runEvidenceBoundSupportPipeline({
    dbPath, projectId: 'project-a', branch: 'main', evaluatorId: 'support:test',
    inspectTextSensitivity: safeSensitivity,
    judge: async () => '{broken',
  });
  assert.equal(result.evaluated, 0);
  assert.equal(result.failed, 1);
  assert.match(result.results[0].error, /must be JSON/i);

  const store = new EvidenceBoundProposalStore({ dbPath, readOnly: true, inspectTextSensitivity: safeSensitivity });
  try { assert.equal(store.get('proposal-1')?.support, null); }
  finally { store.close(); }
});

test('support pipeline performs no judge calls after a proposal has support audit', async () => {
  const dbPath = await seedDb();
  let calls = 0;
  const args = {
    dbPath, projectId: 'project-a', branch: 'main', evaluatorId: 'support:test',
    inspectTextSensitivity: safeSensitivity,
    judge: async () => { calls += 1; return supported; },
  };
  await supportPipeline.runEvidenceBoundSupportPipeline(args);
  const second = await supportPipeline.runEvidenceBoundSupportPipeline(args);
  assert.equal(calls, 1);
  assert.equal(second.total, 0);
});
