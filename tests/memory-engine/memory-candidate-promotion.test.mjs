import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  CANDIDATE_PROMOTION_POLICY_VERSION,
  finalizePromotedMemoryCandidates,
  memoryCandidatePromotionClaimId,
} from '../../memory-engine/memory-candidate-promotion.mjs';
import {
  CANDIDATE_RELATION_POLICY_VERSION,
  memoryRelationClaimRef,
} from '../../memory-engine/memory-candidate-relation.mjs';
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

function seedPromotedRelation(memory, {
  id,
  evidenceId,
  value,
  canonicalFact,
  relation,
  relatedClaim = null,
  relationConfidence = 'high',
  relationMeaningPreserved = true,
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
    metadata: {
      event_type: 'user_prompt',
      candidate_capture: true,
    },
  });

  const candidate = memory.recordCandidate({
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
      canonical_fact: canonicalFact,
      reason: 'Durable project information.',
      risk_flags: [],
    },
  });

  memory.evaluateCandidateRelation({
    candidateId: candidate.id,
    evaluatorId: 'codex:test:relation-v1',
    policyVersion: CANDIDATE_RELATION_POLICY_VERSION,
    relation: {
      relation,
      target_ref: relatedClaim ? memoryRelationClaimRef(relatedClaim.id) : null,
      confidence: relationConfidence,
      meaning_preserved: relationMeaningPreserved,
      reason: 'Fixture relation.',
    },
    relatedClaimId: relatedClaim?.id ?? null,
    evaluatedAt: '2026-10-01T01:02:00.000Z',
  });

  return memory.getCandidate(candidate.id);
}

test('unrelated promotion creates one canonical active user memory from canonical_fact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-promotion-unrelated-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);

  const candidate = seedPromotedRelation(memory, {
    id: 'candidate-unrelated',
    evidenceId: 'e-unrelated',
    value: 'We use Postgres for concurrent writers.',
    canonicalFact: 'The project uses Postgres for concurrent writers.',
    relation: 'unrelated',
  });

  const result = finalizePromotedMemoryCandidates({
    memory,
    projectId: 'project',
    branch: 'main',
    apply: true,
    now: () => '2026-10-01T02:00:00.000Z',
  });

  assert.equal(result.policyVersion, CANDIDATE_PROMOTION_POLICY_VERSION);
  assert.equal(result.summary.promoted, 1);
  assert.equal(memory.getCandidate(candidate.id).status, 'promoted');

  const claimId = memoryCandidatePromotionClaimId(candidate.id);
  const claim = memory.getClaim(claimId);
  assert.equal(claim.state, 'active');
  assert.equal(claim.kind, 'user_direct');
  assert.equal(claim.subject, 'user memory');
  assert.equal(claim.predicate, 'states');
  assert.equal(claim.value, 'The project uses Postgres for concurrent writers.');
  assert.equal(claim.created_from_evidence_id, candidate.source_evidence_id);

  memory.close();
});

test('same closes the candidate as redundant and creates no duplicate claim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-promotion-same-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);

  const existing = seedDurable(memory, {
    value: 'The project uses Postgres.',
  });
  const before = memory.exportCanonical().claims.length;

  const candidate = seedPromotedRelation(memory, {
    id: 'candidate-same',
    evidenceId: 'e-same',
    value: 'We use Postgres.',
    canonicalFact: 'The project uses Postgres.',
    relation: 'same',
    relatedClaim: existing,
  });

  const result = finalizePromotedMemoryCandidates({
    memory,
    projectId: 'project',
    branch: 'main',
    apply: true,
    now: () => '2026-10-01T02:00:00.000Z',
  });

  assert.equal(result.summary.superseded, 1);
  assert.equal(memory.getCandidate(candidate.id).status, 'superseded');
  assert.equal(memory.exportCanonical().claims.length, before);
  assert.equal(memory.getClaim(existing.id).state, 'active');
  assert.equal(memory.getClaim(memoryCandidatePromotionClaimId(candidate.id)), null);

  memory.close();
});

