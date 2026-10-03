import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  memoryRelationClaimRef,
} from '../../memory-engine/memory-candidate-relation.mjs';

function createMemory(path) {
  const memory = new MemoryEngine({ dbPath: path });
  memory.registerProject({
    projectId: 'project',
    repoIdentity: 'project',
    createdAt: '2026-10-03T00:00:00.000Z',
  });
  return memory;
}

function agentEvidence(memory, {
  id,
  value,
  at = '2026-10-03T01:00:00.000Z',
} = {}) {
  return memory.recordEvidence({
    id,
    projectId: 'project',
    harness: 'codex',
    sessionId: 'session',
    sourceKind: 'assistant',
    sourceRef: 'codex:stop:turn-1',
    capturedAt: at,
    branch: 'main',
    content: value,
    authorityClass: 'agent_inference',
    metadata: {
      event_type: 'assistant_stop',
      agent_type: 'root',
    },
  });
}

function seedAgentCandidate(memory, {
  id,
  evidenceId,
  value,
  fingerprint,
} = {}) {
  const evidence = agentEvidence(memory, {
    id: evidenceId,
    value,
  });
  return memory.recordAgentCandidate({
    id,
    evidenceId: evidence.id,
    proposedValue: evidence.content_redacted,
    decisionReason: 'rule:agent_decision:explicit_commitment',
    policyVersion: 'agent-capture-v1',
    fingerprint,
    createdAt: '2026-10-03T01:00:00.000Z',
  });
}

function promoteImportance(memory, candidate) {
  memory.evaluateAgentCandidate({
    candidateId: candidate.id,
    evaluatorId: 'codex:test:agent-importance-v1',
    evaluatedAt: '2026-10-03T01:01:00.000Z',
    evaluation: {
      decision: 'promote',
      suggested_type: 'decision',
      durability: 'long',
      future_utility: 'high',
      specificity: 'high',
      confidence: 'high',
      meaning_preserved: true,
      canonical_fact: candidate.proposed_value,
      reason: 'Explicit durable agent decision.',
      risk_flags: [],
    },
  });
}

function evaluateRelation(memory, candidate, {
  relation,
  target = null,
  confidence = 'high',
} = {}) {
  memory.evaluateAgentCandidateRelation({
    candidateId: candidate.id,
    evaluatorId: 'codex:test:agent-relation-v1',
    policyVersion: 'agent-relation-v1',
    relation: {
      relation,
      target_ref: target ? memoryRelationClaimRef(target.id) : null,
      confidence,
      meaning_preserved: true,
      reason: 'Fixture relation.',
    },
    relatedClaimId: target?.id ?? null,
    evaluatedAt: '2026-10-03T01:02:00.000Z',
  });
}

function finalize(memory, candidate, claimId) {
  return memory.finalizeAgentCandidatePromotion({
    candidateId: candidate.id,
    claimId,
    policyVersion: 'agent-promotion-v1',
    finalizedAt: '2026-10-03T01:03:00.000Z',
  });
}

test('user and agent candidate queues are authority-separated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-decision-queues-'));
  const memory = createMemory(join(root, 'memory.sqlite3'));

  const candidate = seedAgentCandidate(memory, {
    id: 'agent-candidate',
    evidenceId: 'agent-evidence',
    value: 'Decision: use Postgres for concurrent writers.',
    fingerprint: 'a'.repeat(64),
  });

  assert.deepEqual(memory.listUnevaluatedCandidates({
    projectId: 'project',
    branch: 'main',
  }), []);
  assert.deepEqual(
    memory.listUnevaluatedAgentCandidates({
      projectId: 'project',
      branch: 'main',
    }).map((item) => item.id),
    [candidate.id],
  );

  memory.close();
});

test('agent decision can auto-promote as agent_inference without becoming user authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-decision-promote-'));
  const memory = createMemory(join(root, 'memory.sqlite3'));

  const candidate = seedAgentCandidate(memory, {
    id: 'agent-candidate',
    evidenceId: 'agent-evidence',
    value: 'Decision: use Postgres for concurrent writers.',
    fingerprint: 'b'.repeat(64),
  });
  promoteImportance(memory, candidate);
  evaluateRelation(memory, candidate, { relation: 'unrelated' });

  const result = finalize(memory, candidate, 'agent-claim-1');
  assert.equal(result.status, 'promoted');

  const claim = memory.getClaim('agent-claim-1');
  assert.equal(claim.kind, 'agent_inference');
  assert.equal(claim.subject, 'agent decision');
  assert.equal(claim.predicate, 'states');
  assert.equal(claim.state, 'active');
  assert.equal(
    memory.getEvidence(claim.created_from_evidence_id).authority_class,
    'agent_inference',
  );

  memory.close();
});

