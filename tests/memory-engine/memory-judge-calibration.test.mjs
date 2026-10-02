import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IMPORTANCE_JUDGE_CALIBRATION_CASES,
  RELATION_JUDGE_CALIBRATION_CASES,
  scoreMemoryJudgeCalibration,
} from '../../memory-engine/memory-judge-calibration.mjs';

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
