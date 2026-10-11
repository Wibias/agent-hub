import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import * as storeModule from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  EVIDENCE_EXTRACTION_POLICY_VERSION,
  evidenceExtractionFingerprint,
} from '../../memory-engine/evidence-bound-extraction.mjs';
import {
  EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION,
} from '../../memory-engine/evidence-bound-proposal-judge.mjs';

function safeSensitivity() {
  return { containsSecret: false };
}

async function createDb() {
  const root = await mkdtemp(join(tmpdir(), 'evidence-proposal-eval-'));
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
  `);
  db.prepare('INSERT INTO project_registry (project_id) VALUES (?)').run('project-a');
  db.prepare(`
    INSERT INTO evidence (
      id, project_id, branch, sensitivity, authority_class, content_redacted
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'e-user', 'project-a', 'main', 'normal', 'user_direct',
    'Use Postgres for concurrent writers.',
  );
  storeModule.ensureEvidenceProposalSchema(db);
  return db;
}

function record(db, id = 'proposal-1') {
  const canonicalFact = 'Use Postgres for concurrent writers.';
  return storeModule.recordEvidenceBoundProposal(db, {
    id,
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
    inspectTextSensitivity: safeSensitivity,
  });
}

const promote = {
  decision: 'promote',
  durability: 'long',
  future_utility: 'high',
  confidence: 'high',
  meaning_preserved: true,
  reason: 'Useful durable workflow knowledge.',
  risk_flags: [],
};

test('importance evaluation is stored separately and promote does not finalize a proposal', async (t) => {
  assert.equal(typeof storeModule.evaluateEvidenceBoundProposal, 'function');
  assert.equal(typeof storeModule.listUnevaluatedEvidenceBoundProposals, 'function');
  const db = await createDb();
  t.after(() => db.close());
  record(db);

  assert.deepEqual(
    storeModule.listUnevaluatedEvidenceBoundProposals({
      db,
      projectId: 'project-a',
      branch: 'main',
    }).map((item) => item.id),
    ['proposal-1'],
  );

  const evaluated = storeModule.evaluateEvidenceBoundProposal(db, {
    proposalId: 'proposal-1',
    evaluatorId: 'importance:test',
    policyVersion: EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION,
    judgment: promote,
    evaluatedAt: '2026-10-11T12:02:00.000Z',
  });

  assert.equal(evaluated.status, 'pending');
  assert.deepEqual(evaluated.importance, promote);
  assert.equal(evaluated.importance_policy_version, EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION);
  assert.equal(evaluated.importance_evaluator_id, 'importance:test');
  assert.equal(evaluated.importance_evaluated_at, '2026-10-11T12:02:00.000Z');
  assert.deepEqual(
    storeModule.listUnevaluatedEvidenceBoundProposals({
      db,
      projectId: 'project-a',
      branch: 'main',
    }),
    [],
  );
  assert.throws(
    () => storeModule.evaluateEvidenceBoundProposal(db, {
      proposalId: 'proposal-1',
      evaluatorId: 'importance:test',
      policyVersion: EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION,
      judgment: promote,
      evaluatedAt: '2026-10-11T12:03:00.000Z',
    }),
    /already evaluated/i,
  );
});

test('ignore and needs_confirmation map to terminal review states without claims', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  record(db, 'proposal-ignore');
  const fact = 'Another durable-looking fact.';
  storeModule.recordEvidenceBoundProposal(db, {
    id: 'proposal-confirm',
    projectId: 'project-a',
    branch: 'main',
    kind: 'knowledge',
    canonicalFact: fact,
    evidenceIds: ['e-user'],
    fingerprint: evidenceExtractionFingerprint({ kind: 'knowledge', canonicalFact: fact }),
    policyVersion: EVIDENCE_EXTRACTION_POLICY_VERSION,
    evaluatorId: 'extractor:test',
    createdAt: '2026-10-11T12:01:00.000Z',
    inspectTextSensitivity: safeSensitivity,
  });

  const ignored = storeModule.evaluateEvidenceBoundProposal(db, {
    proposalId: 'proposal-ignore',
    evaluatorId: 'importance:test',
    policyVersion: EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION,
    judgment: {
      decision: 'ignore',
      durability: 'short',
      future_utility: 'low',
      confidence: 'high',
      meaning_preserved: true,
      reason: 'One-off state.',
      risk_flags: ['transient'],
    },
    evaluatedAt: '2026-10-11T12:02:00.000Z',
  });
  assert.equal(ignored.status, 'ignored');

  const confirm = storeModule.evaluateEvidenceBoundProposal(db, {
    proposalId: 'proposal-confirm',
    evaluatorId: 'importance:test',
    policyVersion: EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION,
    judgment: {
      decision: 'needs_confirmation',
      durability: 'long',
      future_utility: 'high',
      confidence: 'medium',
      meaning_preserved: true,
      reason: 'Scope is not clear enough.',
      risk_flags: ['scope_unclear'],
    },
    evaluatedAt: '2026-10-11T12:03:00.000Z',
  });
  assert.equal(confirm.status, 'needs_confirmation');
});
