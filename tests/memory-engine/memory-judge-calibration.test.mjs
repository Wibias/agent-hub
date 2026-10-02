import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IMPORTANCE_JUDGE_CALIBRATION_CASES,
  RELATION_JUDGE_CALIBRATION_CASES,
  scoreMemoryJudgeCalibration,
} from '../../memory-engine/memory-judge-calibration.mjs';
import {
  runMemoryJudgeCalibration,
} from '../../scripts/eval-codex-memory-judges.mjs';

test('judge calibration fixture contains 32 balanced bilingual cases', () => {
  assert.equal(IMPORTANCE_JUDGE_CALIBRATION_CASES.length, 16);
  assert.equal(RELATION_JUDGE_CALIBRATION_CASES.length, 16);

  const importanceByDecision = Object.fromEntries(
    ['promote', 'ignore', 'keep_candidate', 'needs_confirmation']
      .map((decision) => [
        decision,
        IMPORTANCE_JUDGE_CALIBRATION_CASES.filter(
          (item) => item.expected.decision === decision,
        ).length,
      ]),
  );
  assert.deepEqual(importanceByDecision, {
    promote: 4,
    ignore: 4,
    keep_candidate: 4,
    needs_confirmation: 4,
  });

  const relationByClass = Object.fromEntries(
    ['same', 'update', 'contradict', 'unrelated']
      .map((relation) => [
        relation,
        RELATION_JUDGE_CALIBRATION_CASES.filter(
          (item) => item.expected.relation === relation,
        ).length,
      ]),
  );
  assert.deepEqual(relationByClass, {
    same: 4,
    update: 4,
    contradict: 4,
    unrelated: 4,
  });

  assert.ok(
    IMPORTANCE_JUDGE_CALIBRATION_CASES.filter(
      (item) => item.language === 'de',
    ).length >= 6,
  );
  assert.ok(
    RELATION_JUDGE_CALIBRATION_CASES.filter(
      (item) => item.language === 'de',
    ).length >= 6,
  );
  assert.ok(
    RELATION_JUDGE_CALIBRATION_CASES.every(
      (item) => item.memories.length >= 2,
    ),
    'relation cases must include distractors',
  );
});

test('judge calibration scorer is precision-first for durable promotion', () => {
  const importancePredictions = IMPORTANCE_JUDGE_CALIBRATION_CASES.map(
    (item) => ({
      id: item.id,
      ok: true,
      decision: item.expected.decision,
      confidence: item.expected.decision === 'promote' ? 'high' : 'medium',
    }),
  );

  const negative = IMPORTANCE_JUDGE_CALIBRATION_CASES.find(
    (item) => item.expected.decision !== 'promote',
  );
  const index = importancePredictions.findIndex(
    (item) => item.id === negative.id,
  );
  importancePredictions[index] = {
    ...importancePredictions[index],
    decision: 'promote',
    confidence: 'high',
  };

  const relationPredictions = RELATION_JUDGE_CALIBRATION_CASES.map(
    (item) => ({
      id: item.id,
      ok: true,
      relation: item.expected.relation,
      target_ref: item.expected.target_ref,
      confidence: 'high',
    }),
  );

  const scored = scoreMemoryJudgeCalibration({
    importancePredictions,
    relationPredictions,
  });

  assert.equal(scored.importance.false_promotions, 1);
  assert.equal(scored.importance.predicted_promotions, 5);
  assert.equal(scored.importance.true_promotions, 4);
  assert.equal(scored.importance.promote_precision, 0.8);
  assert.equal(scored.importance.promote_recall, 1);
  assert.equal(scored.quality_gate.pass, false);
  assert.ok(scored.quality_gate.failures.includes('importance_false_promotions'));
});

test('relation safety gate rejects a wrong high-confidence relation or target', () => {
  const importancePredictions = IMPORTANCE_JUDGE_CALIBRATION_CASES.map(
    (item) => ({
      id: item.id,
      ok: true,
      decision: item.expected.decision,
      confidence: 'high',
    }),
  );
  const relationPredictions = RELATION_JUDGE_CALIBRATION_CASES.map(
    (item) => ({
      id: item.id,
      ok: true,
      relation: item.expected.relation,
      target_ref: item.expected.target_ref,
      confidence: 'high',
    }),
  );

  const related = RELATION_JUDGE_CALIBRATION_CASES.find(
    (item) => item.expected.relation !== 'unrelated',
  );
  const index = relationPredictions.findIndex(
    (item) => item.id === related.id,
  );
  const distractor = related.memories.find(
    (memory) => memory.ref !== related.expected.target_ref,
  );
  relationPredictions[index] = {
    ...relationPredictions[index],
    target_ref: distractor.ref,
  };

  const scored = scoreMemoryJudgeCalibration({
    importancePredictions,
    relationPredictions,
  });

  assert.equal(scored.relation.high_confidence_wrong, 1);
  assert.equal(scored.relation.target_errors, 1);
  assert.equal(scored.quality_gate.pass, false);
  assert.ok(
    scored.quality_gate.failures.includes(
      'relation_high_confidence_wrong',
    ),
  );
});

