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

function seedAgentCandidate(memory, {
  id = 'agent-candidate',
  evidenceId = 'e-agent-candidate',
  value = 'Decision: switch the database to Postgres.',
} = {}) {
  const evidence = memory.recordEvidence({
    id: evidenceId,
    projectId: 'project',
    harness: 'codex',
    sessionId: 'agent-session',
    sourceKind: 'assistant',
    sourceRef: 'codex:assistant:turn',
    capturedAt: '2026-10-01T01:00:00.000Z',
    branch: 'main',
    content: value,
    authorityClass: 'agent_inference',
    metadata: { event_type: 'assistant_stop', decision_capture: true },
  });
  const candidate = memory.recordAgentCandidate({
    id,
    evidenceId: evidence.id,
    proposedValue: evidence.content_redacted,
    decisionReason: 'rule:agent_decision:explicit_commitment',
    policyVersion: 'agent-capture-v1',
    fingerprint: 'a'.repeat(64),
    createdAt: '2026-10-01T01:00:00.000Z',
  });
  memory.evaluateAgentCandidate({
    candidateId: candidate.id,
    evaluatorId: 'codex:test:agent-importance-v1',
    evaluatedAt: '2026-10-01T01:01:00.000Z',
    evaluation: {
      decision: 'needs_confirmation',
      suggested_type: 'decision',
      durability: 'long',
      future_utility: 'high',
      specificity: 'high',
      confidence: 'medium',
      meaning_preserved: true,
      canonical_fact: null,
      reason: 'User confirmation required.',
      risk_flags: ['scope_unclear'],
    },
  });
  return memory.getCandidate(candidate.id);
}

function seedAgentDurable(memory, {
  claimId = 'agent-claim-existing',
  evidenceId = 'e-agent-existing',
  value = 'Agent decision: use Postgres.',
} = {}) {
  memory.ingest({
    evidence: {
      id: evidenceId,
      projectId: 'project',
      harness: 'codex',
      sessionId: 'agent-existing',
      sourceKind: 'assistant',
      sourceRef: 'codex:assistant:existing',
      capturedAt: '2026-10-01T00:00:00.000Z',
      branch: 'main',
      content: value,
      authorityClass: 'agent_inference',
      metadata: { event_type: 'assistant_stop' },
    },
    claim: {
      id: claimId,
      kind: 'agent_inference',
      subject: 'agent decision',
      predicate: 'states',
      value,
      branchScope: 'main',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  });
  return memory.getClaim(claimId);
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
    evaluatorId: 'codex:test:importance-v2',
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

function importanceKeepsCandidate(memory, candidate) {
  memory.evaluateCandidate({
    candidateId: candidate.id,
    evaluatorId: 'codex:test:importance-v2',
    evaluatedAt: '2026-10-01T01:01:00.000Z',
    evaluation: {
      decision: 'keep_candidate',
      suggested_type: 'decision',
      durability: 'medium',
      future_utility: 'medium',
      specificity: 'high',
      confidence: 'high',
      meaning_preserved: true,
      canonical_fact: candidate.proposed_value,
      reason: 'Useful review backlog candidate.',
      risk_flags: ['transient'],
    },
  });
  const kept = memory.getCandidate(candidate.id);
  assert.equal(kept.status, 'pending');
  assert.notEqual(kept.evaluated_at, null);
}

function promotionNeedsConfirmation(memory, candidate, target) {
  memory.evaluateCandidate({
    candidateId: candidate.id,
    evaluatorId: 'codex:test:importance-v2',
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

test('user confirmation can explicitly promote an evaluated keep_candidate backlog item', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-confirm-kept-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);
  const candidate = seedCandidate(memory, {
    value: 'We use pnpm during the migration review cycle.',
  });
  importanceKeepsCandidate(memory, candidate);
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

  assert.equal(result.status, 'promoted');
  const claimId = memoryCandidateConfirmationClaimId(candidate.id);
  assert.equal(memory.getClaim(claimId).value, candidate.proposed_value);
  assert.equal(memory.getCandidate(candidate.id).status, 'promoted');
  assert.equal(memory.getCandidateConfirmation(candidate.id).relation, 'unrelated');

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

  const lifecycle = memory.exportCanonical().lifecycle_events;
  assert.equal(lifecycle.length, 1);
  assert.equal(lifecycle[0].evidence_id, evidence.id);

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
  assert.equal(conflicts[0].created_by_evidence_id, evidence.id);

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
    /not confirmable/i,
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


test('confirming an agent decision promotes new user_direct evidence without rewriting agent provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-confirm-agent-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);
  const candidate = seedAgentCandidate(memory);
  const originalEvidence = memory.getEvidence(candidate.source_evidence_id);
  const confirmation = seedConfirmationEvidence(memory);

  const result = confirmMemoryCandidate({
    memory,
    projectId: 'project',
    branch: 'main',
    candidateId: candidate.id,
    relation: 'unrelated',
    targetClaimId: null,
    confirmationEvidenceId: confirmation.id,
    now: () => '2026-10-01T02:00:00.000Z',
  });

  assert.equal(result.status, 'promoted');
  const claim = memory.getClaim(memoryCandidateConfirmationClaimId(candidate.id));
  assert.equal(claim.kind, 'user_direct');
  assert.equal(claim.subject, 'user memory');
  assert.equal(claim.value, candidate.proposed_value);
  assert.notEqual(claim.created_from_evidence_id, originalEvidence.id);

  const endorsed = memory.getEvidence(claim.created_from_evidence_id);
  assert.equal(endorsed.authority_class, 'user_direct');
  assert.equal(endorsed.source_kind, 'user_confirmation');
  assert.equal(
    endorsed.metadata.agent_source_evidence_id,
    originalEvidence.id,
  );
  assert.equal(
    memory.getEvidence(originalEvidence.id).authority_class,
    'agent_inference',
  );

  memory.close();
});

test('same confirmation against an agent decision upgrades authority by superseding the agent claim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-confirm-agent-same-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);
  const target = seedAgentDurable(memory);
  const candidate = seedAgentCandidate(memory, {
    value: 'Agent decision: use Postgres.',
  });
  const confirmation = seedConfirmationEvidence(memory, {
    content: 'memory candidate confirm: ~fixture => same @fixture',
  });

  const result = confirmMemoryCandidate({
    memory,
    projectId: 'project',
    branch: 'main',
    candidateId: candidate.id,
    relation: 'same',
    targetClaimId: target.id,
    confirmationEvidenceId: confirmation.id,
    now: () => '2026-10-01T02:00:00.000Z',
  });

  assert.equal(result.status, 'promoted');
  const userClaim = memory.getClaim(
    memoryCandidateConfirmationClaimId(candidate.id),
  );
  assert.equal(userClaim.kind, 'user_direct');
  assert.equal(userClaim.state, 'active');
  assert.equal(memory.getClaim(target.id).state, 'superseded');
  assert.equal(
    memory.getClaim(target.id).superseded_by_claim_id,
    userClaim.id,
  );

  memory.close();
});
