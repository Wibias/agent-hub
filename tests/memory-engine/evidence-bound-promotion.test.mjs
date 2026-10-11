import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  EVIDENCE_PROMOTION_POLICY_VERSION,
  evidencePromotionClaimId,
  resolveEvidenceBoundPromotion,
  runEvidenceBoundPromotionPipeline,
} from '../../memory-engine/evidence-bound-promotion.mjs';
import { EvidenceBoundProposalStore } from '../../memory-engine/evidence-bound-proposal-store.mjs';
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

function readyProposal(overrides = {}) {
  return {
    id: 'proposal-1',
    project_id: 'project-a',
    branch: 'main',
    kind: 'procedure',
    canonical_fact: 'Use Postgres for concurrent writers.',
    status: 'pending',
    fingerprint: 'a'.repeat(64),
    evidence_ids: ['e-user'],
    authorities: ['user_direct'],
    importance: { decision: 'promote' },
    support: { decision: 'supported' },
    relation: {
      relation: 'unrelated', target_ref: null, confidence: 'high',
      meaning_preserved: true, reason: 'Unrelated.',
    },
    related_claim_id: null,
    ...overrides,
  };
}

function sourceEvidence(overrides = {}) {
  return {
    id: 'e-user', project_id: 'project-a', branch: 'main',
    sensitivity: 'normal', authority_class: 'user_direct',
    content_redacted: 'Use Postgres for concurrent writers.',
    ...overrides,
  };
}

test('promotion resolver creates a user durable-memory claim only for high-confidence unrelated single evidence', () => {
  assert.equal(EVIDENCE_PROMOTION_POLICY_VERSION, 'evidence-promotion-v1');
  const proposal = readyProposal();
  const resolved = resolveEvidenceBoundPromotion({
    proposal,
    sourceEvidence: sourceEvidence(),
    targetClaim: null,
    targetEvidence: null,
    finalizedAt: '2026-10-11T12:04:00.000Z',
  });
  assert.equal(resolved.status, 'promoted');
  assert.equal(resolved.claim.id, evidencePromotionClaimId(proposal));
  assert.deepEqual(resolved.claim, {
    id: evidencePromotionClaimId(proposal),
    kind: 'user_direct',
    subject: 'user memory',
    predicate: 'states',
    value: 'Use Postgres for concurrent writers.',
    state: 'active',
    branchScope: 'main',
    createdAt: '2026-10-11T12:04:00.000Z',
  });
  assert.deepEqual(resolved.lifecycle, {});
});

test('tool and repository facts keep source authority in evidence while claim uses evidence-memory shape', () => {
  for (const authority of ['tool_observation', 'repo_trusted']) {
    const proposal = readyProposal({
      id: 'proposal-' + authority,
      kind: 'knowledge',
      canonical_fact: 'Background jobs retry three times.',
      fingerprint: authority === 'tool_observation' ? 'b'.repeat(64) : 'c'.repeat(64),
      evidence_ids: ['e-source'],
      authorities: [authority],
    });
    const resolved = resolveEvidenceBoundPromotion({
      proposal,
      sourceEvidence: sourceEvidence({
        id: 'e-source', authority_class: authority,
        content_redacted: 'Observed retry count: 3.',
        ...(authority === 'tool_observation'
          ? { metadata: { tool_outcome: 'success' } }
          : {}),
      }),
      targetClaim: null,
      targetEvidence: null,
      finalizedAt: '2026-10-11T12:04:00.000Z',
    });
    assert.equal(resolved.status, 'promoted');
    assert.equal(resolved.claim.kind, 'knowledge');
    assert.equal(resolved.claim.subject, 'evidence memory');
    assert.equal(resolved.claim.predicate, 'states');
  }
});

test('same only deduplicates automatically when target authority matches source authority', () => {
  const proposal = readyProposal({
    relation: {
      relation: 'same', target_ref: evidenceRelationClaimRef('c-existing'),
      confidence: 'high', meaning_preserved: true, reason: 'Same.',
    },
    related_claim_id: 'c-existing',
  });
  const targetClaim = {
    id: 'c-existing', project_id: 'project-a', branch_scope: 'main', state: 'active',
    value: 'Use Postgres for concurrent writers.', created_from_evidence_id: 'e-target',
  };
  const sameAuthority = resolveEvidenceBoundPromotion({
    proposal,
    sourceEvidence: sourceEvidence(),
    targetClaim,
    targetEvidence: sourceEvidence({ id: 'e-target' }),
    finalizedAt: '2026-10-11T12:04:00.000Z',
  });
  assert.equal(sameAuthority.status, 'superseded');
  assert.equal(sameAuthority.claim, null);

  const differentAuthority = resolveEvidenceBoundPromotion({
    proposal,
    sourceEvidence: sourceEvidence(),
    targetClaim,
    targetEvidence: sourceEvidence({ id: 'e-target', authority_class: 'tool_observation' }),
    finalizedAt: '2026-10-11T12:04:00.000Z',
  });
  assert.equal(differentAuthority.status, 'needs_confirmation');
});

