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
import {
  EVIDENCE_RELATION_POLICY_VERSION,
  evidenceRelationClaimRef,
} from '../../memory-engine/evidence-bound-relation-judge.mjs';

function safeSensitivity() { return { containsSecret: false }; }

async function createDb() {
  const root = await mkdtemp(join(tmpdir(), 'evidence-relation-store-'));
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
    CREATE TABLE claim_evidence (
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      evidence_id TEXT NOT NULL REFERENCES evidence(id),
      role TEXT NOT NULL CHECK (role IN ('primary','supporting')),
      linked_at TEXT NOT NULL,
      PRIMARY KEY (claim_id, evidence_id)
    ) STRICT;
    CREATE UNIQUE INDEX claim_evidence_one_primary
    ON claim_evidence (claim_id) WHERE role = 'primary';
  `);
  db.prepare('INSERT INTO project_registry (project_id) VALUES (?)').run('project-a');
  db.prepare('INSERT INTO project_registry (project_id) VALUES (?)').run('project-b');
  const ev = db.prepare(`INSERT INTO evidence (
    id, project_id, branch, sensitivity, authority_class, content_redacted
  ) VALUES (?, ?, ?, ?, ?, ?)`);
  ev.run('e-user', 'project-a', 'main', 'normal', 'user_direct', 'We use Postgres because several processes write at once.');
  ev.run('e-tool', 'project-a', 'main', 'normal', 'tool_observation', 'Observed Postgres handling concurrent writers.');
  ev.run('e-agent', 'project-a', 'main', 'normal', 'agent_inference', 'Maybe Redis is faster.');
  ev.run('e-other', 'project-b', 'main', 'normal', 'user_direct', 'Other project.');

  const claim = db.prepare(`INSERT INTO claims (
    id, project_id, kind, subject, predicate, value_text, state, branch_scope, created_from_evidence_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  claim.run('c-user', 'project-a', 'user_direct', 'user memory', 'states', 'Use SQLite for local storage.', 'active', 'main', 'e-user');
  claim.run('c-tool', 'project-a', 'knowledge', 'evidence memory', 'states', 'Redis is used for cache.', 'active', 'main', 'e-tool');
  claim.run('c-agent', 'project-a', 'agent_inference', 'agent decision', 'states', 'Maybe Redis is faster.', 'active', 'main', 'e-agent');
  claim.run('c-other', 'project-b', 'user_direct', 'user memory', 'states', 'Other project.', 'active', 'main', 'e-other');
  const provenance = db.prepare(`
    INSERT INTO claim_evidence (claim_id, evidence_id, role, linked_at)
    VALUES (?, ?, 'primary', ?)
  `);
  provenance.run('c-user', 'e-user', '2026-10-11T11:00:00.000Z');
  provenance.run('c-tool', 'e-tool', '2026-10-11T11:00:00.000Z');
  provenance.run('c-agent', 'e-agent', '2026-10-11T11:00:00.000Z');
  provenance.run('c-other', 'e-other', '2026-10-11T11:00:00.000Z');
  storeModule.ensureEvidenceProposalSchema(db);
  return db;
}

function recordSupported(db, {
  id = 'proposal-1',
  canonicalFact = 'Use Postgres for concurrent writers.',
  evidenceIds = ['e-user'],
  kind = 'procedure',
} = {}) {
  storeModule.recordEvidenceBoundProposal(db, {
    id, projectId: 'project-a', branch: 'main', kind, canonicalFact, evidenceIds,
    fingerprint: evidenceExtractionFingerprint({ kind, canonicalFact }),
    policyVersion: EVIDENCE_EXTRACTION_POLICY_VERSION,
    evaluatorId: 'extractor:test', createdAt: '2026-10-11T12:00:00.000Z',
    inspectTextSensitivity: safeSensitivity,
  });
  storeModule.evaluateEvidenceBoundProposal(db, {
    proposalId: id, evaluatorId: 'importance:test',
    policyVersion: EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION,
    judgment: {
      decision: 'promote', durability: 'long', future_utility: 'high', confidence: 'high',
      meaning_preserved: true, reason: 'Durable.', risk_flags: [],
    }, evaluatedAt: '2026-10-11T12:01:00.000Z',
  });
  storeModule.evaluateEvidenceBoundProposalSupport(db, {
    proposalId: id, evaluatorId: 'support:test', policyVersion: EVIDENCE_SUPPORT_POLICY_VERSION,
    judgment: {
      decision: 'supported', confidence: 'high', meaning_preserved: true,
      reason: 'Directly entailed.', risk_flags: [],
    }, evaluatedAt: '2026-10-11T12:02:00.000Z',
  });
}

test('relation-ready listing admits supported single- and multi-evidence proposals', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  recordSupported(db);
  recordSupported(db, {
    id: 'proposal-multi',
    canonicalFact: 'Postgres was also observed handling concurrent writers.',
    evidenceIds: ['e-user', 'e-tool'],
    kind: 'knowledge',
  });

  assert.deepEqual(
    storeModule.listRelationPendingEvidenceBoundProposals({
      db, projectId: 'project-a', branch: 'main',
    }).map((item) => item.id),
    ['proposal-1', 'proposal-multi'],
  );
});