test('perfect calibration predictions pass safety gates and expose exact metrics', () => {
  const importancePredictions = IMPORTANCE_JUDGE_CALIBRATION_CASES.map(
    (item) => ({
      id: item.id,
      ok: true,
      decision: item.expected.decision,
      confidence: 'high',
    }),
  );
  const relationPredictions = RELATION_JUDGE_CALIBRATION_CASES.map(
    (item) => ({
      id: item.id,
      ok: true,
      relation: item.expected.relation,
      target_ref: item.expected.target_ref,
      confidence: 'high',
    }),
  );

  const scored = scoreMemoryJudgeCalibration({
    importancePredictions,
    relationPredictions,
  });

  assert.equal(scored.importance.exact_accuracy, 1);
  assert.equal(scored.importance.promote_precision, 1);
  assert.equal(scored.importance.promote_recall, 1);
  assert.equal(scored.relation.exact_accuracy, 1);
  assert.equal(scored.relation.target_accuracy, 1);
  assert.equal(scored.relation.high_confidence_wrong, 0);
  assert.equal(scored.invalid_outputs, 0);
  assert.deepEqual(scored.quality_gate, {
    pass: true,
    failures: [],
  });
});

test('calibration runner uses judge parsers and scores deterministic provider outputs', async () => {
  let importanceCalls = 0;
  let relationCalls = 0;

  const result = await runMemoryJudgeCalibration({
    createImportanceJudge: async () => ({
      evaluatorId: 'fixture:importance-v1',
      isolation: { deterministicFixture: true },
      async judge(candidate) {
        importanceCalls += 1;
        const caseSpec = IMPORTANCE_JUDGE_CALIBRATION_CASES.find(
          (item) => item.id === candidate.calibration_id,
        );
        return JSON.stringify({
          decision: caseSpec.expected.decision,
          suggested_type: candidate.proposed_type,
          durability: caseSpec.expected.decision === 'promote' ? 'long' : 'medium',
          future_utility: caseSpec.expected.decision === 'promote' ? 'high' : 'medium',
          specificity: 'high',
          confidence: caseSpec.expected.decision === 'promote' ? 'high' : 'medium',
          meaning_preserved: true,
          canonical_fact: caseSpec.expected.decision === 'ignore'
            ? null
            : candidate.proposed_value,
          reason: 'Deterministic calibration fixture.',
          risk_flags: caseSpec.expected.decision === 'promote'
            ? []
            : ['tentative'],
        });
      },
      async close() {},
    }),
    createRelationJudge: async () => ({
      evaluatorId: 'fixture:relation-v1',
      isolation: { deterministicFixture: true },
      async judge({ caseSpec }) {
        relationCalls += 1;
        return JSON.stringify({
          relation: caseSpec.expected.relation,
          target_ref: caseSpec.expected.target_ref,
          confidence: 'high',
          meaning_preserved: true,
          reason: 'Deterministic calibration fixture.',
        });
      },
      async close() {},
    }),
  });

  assert.equal(importanceCalls, 16);
  assert.equal(relationCalls, 16);
  assert.equal(result.score.fixture.total_cases, 32);
  assert.equal(result.score.importance.exact_accuracy, 1);
  assert.equal(result.score.relation.exact_accuracy, 1);
  assert.equal(result.score.quality_gate.pass, true);
  assert.equal(result.importance_predictions.length, 16);
  assert.equal(result.relation_predictions.length, 16);
});


test('calibration runner scores injected case subsets against that subset only', async () => {
  const importanceCases = [IMPORTANCE_JUDGE_CALIBRATION_CASES[0]];
  const relationCases = [RELATION_JUDGE_CALIBRATION_CASES[0]];

  const result = await runMemoryJudgeCalibration({
    importanceCases,
    relationCases,
    createImportanceJudge: async () => ({
      async judge(candidate) {
        return JSON.stringify({
          decision: 'promote',
          suggested_type: candidate.proposed_type,
          durability: 'long',
          future_utility: 'high',
          specificity: 'high',
          confidence: 'high',
          meaning_preserved: true,
          canonical_fact: candidate.proposed_value,
          reason: 'Subset fixture.',
          risk_flags: [],
        });
      },
      async close() {},
    }),
    createRelationJudge: async () => ({
      async judge({ caseSpec }) {
        return JSON.stringify({
          relation: caseSpec.expected.relation,
          target_ref: caseSpec.expected.target_ref,
          confidence: 'high',
          meaning_preserved: true,
          reason: 'Subset fixture.',
        });
      },
      async close() {},
    }),
  });

  assert.deepEqual(result.score.fixture, {
    importance_cases: 1,
    relation_cases: 1,
    total_cases: 2,
  });
  assert.equal(result.score.invalid_outputs, 0);
  assert.equal(result.score.importance.exact_accuracy, 1);
  assert.equal(result.score.relation.exact_accuracy, 1);
  assert.equal(result.score.quality_gate.pass, true);
});
