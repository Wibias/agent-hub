import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  CANDIDATE_REJECTION_POLICY_VERSION,
  rejectMemoryCandidate,
} from '../../memory-engine/memory-candidate-rejection.mjs';
import {
  CAPTURE_POLICY_VERSION,
  memoryCandidateFingerprint,
} from '../../memory-engine/memory-capture-policy.mjs';
import {
  parseExplicitMemoryPrompt,
} from '../../memory-engine/adapters/codex-hooks.mjs';

function createProject(memory) {
  memory.registerProject({
    projectId: 'project',
    repoIdentity: 'project',
    createdAt: '2026-10-03T00:00:00.000Z',
  });
}

function seedCandidate(memory, {
  id = 'candidate-review',
  value = 'We keep signed build artifacts until audit completion.',
} = {}) {
  const evidence = memory.recordEvidence({
    id: 'e-' + id,
    projectId: 'project',
    harness: 'codex',
    sessionId: 'candidate',
    sourceKind: 'session',
    sourceRef: 'session:candidate',
    capturedAt: '2026-10-03T01:00:00.000Z',
    branch: 'main',
    content: value,
    authorityClass: 'user_direct',
    metadata: {
      event_type: 'user_prompt',
      candidate_capture: true,
    },
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
    createdAt: '2026-10-03T01:00:00.000Z',
  });
}

function makeReviewable(memory, candidate) {
  memory.evaluateCandidate({
    candidateId: candidate.id,
    evaluatorId: 'codex:test:importance-v2',
    evaluatedAt: '2026-10-03T01:01:00.000Z',
    evaluation: {
      decision: 'needs_confirmation',
      suggested_type: 'decision',
      durability: 'medium',
      future_utility: 'medium',
      specificity: 'high',
      confidence: 'medium',
      meaning_preserved: true,
      canonical_fact: null,
      reason: 'User review required.',
      risk_flags: ['scope_unclear'],
    },
  });
  return memory.getCandidate(candidate.id);
}

function rejectionEvidence(memory, candidateRef = '~fixture') {
  return memory.recordEvidence({
    id: 'e-reject',
    projectId: 'project',
    harness: 'codex',
    sessionId: 'reject',
    sourceKind: 'session',
    sourceRef: 'session:reject',
    capturedAt: '2026-10-03T02:00:00.000Z',
    branch: 'main',
    content: 'memory candidate reject: ' + candidateRef,
    authorityClass: 'user_direct',
    metadata: {
      event_type: 'user_prompt',
      explicit_memory: true,
      explicit_memory_mode: 'candidate_reject',
    },
  });
}

test('candidate reject command parses strict stable refs', () => {
  assert.deepEqual(
    parseExplicitMemoryPrompt('memory candidate reject: ~ABCDEF0123'),
    {
      mode: 'candidate_reject',
      candidateRef: '~abcdef0123',
    },
  );
  assert.equal(
    parseExplicitMemoryPrompt('memory candidate reject: candidate-review'),
    null,
  );
});

test('direct user rejection closes a reviewable candidate as ignored with audit evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-candidate-reject-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });

  try {
    createProject(memory);
    const candidate = makeReviewable(memory, seedCandidate(memory));
    const evidence = rejectionEvidence(memory);

    const result = rejectMemoryCandidate({
      memory,
      projectId: 'project',
      branch: 'main',
      candidateId: candidate.id,
      rejectionEvidenceId: evidence.id,
      now: () => '2026-10-03T02:00:00.000Z',
    });

    assert.equal(result.policyVersion, CANDIDATE_REJECTION_POLICY_VERSION);
    assert.equal(result.status, 'ignored');
    assert.equal(memory.getCandidate(candidate.id).status, 'ignored');

    const audit = memory.getCandidateRejection(candidate.id);
    assert.equal(audit.rejection_evidence_id, evidence.id);
    assert.equal(audit.policy_version, CANDIDATE_REJECTION_POLICY_VERSION);
    assert.equal(audit.status, 'ignored');
  } finally {
    memory.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('candidate rejection fails closed for non-reviewable state and non-user evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-candidate-reject-guard-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });

  try {
    createProject(memory);
    const pending = seedCandidate(memory);

    const evidence = rejectionEvidence(memory);
    assert.throws(
      () => rejectMemoryCandidate({
        memory,
        projectId: 'project',
        branch: 'main',
        candidateId: pending.id,
        rejectionEvidenceId: evidence.id,
      }),
      /not rejectable/i,
    );

    const reviewable = makeReviewable(memory, pending);
    const badEvidence = memory.recordEvidence({
      id: 'e-bad-reject',
      projectId: 'project',
      harness: 'codex',
      sessionId: 'agent',
      sourceKind: 'assistant',
      sourceRef: 'codex:assistant:turn',
      capturedAt: '2026-10-03T02:10:00.000Z',
      branch: 'main',
      content: 'reject it',
      authorityClass: 'agent_inference',
      metadata: {
        event_type: 'assistant_stop',
        explicit_memory_mode: 'candidate_reject',
      },
    });

    assert.throws(
      () => rejectMemoryCandidate({
        memory,
        projectId: 'project',
        branch: 'main',
        candidateId: reviewable.id,
        rejectionEvidenceId: badEvidence.id,
      }),
      /direct-user rejection evidence/i,
    );
    assert.equal(memory.getCandidate(reviewable.id).status, 'needs_confirmation');
  } finally {
    memory.close();
    await rm(root, { recursive: true, force: true });
  }
});