test('active relation claims exclude wrong scope and ineligible authority', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  const claims = storeModule.listActiveEvidenceRelationClaims(db, {
    projectId: 'project-a', branch: 'main',
  });
  assert.deepEqual(claims.map((item) => item.claim_id), ['c-tool', 'c-user']);
  assert.deepEqual(claims.map((item) => item.authority).sort(), ['tool_observation', 'user_direct']);
  assert.equal(claims.every((item) => /^@[0-9a-f]{10}$/u.test(item.ref)), true);
});

test('relation targets fail closed when supporting provenance has ineligible authority', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  db.prepare(`
    INSERT INTO claim_evidence (claim_id, evidence_id, role, linked_at)
    VALUES (?, ?, 'supporting', ?)
  `).run('c-user', 'e-agent', '2026-10-11T11:01:00.000Z');

  const claims = storeModule.listActiveEvidenceRelationClaims(db, {
    projectId: 'project-a', branch: 'main',
  });
  assert.equal(claims.some((item) => item.claim_id === 'c-user'), false);

  recordSupported(db);
  assert.throws(
    () => storeModule.evaluateEvidenceBoundProposalRelation(db, {
      proposalId: 'proposal-1', evaluatorId: 'relation:test',
      policyVersion: EVIDENCE_RELATION_POLICY_VERSION,
      relation: {
        relation: 'same', target_ref: evidenceRelationClaimRef('c-user'),
        confidence: 'high', meaning_preserved: true, reason: 'Same.',
      },
      relatedClaimId: 'c-user',
      evaluatedAt: '2026-10-11T12:03:00.000Z',
    }),
    /target.*scope/i,
  );
});

test('relation audit persists unrelated judgment without mutating proposal status', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  recordSupported(db);

  const stored = storeModule.evaluateEvidenceBoundProposalRelation(db, {
    proposalId: 'proposal-1', evaluatorId: 'relation:test',
    policyVersion: EVIDENCE_RELATION_POLICY_VERSION,
    relation: {
      relation: 'unrelated', target_ref: null, confidence: 'high',
      meaning_preserved: true, reason: 'No matching durable proposition.',
    },
    relatedClaimId: null,
    evaluatedAt: '2026-10-11T12:03:00.000Z',
  });
  assert.equal(stored.status, 'pending');
  assert.equal(stored.relation.relation, 'unrelated');
  assert.equal(stored.related_claim_id, null);
  assert.deepEqual(
    storeModule.listRelationPendingEvidenceBoundProposals({
      db, projectId: 'project-a', branch: 'main',
    }),
    [],
  );
});

test('related audit requires target ref to resolve exactly to active in-scope claim', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  recordSupported(db);

  const targetRef = evidenceRelationClaimRef('c-user');
  const stored = storeModule.evaluateEvidenceBoundProposalRelation(db, {
    proposalId: 'proposal-1', evaluatorId: 'relation:test',
    policyVersion: EVIDENCE_RELATION_POLICY_VERSION,
    relation: {
      relation: 'update', target_ref: targetRef, confidence: 'high',
      meaning_preserved: true, reason: 'Newer replacement.',
    },
    relatedClaimId: 'c-user',
    evaluatedAt: '2026-10-11T12:03:00.000Z',
  });
  assert.equal(stored.related_claim_id, 'c-user');

  recordSupported(db, {
    id: 'proposal-2', canonicalFact: 'Another fact.', kind: 'knowledge',
  });
  assert.throws(
    () => storeModule.evaluateEvidenceBoundProposalRelation(db, {
      proposalId: 'proposal-2', evaluatorId: 'relation:test',
      policyVersion: EVIDENCE_RELATION_POLICY_VERSION,
      relation: {
        relation: 'same', target_ref: evidenceRelationClaimRef('c-other'), confidence: 'high',
        meaning_preserved: true, reason: 'Same.',
      }, relatedClaimId: 'c-other', evaluatedAt: '2026-10-11T12:04:00.000Z',
    }),
    /target.*scope/i,
  );
});
