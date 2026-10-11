import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import * as relationPipeline from '../../memory-engine/evidence-bound-relation-pipeline.mjs';
import { EvidenceBoundProposalStore } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  EVIDENCE_EXTRACTION_POLICY_VERSION,
  evidenceExtractionFingerprint,
} from '../../memory-engine/evidence-bound-extraction.mjs';
import { EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION } from '../../memory-engine/evidence-bound-proposal-judge.mjs';
import { EVIDENCE_SUPPORT_POLICY_VERSION } from '../../memory-engine/evidence-bound-support-judge.mjs';
import { evidenceRelationClaimRef } from '../../memory-engine/evidence-bound-relation-judge.mjs';

function safeSensitivity() { return { containsSecret: false }; }

async function seedDb({ withClaim = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'evidence-relation-pipeline-'));
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
      content_redacted TEXT NOT NULL
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
      created_from_evidence_id TEXT NOT NULL REFERENCES evidence(id)
    ) STRICT;
  `);
  db.prepare('INSERT INTO project_registry (project_id) VALUES (?)').run('project-a');
  const ev = db.prepare(`INSERT INTO evidence (
    id, project_id, branch, sensitivity, authority_class, content_redacted
  ) VALUES (?, ?, ?, ?, ?, ?)`);
  ev.run('e-user', 'project-a', 'main', 'normal', 'user_direct', 'Use Postgres for concurrent writers.');
  ev.run('e-existing', 'project-a', 'main', 'normal', 'user_direct', 'Use SQLite for local storage.');
  if (withClaim) {
    db.prepare(`INSERT INTO claims (
      id, project_id, kind, subject, predicate, value_text, state, branch_scope, created_from_evidence_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('c-existing', 'project-a', 'user_direct', 'user memory', 'states', 'Use SQLite for local storage.', 'active', 'main', 'e-existing');
  }
  db.close();

  const store = new EvidenceBoundProposalStore({ dbPath, inspectTextSensitivity: safeSensitivity });
  const canonicalFact = 'Use Postgres for concurrent writers.';
  store.record({
    id: 'proposal-1', projectId: 'project-a', branch: 'main', kind: 'procedure', canonicalFact,
    evidenceIds: ['e-user'], fingerprint: evidenceExtractionFingerprint({ kind: 'procedure', canonicalFact }),
    policyVersion: EVIDENCE_EXTRACTION_POLICY_VERSION, evaluatorId: 'extractor:test',
    createdAt: '2026-10-11T12:00:00.000Z',
  });
  store.evaluateImportance({
    proposalId: 'proposal-1', evaluatorId: 'importance:test', policyVersion: EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION,
    judgment: { decision: 'promote', durability: 'long', future_utility: 'high', confidence: 'high', meaning_preserved: true, reason: 'Durable.', risk_flags: [] },
    evaluatedAt: '2026-10-11T12:01:00.000Z',
  });
  store.evaluateSupport({
    proposalId: 'proposal-1', evaluatorId: 'support:test', policyVersion: EVIDENCE_SUPPORT_POLICY_VERSION,
    judgment: { decision: 'supported', confidence: 'high', meaning_preserved: true, reason: 'Supported.', risk_flags: [] },
    evaluatedAt: '2026-10-11T12:02:00.000Z',
  });
  store.close();
  return dbPath;
}

test('relation pipeline uses deterministic unrelated without model call when no active comparison claim exists', async () => {
  assert.equal(typeof relationPipeline.runEvidenceBoundRelationPipeline, 'function');
  const dbPath = await seedDb({ withClaim: false });
  let calls = 0;
  const result = await relationPipeline.runEvidenceBoundRelationPipeline({
    dbPath, projectId: 'project-a', branch: 'main', evaluatorId: 'relation:test',
    inspectTextSensitivity: safeSensitivity,
    judge: async () => { calls += 1; throw new Error('must not call'); },
    clock: () => '2026-10-11T12:03:00.000Z',
  });
  assert.equal(calls, 0);
  assert.equal(result.evaluated, 1);
  assert.equal(result.results[0].relation, 'unrelated');

  const store = new EvidenceBoundProposalStore({ dbPath, readOnly: true, inspectTextSensitivity: safeSensitivity });
  try { assert.equal(store.get('proposal-1')?.relation?.relation, 'unrelated'); }
  finally { store.close(); }
});

test('relation pipeline resolves supplied target ref and persists audit', async () => {
  const dbPath = await seedDb();
  const targetRef = evidenceRelationClaimRef('c-existing');
  let calls = 0;
  const result = await relationPipeline.runEvidenceBoundRelationPipeline({
    dbPath, projectId: 'project-a', branch: 'main', evaluatorId: 'relation:test',
    inspectTextSensitivity: safeSensitivity,
    async judge({ memories, prompt }) {
      calls += 1;
      assert.deepEqual(memories.map((item) => item.claim_id), ['c-existing']);
      assert.match(prompt, /Use SQLite for local storage/);
      return {
        relation: 'update', target_ref: targetRef, confidence: 'high',
        meaning_preserved: true, reason: 'Replacement.',
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.evaluated, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.results[0].target_ref, targetRef);

  const store = new EvidenceBoundProposalStore({ dbPath, readOnly: true, inspectTextSensitivity: safeSensitivity });
  try { assert.equal(store.get('proposal-1')?.related_claim_id, 'c-existing'); }
  finally { store.close(); }
});

test('relation pipeline rejects unknown target refs without storing relation', async () => {
  const dbPath = await seedDb();
  const result = await relationPipeline.runEvidenceBoundRelationPipeline({
    dbPath, projectId: 'project-a', branch: 'main', evaluatorId: 'relation:test',
    inspectTextSensitivity: safeSensitivity,
    judge: async () => ({
      relation: 'same', target_ref: '@0123456789', confidence: 'high',
      meaning_preserved: true, reason: 'Same.',
    }),
  });
  assert.equal(result.evaluated, 0);
  assert.equal(result.failed, 1);
  assert.match(result.results[0].error, /does not resolve/i);

  const store = new EvidenceBoundProposalStore({ dbPath, readOnly: true, inspectTextSensitivity: safeSensitivity });
  try { assert.equal(store.get('proposal-1')?.relation, null); }
  finally { store.close(); }
});