test('update contradict and uncertain relation never mutate claims automatically', () => {
  for (const relation of ['update', 'contradict']) {
    const proposal = readyProposal({
      relation: {
        relation, target_ref: evidenceRelationClaimRef('c-existing'),
        confidence: 'high', meaning_preserved: true, reason: relation,
      },
      related_claim_id: 'c-existing',
    });
    const resolved = resolveEvidenceBoundPromotion({
      proposal,
      sourceEvidence: sourceEvidence(),
      targetClaim: {
        id: 'c-existing', project_id: 'project-a', branch_scope: 'main', state: 'active',
        value: 'Old fact.', created_from_evidence_id: 'e-target',
      },
      targetEvidence: sourceEvidence({ id: 'e-target' }),
      finalizedAt: '2026-10-11T12:04:00.000Z',
    });
    assert.equal(resolved.status, 'needs_confirmation');
    assert.equal(resolved.claim, null);
  }

  const uncertain = resolveEvidenceBoundPromotion({
    proposal: readyProposal({
      relation: {
        relation: 'unrelated', target_ref: null, confidence: 'medium',
        meaning_preserved: true, reason: 'Uncertain.',
      },
    }),
    sourceEvidence: sourceEvidence(), targetClaim: null, targetEvidence: null,
    finalizedAt: '2026-10-11T12:04:00.000Z',
  });
  assert.equal(uncertain.status, 'needs_confirmation');
});

async function seedPromotionDb() {
  const root = await mkdtemp(join(tmpdir(), 'evidence-promotion-pipeline-'));
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
  `);
  db.prepare('INSERT INTO project_registry (project_id) VALUES (?)').run('project-a');
  db.prepare(`INSERT INTO evidence (
    id, project_id, branch, sensitivity, authority_class, content_redacted
  ) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('e-user', 'project-a', 'main', 'normal', 'user_direct', 'Use Postgres for concurrent writers.');
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
  store.evaluateRelation({
    proposalId: 'proposal-1', evaluatorId: 'relation:test', policyVersion: EVIDENCE_RELATION_POLICY_VERSION,
    relation: { relation: 'unrelated', target_ref: null, confidence: 'high', meaning_preserved: true, reason: 'Unrelated.' },
    relatedClaimId: null, evaluatedAt: '2026-10-11T12:03:00.000Z',
  });
  const proposal = store.get('proposal-1');
  store.close();
  return { dbPath, proposal };
}

function fakeMemory({ existingClaim = null } = {}) {
  const evidence = new Map([['e-user', sourceEvidence()]]);
  const claims = new Map(existingClaim ? [[existingClaim.id, existingClaim]] : []);
  const provenance = new Map();
  if (existingClaim) {
    provenance.set(existingClaim.id, [{
      evidence: evidence.get(existingClaim.created_from_evidence_id),
      role: 'primary',
      linked_at: existingClaim.created_at,
    }]);
  }
  let assertCalls = 0;
  return {
    getEvidence(id) { return evidence.get(id) ?? null; },
    getClaim(id) { return claims.get(id) ?? null; },
    getClaimEvidence(id) { return provenance.get(id) ?? []; },
    assertClaim({ evidenceId, evidenceIds = [evidenceId], claim, lifecycle }) {
      assertCalls += 1;
      assert.equal(evidenceId, 'e-user');
      assert.deepEqual(lifecycle, {});
      const stored = {
        id: claim.id,
        project_id: 'project-a',
        branch_scope: claim.branchScope,
        kind: claim.kind,
        subject: claim.subject,
        predicate: claim.predicate,
        value: claim.value,
        state: claim.state,
        created_from_evidence_id: evidenceId,
        created_at: claim.createdAt,
      };
      claims.set(stored.id, stored);
      provenance.set(stored.id, evidenceIds.map((id) => ({
        evidence: evidence.get(id),
        role: id === evidenceId ? 'primary' : 'supporting',
        linked_at: claim.createdAt,
      })));
      return { evidence: evidence.get(evidenceId), claim: stored };
    },
    assertCalls() { return assertCalls; },
  };
}

