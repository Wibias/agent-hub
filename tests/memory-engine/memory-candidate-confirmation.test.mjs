import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  CANDIDATE_CONFIRMATION_POLICY_VERSION,
  confirmMemoryCandidate,
  memoryCandidateConfirmationClaimId,
} from '../../memory-engine/memory-candidate-confirmation.mjs';
import {
  CANDIDATE_RELATION_POLICY_VERSION,
  memoryRelationClaimRef,
} from '../../memory-engine/memory-candidate-relation.mjs';
import {
  finalizePromotedMemoryCandidates,
} from '../../memory-engine/memory-candidate-promotion.mjs';
import {
  CAPTURE_POLICY_VERSION,
  memoryCandidateFingerprint,
} from '../../memory-engine/memory-capture-policy.mjs';

function createProject(memory) {
  memory.registerProject({
    projectId: 'project',
    repoIdentity: 'project',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
}

function seedCandidate(memory, {
  id = 'candidate-1',
  evidenceId = 'e-candidate',
  value = 'We use Postgres for concurrent writers.',
} = {}) {
  const evidence = memory.recordEvidence({
    id: evidenceId,
    projectId: 'project',
    harness: 'codex',
    sessionId: 's1',
    sourceKind: 'session',
    sourceRef: 'session:s1',
    capturedAt: '2026-10-01T01:00:00.000Z',
    branch: 'main',
    content: value,
    authorityClass: 'user_direct',
    metadata: { event_type: 'user_prompt', candidate_capture: true },
  });
  return memory.recordCandidate({
    id,
    evidenceId: evidence.id,
    type: 'decision',
    proposedValue: evidence.content_redacted,
    decisionReason: 'rule:decision:definitive',
    policyVersion: CAPTURE_POLICY_VERSION,
    fingerprint: memoryCandidateFingerprint({
      type: 'decision',
      value: evidence.content_redacted,
    }),
    createdAt: '2026-10-01T01:00:00.000Z',
  });
}

function seedDurable(memory, {
  claimId = 'claim-existing',
  evidenceId = 'e-existing',
  value = 'The project uses SQLite.',
} = {}) {
  memory.ingest({
    evidence: {
      id: evidenceId,
      projectId: 'project',
      sourceKind: 'session',
      sourceRef: 'session:existing',
      capturedAt: '2026-10-01T00:00:00.000Z',
      branch: 'main',
      content: value,
      authorityClass: 'user_direct',
      metadata: { explicit_memory: true },
    },
    claim: {
      id: claimId,
      kind: 'user_direct',
      subject: 'user memory',
      predicate: 'states',
      value,
      branchScope: 'main',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  });
  return memory.getClaim(claimId);
}

function seedConfirmationEvidence(memory, {
  id = 'e-confirm',
  content = 'memory candidate confirm: ~fixture => unrelated',
} = {}) {
  return memory.recordEvidence({
    id,
    projectId: 'project',
    harness: 'codex',
    sessionId: 'confirm',
    sourceKind: 'session',
    sourceRef: 'session:confirm',
    capturedAt: '2026-10-01T02:00:00.000Z',
    branch: 'main',
    content,
    authorityClass: 'user_direct',
    metadata: {
      event_type: 'user_prompt',
      explicit_memory: true,
      explicit_memory_mode: 'candidate_confirm',
    },
  });
}

function importanceNeedsConfirmation(memory, candidate) {
  memory.evaluateCandidate({
    candidateId: candidate.id,
    evaluatorId: 'codex:test:importance-v1',
    evaluatedAt: '2026-10-01T01:01:00.000Z',
    evaluation: {
      decision: 'needs_confirmation',
      suggested_type: 'decision',
      durability: 'long',
      future_utility: 'high',
      specificity: 'high',
      confidence: 'medium',
      meaning_preserved: true,
      canonical_fact: candidate.proposed_value,
      reason: 'User confirmation required.',
      risk_flags: ['scope_unclear'],
    },
  });
}

function promotionNeedsConfirmation(memory, candidate, target) {
  memory.evaluateCandidate({
    candidateId: candidate.id,
    evaluatorId: 'codex:test:importance-v1',
    evaluatedAt: '2026-10-01T01:01:00.000Z',
    evaluation: {
      decision: 'promote',
      suggested_type: 'decision',
      durability: 'long',
      future_utility: 'high',
      specificity: 'high',
      confidence: 'high',
      meaning_preserved: true,
      canonical_fact: candidate.proposed_value,
      reason: 'Durable.',
      risk_flags: [],
    },
  });
  memory.evaluateCandidateRelation({
    candidateId: candidate.id,
    evaluatorId: 'codex:test:relation-v1',
    policyVersion: CANDIDATE_RELATION_POLICY_VERSION,
    relation: {
      relation: 'update',
      target_ref: memoryRelationClaimRef(target.id),
      confidence: 'medium',
      meaning_preserved: true,
      reason: 'Relation needs user confirmation.',
    },
    relatedClaimId: target.id,
    evaluatedAt: '2026-10-01T01:02:00.000Z',
  });
  const finalized = finalizePromotedMemoryCandidates({
    memory,
    projectId: 'project',
    branch: 'main',
    apply: true,
    now: () => '2026-10-01T01:03:00.000Z',
  });
  assert.equal(finalized.summary.needs_confirmation, 1);
  assert.equal(memory.getCandidate(candidate.id).status, 'needs_confirmation');
}

test('user confirmation can promote an importance-confirmation candidate as unrelated using exact source text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-confirm-unrelated-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);
  const candidate = seedCandidate(memory);
  importanceNeedsConfirmation(memory, candidate);
  const evidence = seedConfirmationEvidence(memory);

  const result = confirmMemoryCandidate({
    memory,
    projectId: 'project',
    branch: 'main',
    candidateId: candidate.id,
    relation: 'unrelated',
    targetClaimId: null,
    confirmationEvidenceId: evidence.id,
    now: () => '2026-10-01T02:00:00.000Z',
  });

  assert.equal(result.policyVersion, CANDIDATE_CONFIRMATION_POLICY_VERSION);
  assert.equal(result.status, 'promoted');
  const claimId = memoryCandidateConfirmationClaimId(candidate.id);
  const claim = memory.getClaim(claimId);
  assert.equal(claim.value, candidate.proposed_value);
  assert.equal(claim.state, 'active');
  assert.equal(claim.created_from_evidence_id, candidate.source_evidence_id);
  assert.equal(memory.getCandidate(candidate.id).status, 'promoted');

  memory.close();
});

test('explicit update confirmation overrides an uncertain AI relation and atomically supersedes the selected target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-confirm-update-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);
  const target = seedDurable(memory);
  const candidate = seedCandidate(memory, {
    value: 'Correction: the project now uses Postgres instead of SQLite.',
  });
  promotionNeedsConfirmation(memory, candidate, target);
  const evidence = seedConfirmationEvidence(memory, {
    content: 'memory candidate confirm: ~fixture => update @fixture',
  });

  const result = confirmMemoryCandidate({
    memory,
    projectId: 'project',
    branch: 'main',
    candidateId: candidate.id,
    relation: 'update',
    targetClaimId: target.id,
    confirmationEvidenceId: evidence.id,
    now: () => '2026-10-01T02:00:00.000Z',
  });

  const claimId = memoryCandidateConfirmationClaimId(candidate.id);
  assert.equal(result.status, 'promoted');
  assert.equal(memory.getClaim(claimId).state, 'active');
  assert.equal(memory.getClaim(target.id).state, 'superseded');
  assert.equal(memory.getClaim(target.id).superseded_by_claim_id, claimId);
  assert.equal(memory.getCandidatePromotion(candidate.id).status, 'needs_confirmation');

  const confirmation = memory.getCandidateConfirmation(candidate.id);
  assert.equal(confirmation.relation, 'update');
  assert.equal(confirmation.related_claim_id, target.id);
  assert.equal(confirmation.confirmation_evidence_id, evidence.id);

  memory.close();
});

test('same confirmation closes the candidate without creating a duplicate claim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-confirm-same-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);
  const target = seedDurable(memory, { value: 'The project uses Postgres.' });
  const candidate = seedCandidate(memory, { value: 'The project uses Postgres.' });
  importanceNeedsConfirmation(memory, candidate);
  const evidence = seedConfirmationEvidence(memory, {
    content: 'memory candidate confirm: ~fixture => same @fixture',
  });

  const before = memory.exportCanonical().claims.length;
  const result = confirmMemoryCandidate({
    memory,
    projectId: 'project',
    branch: 'main',
    candidateId: candidate.id,
    relation: 'same',
    targetClaimId: target.id,
    confirmationEvidenceId: evidence.id,
    now: () => '2026-10-01T02:00:00.000Z',
  });

  assert.equal(result.status, 'superseded');
  assert.equal(memory.getCandidate(candidate.id).status, 'superseded');
  assert.equal(memory.exportCanonical().claims.length, before);
  assert.equal(memory.getClaim(target.id).state, 'active');

  memory.close();
});

