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
import { EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION } from '../../memory-engine/evidence-bound-proposal-judge.mjs';
import { EVIDENCE_SUPPORT_POLICY_VERSION } from '../../memory-engine/evidence-bound-support-judge.mjs';
import { EVIDENCE_RELATION_POLICY_VERSION } from '../../memory-engine/evidence-bound-relation-judge.mjs';

function safeSensitivity() { return { containsSecret: false }; }

async function createDb() {
  const root = await mkdtemp(join(tmpdir(), 'evidence-promotion-store-'));
  const db = new DatabaseSync(join(root, 'memory.sqlite3'), { timeout: 5_000, enableForeignKeyConstraints: true });
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
  db.prepare(`INSERT INTO evidence (
    id, project_id, branch, sensitivity, authority_class, content_redacted
  ) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('e-user', 'project-a', 'main', 'normal', 'user_direct', 'Use Postgres for concurrent writers.');
  storeModule.ensureEvidenceProposalSchema(db);
  return db;
}

function seedReady(db, id = 'proposal-1') {
  const canonicalFact = id === 'proposal-1'
    ? 'Use Postgres for concurrent writers.'
    : 'Another durable fact.';
  const kind = id === 'proposal-1' ? 'procedure' : 'knowledge';
  storeModule.recordEvidenceBoundProposal(db, {
    id, projectId: 'project-a', branch: 'main', kind, canonicalFact,
    evidenceIds: ['e-user'], fingerprint: evidenceExtractionFingerprint({ kind, canonicalFact }),
    policyVersion: EVIDENCE_EXTRACTION_POLICY_VERSION, evaluatorId: 'extractor:test',
    createdAt: '2026-10-11T12:00:00.000Z', inspectTextSensitivity: safeSensitivity,
  });
  storeModule.evaluateEvidenceBoundProposal(db, {
    proposalId: id, evaluatorId: 'importance:test', policyVersion: EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION,
    judgment: { decision: 'promote', durability: 'long', future_utility: 'high', confidence: 'high', meaning_preserved: true, reason: 'Durable.', risk_flags: [] },
    evaluatedAt: '2026-10-11T12:01:00.000Z',
  });
  storeModule.evaluateEvidenceBoundProposalSupport(db, {
    proposalId: id, evaluatorId: 'support:test', policyVersion: EVIDENCE_SUPPORT_POLICY_VERSION,
    judgment: { decision: 'supported', confidence: 'high', meaning_preserved: true, reason: 'Supported.', risk_flags: [] },
    evaluatedAt: '2026-10-11T12:02:00.000Z',
  });
  storeModule.evaluateEvidenceBoundProposalRelation(db, {
    proposalId: id, evaluatorId: 'relation:test', policyVersion: EVIDENCE_RELATION_POLICY_VERSION,
    relation: { relation: 'unrelated', target_ref: null, confidence: 'high', meaning_preserved: true, reason: 'Unrelated.' },
    relatedClaimId: null, evaluatedAt: '2026-10-11T12:03:00.000Z',
  });
}

test('promotion-ready listing requires completed importance support and relation stages', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  seedReady(db);
  assert.deepEqual(
    storeModule.listPromotionReadyEvidenceBoundProposals({
      db, projectId: 'project-a', branch: 'main',
    }).map((item) => item.id),
    ['proposal-1'],
  );
});

test('promotion finalization stores audit and terminal proposal status', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  seedReady(db);

  const finalized = storeModule.finalizeEvidenceBoundProposalPromotion(db, {
    proposalId: 'proposal-1',
    status: 'promoted',
    claimId: 'evidence-memory:abc',
    relatedClaimId: null,
    policyVersion: 'evidence-promotion-v1',
    finalizedAt: '2026-10-11T12:04:00.000Z',
    result: {
      status: 'promoted',
      relation: 'unrelated',
      claim_id: 'evidence-memory:abc',
      related_claim_id: null,
    },
  });
  assert.equal(finalized.status, 'promoted');
  assert.equal(finalized.promotion.claim_id, 'evidence-memory:abc');
  assert.deepEqual(
    storeModule.listPromotionReadyEvidenceBoundProposals({
      db, projectId: 'project-a', branch: 'main',
    }),
    [],
  );
  assert.throws(
    () => storeModule.finalizeEvidenceBoundProposalPromotion(db, {
      proposalId: 'proposal-1', status: 'promoted', claimId: 'x', relatedClaimId: null,
      policyVersion: 'evidence-promotion-v1', finalizedAt: '2026-10-11T12:05:00.000Z', result: {},
    }),
    /already finalized|not pending/i,
  );
});

test('promotion finalization permits needs_confirmation without claim id', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  seedReady(db, 'proposal-1');

  const confirm = storeModule.finalizeEvidenceBoundProposalPromotion(db, {
    proposalId: 'proposal-1', status: 'needs_confirmation', claimId: null, relatedClaimId: null,
    policyVersion: 'evidence-promotion-v1', finalizedAt: '2026-10-11T12:05:00.000Z',
    result: { status: 'needs_confirmation', relation: 'unrelated', claim_id: null, related_claim_id: null },
  });
  assert.equal(confirm.status, 'needs_confirmation');
});

test('promotion finalization rejects audit payload that disagrees with stored relation or ids', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  seedReady(db);

  assert.throws(
    () => storeModule.finalizeEvidenceBoundProposalPromotion(db, {
      proposalId: 'proposal-1',
      status: 'promoted',
      claimId: 'evidence-memory:abc',
      relatedClaimId: null,
      policyVersion: 'evidence-promotion-v1',
      finalizedAt: '2026-10-11T12:04:00.000Z',
      result: {
        status: 'promoted',
        relation: 'same',
        claim_id: 'evidence-memory:abc',
        related_claim_id: null,
      },
    }),
    /audit.*relation|result.*relation/i,
  );
  assert.equal(storeModule.getEvidenceBoundProposal(db, 'proposal-1').status, 'pending');
});