test('promotion pipeline asserts unrelated claim then finalizes proposal', async () => {
  const { dbPath, proposal } = await seedPromotionDb();
  const memory = fakeMemory();
  const result = await runEvidenceBoundPromotionPipeline({
    dbPath, memory, projectId: 'project-a', branch: 'main',
    inspectTextSensitivity: safeSensitivity,
    clock: () => '2026-10-11T12:04:00.000Z',
  });
  assert.equal(result.promoted, 1);
  assert.equal(memory.assertCalls(), 1);
  const claimId = evidencePromotionClaimId(proposal);
  assert.equal(memory.getClaim(claimId)?.value, 'Use Postgres for concurrent writers.');

  const store = new EvidenceBoundProposalStore({ dbPath, readOnly: true, inspectTextSensitivity: safeSensitivity });
  try {
    assert.equal(store.get('proposal-1')?.status, 'promoted');
    assert.equal(store.get('proposal-1')?.promotion?.claim_id, claimId);
  } finally { store.close(); }
});

test('promotion pipeline reconciles pre-existing deterministic claim without duplicate assert', async () => {
  const { dbPath, proposal } = await seedPromotionDb();
  const claimId = evidencePromotionClaimId(proposal);
  const memory = fakeMemory({
    existingClaim: {
      id: claimId, project_id: 'project-a', branch_scope: 'main', kind: 'user_direct',
      subject: 'user memory', predicate: 'states', value: 'Use Postgres for concurrent writers.',
      state: 'active', created_from_evidence_id: 'e-user', created_at: '2026-10-11T12:03:30.000Z',
    },
  });
  const result = await runEvidenceBoundPromotionPipeline({
    dbPath, memory, projectId: 'project-a', branch: 'main',
    inspectTextSensitivity: safeSensitivity,
    clock: () => '2026-10-11T12:04:00.000Z',
  });
  assert.equal(result.promoted, 1);
  assert.equal(memory.assertCalls(), 0);
});

test('same relation never auto-deduplicates distinct path-grounded repository evidence', () => {
  const proposal = readyProposal({
    id: 'proposal-repo',
    kind: 'knowledge',
    canonical_fact: 'Retries are three.',
    fingerprint: 'd'.repeat(64),
    evidence_ids: ['e-new'],
    authorities: ['repo_trusted'],
    relation: {
      relation: 'same', target_ref: evidenceRelationClaimRef('c-old'),
      confidence: 'high', meaning_preserved: true, reason: 'Same fact.',
    },
    related_claim_id: 'c-old',
  });
  const resolved = resolveEvidenceBoundPromotion({
    proposal,
    sourceEvidence: sourceEvidence({
      id: 'e-new', authority_class: 'repo_trusted', path: 'docs/policy.md',
      blob_oid: 'b'.repeat(40), content_redacted: 'Retries are three.',
    }),
    targetClaim: {
      id: 'c-old', project_id: 'project-a', branch_scope: 'main', state: 'active',
      value: 'Retries are three.', created_from_evidence_id: 'e-old',
    },
    targetEvidence: sourceEvidence({
      id: 'e-old', authority_class: 'repo_trusted', path: 'docs/policy.md',
      blob_oid: 'a'.repeat(40), content_redacted: 'Retries are three.',
    }),
    finalizedAt: '2026-10-11T12:04:00.000Z',
  });
  assert.equal(resolved.status, 'needs_confirmation');
});

test('tool observation auto-promotion requires explicit successful tool outcome', () => {
  const proposal = readyProposal({
    id: 'proposal-tool',
    kind: 'knowledge',
    canonical_fact: 'The database accepts concurrent writers.',
    fingerprint: 'd'.repeat(64),
    evidence_ids: ['e-tool'],
    authorities: ['tool_observation'],
  });

  const unknown = resolveEvidenceBoundPromotion({
    proposal,
    sourceEvidence: sourceEvidence({
      id: 'e-tool',
      authority_class: 'tool_observation',
      content_redacted: 'Tool returned database diagnostics.',
      metadata: { tool_outcome: 'unknown' },
    }),
    targetClaim: null,
    targetEvidence: null,
    finalizedAt: '2026-10-11T12:04:00.000Z',
  });
  assert.equal(unknown.status, 'needs_confirmation');
  assert.equal(unknown.claim, null);

  assert.throws(
    () => resolveEvidenceBoundPromotion({
      proposal,
      sourceEvidence: sourceEvidence({
        id: 'e-tool',
        authority_class: 'tool_observation',
        content_redacted: 'Tool command failed.',
        metadata: { tool_outcome: 'failure' },
      }),
      targetClaim: null,
      targetEvidence: null,
      finalizedAt: '2026-10-11T12:04:00.000Z',
    }),
    /failed tool observation/i,
  );

  const success = resolveEvidenceBoundPromotion({
    proposal,
    sourceEvidence: sourceEvidence({
      id: 'e-tool',
      authority_class: 'tool_observation',
      content_redacted: 'Tool confirmed concurrent writers.',
      metadata: { tool_outcome: 'success' },
    }),
    targetClaim: null,
    targetEvidence: null,
    finalizedAt: '2026-10-11T12:04:00.000Z',
  });
  assert.equal(success.status, 'promoted');
});