test('contradict confirmation keeps both claims active and opens a conflict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-confirm-conflict-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);
  const target = seedDurable(memory);
  const candidate = seedCandidate(memory, { value: 'The project uses Postgres.' });
  importanceNeedsConfirmation(memory, candidate);
  const evidence = seedConfirmationEvidence(memory, {
    content: 'memory candidate confirm: ~fixture => contradict @fixture',
  });

  confirmMemoryCandidate({
    memory,
    projectId: 'project',
    branch: 'main',
    candidateId: candidate.id,
    relation: 'contradict',
    targetClaimId: target.id,
    confirmationEvidenceId: evidence.id,
    now: () => '2026-10-01T02:00:00.000Z',
  });

  const claimId = memoryCandidateConfirmationClaimId(candidate.id);
  assert.equal(memory.getClaim(claimId).state, 'active');
  assert.equal(memory.getClaim(target.id).state, 'active');
  const conflicts = memory.exportCanonical().conflicts;
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].state, 'open');

  memory.close();
});

test('confirmation fails closed for a non-confirmation candidate or inactive/cross-scope target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-confirm-guards-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);
  const candidate = seedCandidate(memory);
  const evidence = seedConfirmationEvidence(memory);

  assert.throws(
    () => confirmMemoryCandidate({
      memory,
      projectId: 'project',
      branch: 'main',
      candidateId: candidate.id,
      relation: 'unrelated',
      targetClaimId: null,
      confirmationEvidenceId: evidence.id,
    }),
    /needs_confirmation/i,
  );

  assert.equal(memory.getClaim(memoryCandidateConfirmationClaimId(candidate.id)), null);
  assert.equal(memory.getCandidateConfirmation(candidate.id), null);
  memory.close();
});

test('confirmation is exactly-once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-confirm-once-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);
  const candidate = seedCandidate(memory);
  importanceNeedsConfirmation(memory, candidate);
  const evidence = seedConfirmationEvidence(memory);

  confirmMemoryCandidate({
    memory,
    projectId: 'project',
    branch: 'main',
    candidateId: candidate.id,
    relation: 'unrelated',
    targetClaimId: null,
    confirmationEvidenceId: evidence.id,
  });

  assert.throws(
    () => confirmMemoryCandidate({
      memory,
      projectId: 'project',
      branch: 'main',
      candidateId: candidate.id,
      relation: 'unrelated',
      targetClaimId: null,
      confirmationEvidenceId: evidence.id,
    }),
    /already|needs_confirmation/i,
  );

  assert.equal(memory.exportCanonical().claims.length, 1);
  memory.close();
});
