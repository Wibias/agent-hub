import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PIPELINE_IMPORTANCE_HOLDOUT_CASES,
  PIPELINE_RELATION_HOLDOUT_CASES,
} from '../../memory-engine/memory-judge-pipeline-holdout.mjs';
import {
  runMemoryJudgePipelineHoldout,
  summarizePipelineCaptureReachability,
} from '../../scripts/eval-codex-memory-judge-pipeline-holdout.mjs';

test('pipeline holdout contains balanced bilingual unseen cases', () => {
  assert.equal(PIPELINE_IMPORTANCE_HOLDOUT_CASES.length, 16);
  assert.equal(PIPELINE_RELATION_HOLDOUT_CASES.length, 16);

  const importanceByDecision = Object.fromEntries(
    ['promote', 'ignore', 'keep_candidate', 'needs_confirmation'].map(
      (decision) => [
        decision,
        PIPELINE_IMPORTANCE_HOLDOUT_CASES.filter(
          (item) => item.expected.decision === decision,
        ).length,
      ],
    ),
  );
  assert.deepEqual(importanceByDecision, {
    promote: 4,
    ignore: 4,
    keep_candidate: 4,
    needs_confirmation: 4,
  });

  const relationByClass = Object.fromEntries(
    ['same', 'update', 'contradict', 'unrelated'].map(
      (relation) => [
        relation,
        PIPELINE_RELATION_HOLDOUT_CASES.filter(
          (item) => item.expected.relation === relation,
        ).length,
      ],
    ),
  );
  assert.deepEqual(relationByClass, {
    same: 4,
    update: 4,
    contradict: 4,
    unrelated: 4,
  });

  assert.ok(
    PIPELINE_IMPORTANCE_HOLDOUT_CASES.filter(
      (item) => item.language === 'de',
    ).length >= 7,
  );
  assert.ok(
    PIPELINE_RELATION_HOLDOUT_CASES.filter(
      (item) => item.language === 'de',
    ).length >= 7,
  );
  assert.ok(
    PIPELINE_RELATION_HOLDOUT_CASES.every(
      (item) => item.memories.length >= 3,
    ),
  );
});

test('every pipeline holdout case is reachable through capture-v1 with the expected type', () => {
  const importance = summarizePipelineCaptureReachability(
    PIPELINE_IMPORTANCE_HOLDOUT_CASES,
  );
  const relation = summarizePipelineCaptureReachability(
    PIPELINE_RELATION_HOLDOUT_CASES,
  );

  assert.equal(importance.policy_version, 'capture-v1');
  assert.equal(importance.total, 16);
  assert.equal(importance.reachable, 16);
  assert.equal(importance.type_matches, 16);
  assert.deepEqual(importance.failures, []);

  assert.equal(relation.policy_version, 'capture-v1');
  assert.equal(relation.total, 16);
  assert.equal(relation.reachable, 16);
  assert.equal(relation.type_matches, 16);
  assert.deepEqual(relation.failures, []);
});

test('pipeline reachability gate detects distribution drift before model scoring', () => {
  const summary = summarizePipelineCaptureReachability([
    {
      id: 'unreachable',
      candidate: {
        proposed_type: 'decision',
        proposed_value: 'Maybe we should use Redis.',
      },
    },
    {
      id: 'wrong-type',
      candidate: {
        proposed_type: 'constraint',
        proposed_value: 'We decided to use Postgres.',
      },
    },
  ]);

  assert.equal(summary.total, 2);
  assert.equal(summary.reachable, 1);
  assert.equal(summary.type_matches, 0);
  assert.deepEqual(
    summary.failures.map((item) => item.id),
    ['unreachable', 'wrong-type'],
  );
});

test('pipeline holdout runner uses production parsers and passes deterministic expected judgments', async () => {
  let importanceCalls = 0;
  let relationCalls = 0;

  const result = await runMemoryJudgePipelineHoldout({
    createImportanceJudge: async () => ({
      isolation: { deterministicFixture: true },
      async judge(candidate) {
        importanceCalls += 1;
        const caseSpec = PIPELINE_IMPORTANCE_HOLDOUT_CASES.find(
          (item) => item.candidate.proposed_value === candidate.proposed_value,
        );
        assert.ok(caseSpec, candidate.proposed_value);

        const decision = caseSpec.expected.decision;
        if (decision === 'promote') {
          return {
            decision,
            suggested_type: candidate.proposed_type,
            durability: 'long',
            future_utility: 'high',
            specificity: 'high',
            confidence: 'high',
            meaning_preserved: true,
            canonical_fact: candidate.proposed_value,
            reason: 'Deterministic pipeline holdout fixture.',
            risk_flags: [],
          };
        }
        if (decision === 'ignore') {
          return {
            decision,
            suggested_type: candidate.proposed_type,
            durability: 'short',
            future_utility: 'low',
            specificity: 'high',
            confidence: 'high',
            meaning_preserved: true,
            canonical_fact: null,
            reason: 'Deterministic pipeline holdout fixture.',
            risk_flags: ['transient'],
          };
        }
        if (decision === 'keep_candidate') {
          return {
            decision,
            suggested_type: candidate.proposed_type,
            durability: 'medium',
            future_utility: 'medium',
            specificity: 'high',
            confidence: 'high',
            meaning_preserved: true,
            canonical_fact: candidate.proposed_value,
            reason: 'Deterministic pipeline holdout fixture.',
            risk_flags: ['transient'],
          };
        }
        return {
          decision,
          suggested_type: candidate.proposed_type,
          durability: 'long',
          future_utility: 'medium',
          specificity: 'low',
          confidence: 'medium',
          meaning_preserved: true,
          canonical_fact: null,
          reason: 'Deterministic pipeline holdout fixture.',
          risk_flags: ['scope_unclear'],
        };
      },
      close() {},
    }),
    createRelationJudge: async () => ({
      isolation: { deterministicFixture: true },
      async judge({ prompt }) {
        relationCalls += 1;
        const caseSpec = PIPELINE_RELATION_HOLDOUT_CASES.find(
          (item) => prompt.includes(item.candidate.proposed_value),
        );
        assert.ok(caseSpec, prompt);
        return {
          relation: caseSpec.expected.relation,
          target_ref: caseSpec.expected.target_ref,
          confidence: 'high',
          meaning_preserved: true,
          reason: 'Deterministic pipeline holdout fixture.',
        };
      },
      close() {},
    }),
  });

  assert.equal(result.suite, 'pipeline-holdout-v2');
  assert.equal(importanceCalls, 16);
  assert.equal(relationCalls, 16);
  assert.equal(result.score.importance.exact_accuracy, 1);
  assert.equal(result.score.relation.exact_accuracy, 1);
  assert.equal(result.score.relation.target_accuracy, 1);
  assert.equal(result.score.invalid_outputs, 0);
  assert.equal(result.score.quality_gate.pass, true);
  assert.equal(result.pipeline_gate.judge_quality_pass, true);
  assert.equal(result.pipeline_gate.capture_reachability_pass, true);
  assert.equal(result.pipeline_gate.pass, true);
});