test('newer agent decision can auto-supersede an older agent decision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-decision-update-'));
  const memory = createMemory(join(root, 'memory.sqlite3'));

  const first = seedAgentCandidate(memory, {
    id: 'agent-old',
    evidenceId: 'e-old',
    value: 'Decision: use SQLite for the local queue.',
    fingerprint: 'c'.repeat(64),
  });
  promoteImportance(memory, first);
  evaluateRelation(memory, first, { relation: 'unrelated' });
  finalize(memory, first, 'agent-claim-old');

  const second = seedAgentCandidate(memory, {
    id: 'agent-new',
    evidenceId: 'e-new',
    value: 'Decision: switch the local queue from SQLite to Postgres.',
    fingerprint: 'd'.repeat(64),
  });
  promoteImportance(memory, second);
  const oldClaim = memory.getClaim('agent-claim-old');
  evaluateRelation(memory, second, {
    relation: 'update',
    target: oldClaim,
  });
  const result = finalize(memory, second, 'agent-claim-new');

  assert.equal(result.status, 'promoted');
  assert.equal(memory.getClaim('agent-claim-new').state, 'active');
  assert.equal(memory.getClaim('agent-claim-old').state, 'superseded');
  assert.equal(
    memory.getClaim('agent-claim-old').superseded_by_claim_id,
    'agent-claim-new',
  );

  memory.close();
});

test('agent decision never silently supersedes an active direct-user memory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-decision-user-guard-'));
  const memory = createMemory(join(root, 'memory.sqlite3'));

  memory.ingest({
    evidence: {
      id: 'user-evidence',
      projectId: 'project',
      harness: 'codex',
      sessionId: 'user',
      sourceKind: 'session',
      sourceRef: 'session:user',
      capturedAt: '2026-10-03T00:30:00.000Z',
      branch: 'main',
      content: 'memory: database is SQLite',
      authorityClass: 'user_direct',
      metadata: { explicit_memory: true },
    },
    claim: {
      id: 'user-claim',
      kind: 'user_direct',
      subject: 'user memory',
      predicate: 'states',
      value: 'memory: database is SQLite',
      branchScope: 'main',
      createdAt: '2026-10-03T00:30:00.000Z',
    },
  });

  const candidate = seedAgentCandidate(memory, {
    id: 'agent-new',
    evidenceId: 'agent-new-evidence',
    value: 'Decision: switch the database from SQLite to Postgres.',
    fingerprint: 'e'.repeat(64),
  });
  promoteImportance(memory, candidate);
  evaluateRelation(memory, candidate, {
    relation: 'update',
    target: memory.getClaim('user-claim'),
  });

  const result = finalize(memory, candidate, 'agent-claim-new');
  assert.equal(result.status, 'needs_confirmation');
  assert.equal(memory.getCandidate(candidate.id).status, 'needs_confirmation');
  assert.equal(memory.getClaim('user-claim').state, 'active');
  assert.equal(memory.getClaim('agent-claim-new'), null);

  memory.close();
});

test('plain contradiction between agent decisions requires confirmation rather than self-authorizing conflict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-decision-conflict-'));
  const memory = createMemory(join(root, 'memory.sqlite3'));

  const first = seedAgentCandidate(memory, {
    id: 'agent-old',
    evidenceId: 'e-old',
    value: 'Decision: use SQLite.',
    fingerprint: 'f'.repeat(64),
  });
  promoteImportance(memory, first);
  evaluateRelation(memory, first, { relation: 'unrelated' });
  finalize(memory, first, 'agent-claim-old');

  const second = seedAgentCandidate(memory, {
    id: 'agent-new',
    evidenceId: 'e-new',
    value: 'Decision: use Postgres.',
    fingerprint: '1'.repeat(64),
  });
  promoteImportance(memory, second);
  evaluateRelation(memory, second, {
    relation: 'contradict',
    target: memory.getClaim('agent-claim-old'),
  });

  const result = finalize(memory, second, 'agent-claim-new');
  assert.equal(result.status, 'needs_confirmation');
  assert.equal(memory.getClaim('agent-claim-old').state, 'active');
  assert.equal(memory.getClaim('agent-claim-new'), null);

  memory.close();
});
