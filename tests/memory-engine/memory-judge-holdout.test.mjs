import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IMPORTANCE_JUDGE_HOLDOUT_CASES,
  RELATION_JUDGE_HOLDOUT_CASES,
  scoreMemoryJudgeHoldout,
} from '../../memory-engine/memory-judge-holdout.mjs';
import {
  runMemoryJudgeHoldout,
  summarizeImportanceCaptureReachability,
} from '../../scripts/eval-codex-memory-judge-holdout.mjs';

test('holdout fixture contains 32 balanced bilingual adversarial cases', () => {
  assert.equal(IMPORTANCE_JUDGE_HOLDOUT_CASES.length, 16);
  assert.equal(RELATION_JUDGE_HOLDOUT_CASES.length, 16);

  const importanceByDecision = Object.fromEntries(
    ['promote', 'ignore', 'keep_candidate', 'needs_confirmation'].map((decision) => [
      decision,
      IMPORTANCE_JUDGE_HOLDOUT_CASES.filter(
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
    ['same', 'update', 'contradict', 'unrelated'].map((relation) => [
      relation,
      RELATION_JUDGE_HOLDOUT_CASES.filter(
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
    IMPORTANCE_JUDGE_HOLDOUT_CASES.filter(
      (item) => item.language === 'de',
    ).length >= 8,
  );
  assert.ok(
    RELATION_JUDGE_HOLDOUT_CASES.filter(
      (item) => item.language === 'de',
    ).length >= 7,
  );
  assert.ok(
    RELATION_JUDGE_HOLDOUT_CASES.every(
      (item) => item.memories.length >= 3,
    ),
  );

  const importanceTags = new Set(
    IMPORTANCE_JUDGE_HOLDOUT_CASES.flatMap((item) => item.tags),
  );
  for (const required of [
    'implicit_durable',
    'important_sounding',
    'reconstructible_from_repo',
    'partial_scope',
    'tentative',
    'negation',
    'expiry_bounded',
    'mixed_durable_transient',
    'colloquial',
    'sensitive_looking_non_secret',
    'scope_unclear',
  ]) {
    assert.ok(
      importanceTags.has(required),
      'missing importance coverage tag: ' + required,
    );
  }

  const relationTags = new Set(
    RELATION_JUDGE_HOLDOUT_CASES.flatMap((item) => item.tags),
  );
  for (const required of [
    'implicit_update',
    'same_value_different_scope',
    'same_scope_different_value',
    'scope_precision',
    'negation',
    'disjoint_time_scope',
    'multiple_targets',
    'semantic_neighbour',
    'contradicts_one',
    'indirect_supersession',
  ]) {
    assert.ok(
      relationTags.has(required),
      'missing relation coverage tag: ' + required,
    );
  }
});

test('holdout reports which importance cases are reachable through capture-v1', () => {
  const reachability = summarizeImportanceCaptureReachability();

  assert.equal(reachability.policy_version, 'capture-v1');
  assert.equal(reachability.total, 16);
  assert.equal(reachability.reachable, 1);
  assert.equal(reachability.judge_only, 15);
  assert.deepEqual(reachability.reachable_ids, [
    'holdout-importance-b2',
  ]);
});

test('perfect holdout predictions pass and expose exact metrics', () => {
  const importancePredictions = IMPORTANCE_JUDGE_HOLDOUT_CASES.map(
    (item) => ({
      id: item.id,
      ok: true,
      decision: item.expected.decision,
      confidence: 'high',
    }),
  );
  const relationPredictions = RELATION_JUDGE_HOLDOUT_CASES.map(
    (item) => ({
      id: item.id,
      ok: true,
      relation: item.expected.relation,
      target_ref: item.expected.target_ref,
      confidence: 'high',
    }),
  );

  const score = scoreMemoryJudgeHoldout({
    importancePredictions,
    relationPredictions,
  });

  assert.equal(score.fixture.total_cases, 32);
  assert.equal(score.importance.exact_accuracy, 1);
  assert.equal(score.relation.exact_accuracy, 1);
  assert.equal(score.relation.target_accuracy, 1);
  assert.equal(score.invalid_outputs, 0);
  assert.equal(score.case_failures.length, 0);
  assert.deepEqual(score.quality_gate, {
    pass: true,
    failures: [],
  });
});

test('holdout gate rejects high-confidence wrong importance decisions', () => {
  const importancePredictions = IMPORTANCE_JUDGE_HOLDOUT_CASES.map(
    (item) => ({
      id: item.id,
      ok: true,
      decision: item.expected.decision,
      confidence: 'high',
    }),
  );
  const relationPredictions = RELATION_JUDGE_HOLDOUT_CASES.map(
    (item) => ({
      id: item.id,
      ok: true,
      relation: item.expected.relation,
      target_ref: item.expected.target_ref,
      confidence: 'high',
    }),
  );

  const item = IMPORTANCE_JUDGE_HOLDOUT_CASES.find(
    (entry) => entry.expected.decision === 'keep_candidate',
  );
  const index = importancePredictions.findIndex(
    (entry) => entry.id === item.id,
  );
  importancePredictions[index] = {
    ...importancePredictions[index],
    decision: 'needs_confirmation',
  };

  const score = scoreMemoryJudgeHoldout({
    importancePredictions,
    relationPredictions,
  });

  assert.equal(score.importance.high_confidence_wrong, 1);
  assert.equal(score.quality_gate.pass, false);
  assert.ok(
    score.quality_gate.failures.includes(
      'importance_high_confidence_wrong',
    ),
  );
  assert.equal(score.case_failures[0].id, item.id);
});

test('holdout gate rejects false durable promotions and wrong relation targets', () => {
  const importancePredictions = IMPORTANCE_JUDGE_HOLDOUT_CASES.map(
    (item) => ({
      id: item.id,
      ok: true,
      decision: item.expected.decision,
      confidence: 'high',
    }),
  );
  const relationPredictions = RELATION_JUDGE_HOLDOUT_CASES.map(
    (item) => ({
      id: item.id,
      ok: true,
      relation: item.expected.relation,
      target_ref: item.expected.target_ref,
      confidence: 'high',
    }),
  );

  const negative = IMPORTANCE_JUDGE_HOLDOUT_CASES.find(
    (entry) => entry.expected.decision === 'ignore',
  );
  importancePredictions[importancePredictions.findIndex(
    (entry) => entry.id === negative.id,
  )] = {
    id: negative.id,
    ok: true,
    decision: 'promote',
    confidence: 'high',
  };

  const related = RELATION_JUDGE_HOLDOUT_CASES.find(
    (entry) => entry.expected.relation !== 'unrelated',
  );
  const distractor = related.memories.find(
    (item) => item.ref !== related.expected.target_ref,
  );
  relationPredictions[relationPredictions.findIndex(
    (entry) => entry.id === related.id,
  )] = {
    id: related.id,
    ok: true,
    relation: related.expected.relation,
    target_ref: distractor.ref,
    confidence: 'high',
  };

  const score = scoreMemoryJudgeHoldout({
    importancePredictions,
    relationPredictions,
  });

  assert.equal(score.importance.false_promotions, 1);
  assert.equal(score.relation.target_errors, 1);
  assert.equal(score.relation.high_confidence_wrong, 1);
  assert.equal(score.quality_gate.pass, false);
  assert.ok(
    score.quality_gate.failures.includes(
      'importance_false_promotions',
    ),
  );
  assert.ok(
    score.quality_gate.failures.includes(
      'relation_high_confidence_wrong',
    ),
  );
});

test('invalid or duplicate outputs are counted and fail closed', () => {
  const importancePredictions = IMPORTANCE_JUDGE_HOLDOUT_CASES.map(
    (item) => ({
      id: item.id,
      ok: true,
      decision: item.expected.decision,
      confidence: 'medium',
    }),
  );
  importancePredictions.push({ ...importancePredictions[0] });

  const relationPredictions = RELATION_JUDGE_HOLDOUT_CASES.map(
    (item) => ({
      id: item.id,
      ok: true,
      relation: item.expected.relation,
      target_ref: item.expected.target_ref,
      confidence: 'medium',
    }),
  );
  relationPredictions[0] = {
    id: RELATION_JUDGE_HOLDOUT_CASES[0].id,
    ok: true,
    relation: 'same',
    target_ref: '@not-a-ref',
    confidence: 'medium',
  };

  const score = scoreMemoryJudgeHoldout({
    importancePredictions,
    relationPredictions,
  });

  assert.equal(score.invalid_outputs, 2);
  assert.equal(score.quality_gate.pass, false);
  assert.ok(score.quality_gate.failures.includes('invalid_outputs'));
});

test('holdout runner accepts synchronous resource close methods', async () => {
  let closeCalls = 0;
  const importanceCases = [IMPORTANCE_JUDGE_HOLDOUT_CASES[0]];
  const relationCases = [RELATION_JUDGE_HOLDOUT_CASES[0]];

  const result = await runMemoryJudgeHoldout({
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
          reason: 'Synchronous close contract fixture.',
          risk_flags: [],
        });
      },
      close() {
        closeCalls += 1;
      },
    }),
    createRelationJudge: async () => ({
      async judge() {
        return JSON.stringify({
          relation: relationCases[0].expected.relation,
          target_ref: relationCases[0].expected.target_ref,
          confidence: 'high',
          meaning_preserved: true,
          reason: 'Synchronous close contract fixture.',
        });
      },
      close() {
        closeCalls += 1;
      },
    }),
  });

  assert.equal(result.score.quality_gate.pass, true);
  assert.equal(closeCalls, 2);
});

test('holdout runner never exposes expected labels or fixture metadata to judges', async () => {
  const importanceCases = [IMPORTANCE_JUDGE_HOLDOUT_CASES[0]];
  const relationCases = [RELATION_JUDGE_HOLDOUT_CASES[0]];
  let seenImportance = null;
  let seenRelationArgs = null;

  const result = await runMemoryJudgeHoldout({
    importanceCases,
    relationCases,
    createImportanceJudge: async () => ({
      isolation: { deterministicFixture: true },
      async judge(candidate) {
        seenImportance = candidate;
        return JSON.stringify({
          decision: 'promote',
          suggested_type: candidate.proposed_type,
          durability: 'long',
          future_utility: 'high',
          specificity: 'high',
          confidence: 'high',
          meaning_preserved: true,
          canonical_fact: candidate.proposed_value,
          reason: 'Deterministic holdout fixture.',
          risk_flags: [],
        });
      },
      async close() {},
    }),
    createRelationJudge: async () => ({
      isolation: { deterministicFixture: true },
      async judge(args) {
        seenRelationArgs = args;
        return JSON.stringify({
          relation: 'same',
          target_ref: relationCases[0].expected.target_ref,
          confidence: 'high',
          meaning_preserved: true,
          reason: 'Deterministic holdout fixture.',
        });
      },
      async close() {},
    }),
  });

  assert.deepEqual(
    Object.keys(seenImportance).sort(),
    [
      'policy_version',
      'proposed_type',
      'proposed_value',
      'source_authority',
    ],
  );
  assert.equal('id' in seenImportance, false);
  assert.equal('expected' in seenImportance, false);
  assert.equal('tags' in seenImportance, false);

  assert.deepEqual(Object.keys(seenRelationArgs), ['prompt']);
  assert.equal(seenRelationArgs.caseSpec, undefined);
  assert.equal(result.score.fixture.total_cases, 2);
  assert.equal(result.score.quality_gate.pass, true);
});
