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
import {
  EVIDENCE_SUPPORT_POLICY_VERSION,
} from '../../memory-engine/evidence-bound-support-judge.mjs';

function safeSensitivity() { return { containsSecret: false }; }

async function createDb() {
  const root = await mkdtemp(join(tmpdir(), 'evidence-support-store-'));
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
  db.prepare(`INSERT INTO evidence (
    id, project_id, branch, sensitivity, authority_class, content_redacted
  ) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('e-user', 'project-a', 'main', 'normal', 'user_direct', 'We use Postgres because several processes write at once.');
  storeModule.ensureEvidenceProposalSchema(db);
  return db;
}

function recordPromote(db) {
  const canonicalFact = 'Use Postgres for concurrent writers.';
  const proposal = storeModule.recordEvidenceBoundProposal(db, {
    id: 'proposal-1',
    projectId: 'project-a',
    branch: 'main',
    kind: 'procedure',
    canonicalFact,
    evidenceIds: ['e-user'],
    fingerprint: evidenceExtractionFingerprint({ kind: 'procedure', canonicalFact }),
    policyVersion: EVIDENCE_EXTRACTION_POLICY_VERSION,
    evaluatorId: 'extractor:test',
    createdAt: '2026-10-11T12:00:00.000Z',
    inspectTextSensitivity: safeSensitivity,
  });
  storeModule.evaluateEvidenceBoundProposal(db, {
    proposalId: proposal.id,
    evaluatorId: 'importance:test',
    policyVersion: EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION,
    judgment: {
      decision: 'promote',
      durability: 'long',
      future_utility: 'high',
      confidence: 'high',
      meaning_preserved: true,
      reason: 'Durable.',
      risk_flags: [],
    },
    evaluatedAt: '2026-10-11T12:01:00.000Z',
  });
  return proposal;
}

const supported = {
  decision: 'supported',
  confidence: 'high',
  meaning_preserved: true,
  reason: 'Directly entailed.',
  risk_flags: [],
};

test('support-ready listing requires promote importance and exposes cited evidence text', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  recordPromote(db);

  assert.deepEqual(
    storeModule.listSupportPendingEvidenceBoundProposals({
      db, projectId: 'project-a', branch: 'main',
    }).map((item) => item.id),
    ['proposal-1'],
  );
  assert.deepEqual(
    storeModule.getEvidenceBoundProposalEvidence(db, 'proposal-1'),
    [{
      id: 'e-user',
      project_id: 'project-a',
      branch: 'main',
      sensitivity: 'normal',
      authority_class: 'user_direct',
      content_redacted: 'We use Postgres because several processes write at once.',
    }],
  );
});

test('supported judgment is audited but leaves proposal pending for relation', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  recordPromote(db);

  const result = storeModule.evaluateEvidenceBoundProposalSupport(db, {
    proposalId: 'proposal-1',
    evaluatorId: 'support:test',
    policyVersion: EVIDENCE_SUPPORT_POLICY_VERSION,
    judgment: supported,
    evaluatedAt: '2026-10-11T12:02:00.000Z',
  });

  assert.equal(result.status, 'pending');
  assert.deepEqual(result.support, supported);
  assert.equal(result.support_policy_version, EVIDENCE_SUPPORT_POLICY_VERSION);
  assert.deepEqual(
    storeModule.listSupportPendingEvidenceBoundProposals({
      db, projectId: 'project-a', branch: 'main',
    }),
    [],
  );
});

test('unsupported and ambiguous support fail closed before relation', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  recordPromote(db);

  const unsupported = storeModule.evaluateEvidenceBoundProposalSupport(db, {
    proposalId: 'proposal-1',
    evaluatorId: 'support:test',
    policyVersion: EVIDENCE_SUPPORT_POLICY_VERSION,
    judgment: {
      decision: 'unsupported',
      confidence: 'high',
      meaning_preserved: false,
      reason: 'Adds unsupported scope.',
      risk_flags: ['scope_mismatch'],
    },
    evaluatedAt: '2026-10-11T12:02:00.000Z',
  });
  assert.equal(unsupported.status, 'ignored');

  const canonicalFact = 'A second proposal.';
  storeModule.recordEvidenceBoundProposal(db, {
    id: 'proposal-2', projectId: 'project-a', branch: 'main', kind: 'knowledge',
    canonicalFact, evidenceIds: ['e-user'],
    fingerprint: evidenceExtractionFingerprint({ kind: 'knowledge', canonicalFact }),
    policyVersion: EVIDENCE_EXTRACTION_POLICY_VERSION, evaluatorId: 'extractor:test',
    createdAt: '2026-10-11T12:03:00.000Z', inspectTextSensitivity: safeSensitivity,
  });
  storeModule.evaluateEvidenceBoundProposal(db, {
    proposalId: 'proposal-2', evaluatorId: 'importance:test',
    policyVersion: EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION,
    judgment: {
      decision: 'promote', durability: 'long', future_utility: 'high', confidence: 'high',
      meaning_preserved: true, reason: 'Durable.', risk_flags: [],
    }, evaluatedAt: '2026-10-11T12:04:00.000Z',
  });
  const ambiguous = storeModule.evaluateEvidenceBoundProposalSupport(db, {
    proposalId: 'proposal-2', evaluatorId: 'support:test',
    policyVersion: EVIDENCE_SUPPORT_POLICY_VERSION,
    judgment: {
      decision: 'needs_confirmation', confidence: 'medium', meaning_preserved: false,
      reason: 'Ambiguous.', risk_flags: ['ambiguous_support'],
    }, evaluatedAt: '2026-10-11T12:05:00.000Z',
  });
  assert.equal(ambiguous.status, 'needs_confirmation');
});
