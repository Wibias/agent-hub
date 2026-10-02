import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MEMORY_CANDIDATE_CONFIRMATION_BEHAVIORAL_CASES,
  runMemoryCandidateConfirmationBehavioralCases,
  scoreMemoryCandidateConfirmationBehavioralCase,
} from '../../memory-engine/memory-candidate-confirmation-behavioral-eval.mjs';
import {
  runDeterministicMemoryCandidateConfirmationCase,
} from '../../scripts/eval-memory-candidate-confirmation.mjs';

test('candidate confirmation behavioral fixture covers all explicit relations and scope guards', () => {
  assert.deepEqual(
    MEMORY_CANDIDATE_CONFIRMATION_BEHAVIORAL_CASES.map((item) => ({
      id: item.id,
      relation: item.confirmation?.relation ?? null,
      expectApplied: item.expected.confirmation_applied,
      expectCandidateStatus: item.expected.candidate_status,
    })),
    [
      {
        id: 'confirm-unrelated',
        relation: 'unrelated',
        expectApplied: true,
        expectCandidateStatus: 'promoted',
      },
      {
        id: 'confirm-same',
        relation: 'same',
        expectApplied: true,
        expectCandidateStatus: 'superseded',
      },
      {
        id: 'confirm-update',
        relation: 'update',
        expectApplied: true,
        expectCandidateStatus: 'promoted',
      },
      {
        id: 'confirm-contradict',
        relation: 'contradict',
        expectApplied: true,
        expectCandidateStatus: 'promoted',
      },
      {
        id: 'unknown-candidate-ref',
        relation: 'unrelated',
        expectApplied: false,
        expectCandidateStatus: 'needs_confirmation',
      },
      {
        id: 'cross-branch-target',
        relation: 'update',
        expectApplied: false,
        expectCandidateStatus: 'needs_confirmation',
      },
    ],
  );
});

test('successful confirmation cases require exactly-once lifecycle effects and no automatic work afterwards', () => {
  for (const caseSpec of MEMORY_CANDIDATE_CONFIRMATION_BEHAVIORAL_CASES) {
    if (!caseSpec.expected.confirmation_applied) continue;

    assert.equal(caseSpec.expected.confirmation_evidence_count_delta, 1);
    assert.equal(caseSpec.expected.confirmation_audit_count, 1);
    assert.equal(caseSpec.expected.same_retry_changed_state, false);
    assert.deepEqual(caseSpec.expected.final_pipeline_ready, {
      importance: 0,
      relation: 0,
      promotion: 0,
    });
    assert.equal(caseSpec.expected.confirmation_model_calls, 0);
  }
});

test('confirmation behavioral scorer rejects silent lifecycle or scope mutation', () => {
  const caseSpec = MEMORY_CANDIDATE_CONFIRMATION_BEHAVIORAL_CASES.find(
    (item) => item.id === 'confirm-update',
  );
  assert.ok(caseSpec);

  assert.deepEqual(
    scoreMemoryCandidateConfirmationBehavioralCase(
      caseSpec,
      caseSpec.expected,
    ),
    { pass: true, failures: [] },
  );

  const bad = scoreMemoryCandidateConfirmationBehavioralCase(caseSpec, {
    ...caseSpec.expected,
    current_active_claims: 2,
    current_superseded_claims: 0,
    other_active_claims: 1,
  });
  assert.equal(bad.pass, false);
  assert.ok(bad.failures.some((item) => /current_active_claims/i.test(item)));
  assert.ok(bad.failures.some((item) => /current_superseded_claims/i.test(item)));
  assert.ok(bad.failures.some((item) => /other_active_claims/i.test(item)));
});

test('confirmation behavioral runner scores every case independently', async () => {
  const result = await runMemoryCandidateConfirmationBehavioralCases({
    cases: MEMORY_CANDIDATE_CONFIRMATION_BEHAVIORAL_CASES,
    runCase: async (caseSpec) => caseSpec.expected,
  });

  assert.equal(result.pass, true);
  assert.equal(result.totalCases, 6);
  assert.equal(result.passedCases, 6);
  assert.equal(result.failedCases, 0);
});

test('deterministic runner drives real candidate pipeline, listing, confirmation commands, and scope guards', async () => {
  const result = await runMemoryCandidateConfirmationBehavioralCases({
    cases: MEMORY_CANDIDATE_CONFIRMATION_BEHAVIORAL_CASES,
    runCase: runDeterministicMemoryCandidateConfirmationCase,
  });

  assert.equal(
    result.pass,
    true,
    JSON.stringify(result, null, 2),
  );
  assert.equal(result.totalCases, 6);
  assert.equal(result.passedCases, 6);
  assert.equal(result.failedCases, 0);
});