test('update atomically creates the new claim and supersedes the exact relation target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-promotion-update-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);

  const existing = seedDurable(memory, {
    value: 'The project uses SQLite.',
  });
  const candidate = seedPromotedRelation(memory, {
    id: 'candidate-update',
    evidenceId: 'e-update',
    value: 'Correction: the project now uses Postgres instead of SQLite.',
    canonicalFact: 'The project uses Postgres instead of SQLite.',
    relation: 'update',
    relatedClaim: existing,
  });

  const result = finalizePromotedMemoryCandidates({
    memory,
    projectId: 'project',
    branch: 'main',
    apply: true,
    now: () => '2026-10-01T02:00:00.000Z',
  });

  assert.equal(result.summary.promoted, 1);
  const claimId = memoryCandidatePromotionClaimId(candidate.id);
  assert.equal(memory.getClaim(claimId).state, 'active');

  const old = memory.getClaim(existing.id);
  assert.equal(old.state, 'superseded');
  assert.equal(old.superseded_by_claim_id, claimId);

  const lifecycle = memory.exportCanonical().lifecycle_events;
  assert.equal(lifecycle.length, 1);
  assert.equal(lifecycle[0].action, 'supersede');
  assert.equal(lifecycle[0].source_claim_id, claimId);
  assert.equal(lifecycle[0].target_claim_id, existing.id);

  memory.close();
});

test('contradict creates a new active claim and an open conflict without choosing a winner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-promotion-contradict-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);

  const existing = seedDurable(memory, {
    value: 'The project uses SQLite.',
  });
  const candidate = seedPromotedRelation(memory, {
    id: 'candidate-contradict',
    evidenceId: 'e-contradict',
    value: 'The project uses Postgres.',
    canonicalFact: 'The project uses Postgres.',
    relation: 'contradict',
    relatedClaim: existing,
  });

  const result = finalizePromotedMemoryCandidates({
    memory,
    projectId: 'project',
    branch: 'main',
    apply: true,
    now: () => '2026-10-01T02:00:00.000Z',
  });

  assert.equal(result.summary.promoted, 1);
  const claimId = memoryCandidatePromotionClaimId(candidate.id);
  assert.equal(memory.getClaim(claimId).state, 'active');
  assert.equal(memory.getClaim(existing.id).state, 'active');

  const conflicts = memory.exportCanonical().conflicts;
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].state, 'open');
  assert.deepEqual(
    [conflicts[0].claim_a, conflicts[0].claim_b].sort(),
    [claimId, existing.id].sort(),
  );

  memory.close();
});

test('low-confidence or meaning-unsafe relation requires confirmation and creates no claim', async () => {
  for (const [suffix, confidence, meaningPreserved] of [
    ['low', 'low', true],
    ['meaning', 'high', false],
  ]) {
    const root = await mkdtemp(join(tmpdir(), 'agent-hub-promotion-guard-' + suffix + '-'));
    const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
    createProject(memory);

    const candidate = seedPromotedRelation(memory, {
      id: 'candidate-' + suffix,
      evidenceId: 'e-' + suffix,
      value: 'We use Postgres ' + suffix + '.',
      canonicalFact: 'The project uses Postgres ' + suffix + '.',
      relation: 'unrelated',
      relationConfidence: confidence,
      relationMeaningPreserved: meaningPreserved,
    });

    const result = finalizePromotedMemoryCandidates({
      memory,
      projectId: 'project',
      branch: 'main',
      apply: true,
      now: () => '2026-10-01T02:00:00.000Z',
    });

    assert.equal(result.summary.needs_confirmation, 1);
    assert.equal(memory.getCandidate(candidate.id).status, 'needs_confirmation');
    assert.equal(memory.getClaim(memoryCandidatePromotionClaimId(candidate.id)), null);
    memory.close();
  }
});

test('dry-run reports deterministic actions without mutating candidate or canonical memory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-promotion-dry-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);

  const candidate = seedPromotedRelation(memory, {
    id: 'candidate-dry',
    evidenceId: 'e-dry',
    value: 'We use Postgres.',
    canonicalFact: 'The project uses Postgres.',
    relation: 'unrelated',
  });

  const before = memory.exportCanonical();
  const result = finalizePromotedMemoryCandidates({
    memory,
    projectId: 'project',
    branch: 'main',
    apply: false,
    now: () => '2026-10-01T02:00:00.000Z',
  });

  assert.equal(result.mode, 'dry-run');
  assert.equal(result.summary.promoted, 1);
  assert.equal(memory.getCandidate(candidate.id).status, 'pending');
  assert.deepEqual(memory.exportCanonical(), before);

  memory.close();
});
