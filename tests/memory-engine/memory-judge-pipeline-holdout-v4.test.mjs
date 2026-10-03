import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PIPELINE_IMPORTANCE_HOLDOUT_V4_CASES,
  PIPELINE_RELATION_HOLDOUT_V4_CASES,
} from '../../memory-engine/memory-judge-pipeline-holdout-v4.mjs';
import {
  summarizePipelineCaptureReachability,
} from '../../scripts/eval-codex-memory-judge-pipeline-holdout.mjs';
import {
  runMemoryJudgePipelineHoldoutV4,
} from '../../scripts/eval-codex-memory-judge-pipeline-holdout-v4.mjs';

test('pipeline holdout v4 contains fresh balanced bilingual cases', () => {
  assert.equal(PIPELINE_IMPORTANCE_HOLDOUT_V4_CASES.length, 16);
  assert.equal(PIPELINE_RELATION_HOLDOUT_V4_CASES.length, 16);

  const importanceByDecision = Object.fromEntries(
    ['promote', 'ignore', 'keep_candidate', 'needs_confirmation'].map(
      (decision) => [
        decision,
        PIPELINE_IMPORTANCE_HOLDOUT_V4_CASES.filter(
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
        PIPELINE_RELATION_HOLDOUT_V4_CASES.filter(
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
    PIPELINE_IMPORTANCE_HOLDOUT_V4_CASES.filter(
      (item) => item.language === 'de',
    ).length >= 7,
  );
  assert.ok(
    PIPELINE_RELATION_HOLDOUT_V4_CASES.filter(
      (item) => item.language === 'de',
    ).length >= 7,
  );
  assert.ok(
    PIPELINE_RELATION_HOLDOUT_V4_CASES.every(
      (item) => item.memories.length >= 3,
    ),
  );

  const keepTags = new Set(
    PIPELINE_IMPORTANCE_HOLDOUT_V4_CASES
      .filter((item) => item.expected.decision === 'keep_candidate')
      .flatMap((item) => item.tags),
  );
  assert.ok(keepTags.has('multi_session'));
  assert.ok(
    keepTags.has('named_milestone') || keepTags.has('bounded_window'),
  );
});

test('all v4 cases are production-reachable through capture-v1 with expected types', () => {
  const importance = summarizePipelineCaptureReachability(
    PIPELINE_IMPORTANCE_HOLDOUT_V4_CASES,
  );
  const relation = summarizePipelineCaptureReachability(
    PIPELINE_RELATION_HOLDOUT_V4_CASES,
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

test('v4 promote fixtures are not explicitly bounded by expiry or milestone language', () => {
  const promoteCases = PIPELINE_IMPORTANCE_HOLDOUT_V4_CASES.filter(
    (item) => item.expected.decision === 'promote',
  );

  for (const item of promoteCases) {
    assert.equal(
      /until|throughout|next month|release cycle|bis zum|während|heute|today/iu.test(
        item.candidate.proposed_value,
      ),
      false,
      item.id,
    );
  }
});

test('v4 keep candidates are explicit bounded multi-session statements, not tentative prompts', () => {
  const keepCases = PIPELINE_IMPORTANCE_HOLDOUT_V4_CASES.filter(
    (item) => item.expected.decision === 'keep_candidate',
  );

  for (const item of keepCases) {
    assert.match(
      item.candidate.proposed_value,
      /until|throughout|bis zum|während/iu,
      item.id,
    );
    assert.equal(
      /maybe|perhaps|possibly|vielleicht|eventuell/iu.test(
        item.candidate.proposed_value,
      ),
      false,
      item.id,
    );
  }
});

test('pipeline holdout v4 runner passes deterministic expected judgments through production parsers', async () => {
  let importanceCalls = 0;
  let relationCalls = 0;

  const result = await runMemoryJudgePipelineHoldoutV4({
    createImportanceJudge: async () => ({
      isolation: { deterministicFixture: true },
      async judge(candidate) {
        importanceCalls += 1;
        const caseSpec = PIPELINE_IMPORTANCE_HOLDOUT_V4_CASES.find(
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
            reason: 'Deterministic fresh holdout fixture.',
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
            reason: 'Deterministic fresh holdout fixture.',
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
            reason: 'Deterministic fresh holdout fixture.',
            risk_flags: ['transient'],
          };
        }
        return {
          decision,
          suggested_type: candidate.proposed_type,
          durability: 'medium',
          future_utility: 'medium',
          specificity: 'low',
          confidence: 'medium',
          meaning_preserved: true,
          canonical_fact: null,
          reason: 'Deterministic fresh holdout fixture.',
          risk_flags: ['ambiguous', 'scope_unclear'],
        };
      },
      close() {},
    }),
    createRelationJudge: async () => ({
      isolation: { deterministicFixture: true },
      async judge({ prompt }) {
        relationCalls += 1;
        const caseSpec = PIPELINE_RELATION_HOLDOUT_V4_CASES.find(
          (item) => prompt.includes(item.candidate.proposed_value),
        );
        assert.ok(caseSpec, prompt);
        return {
          relation: caseSpec.expected.relation,
          target_ref: caseSpec.expected.target_ref,
          confidence: 'high',
          meaning_preserved: true,
          reason: 'Deterministic fresh holdout fixture.',
        };
      },
      close() {},
    }),
  });

  assert.equal(result.suite, 'pipeline-holdout-v4');
  assert.equal(result.policy_versions.importance, 'importance-v2');
  assert.equal(result.policy_versions.relation, 'relation-v1');
  assert.equal(importanceCalls, 16);
  assert.equal(relationCalls, 16);
  assert.equal(result.capture_reachability.importance.reachable, 16);
  assert.equal(result.capture_reachability.relation.reachable, 16);
  assert.equal(result.score.importance.exact_accuracy, 1);
  assert.equal(result.score.relation.exact_accuracy, 1);
  assert.equal(result.score.relation.target_accuracy, 1);
  assert.equal(result.score.invalid_outputs, 0);
  assert.equal(result.pipeline_gate.capture_reachability_pass, true);
  assert.equal(result.pipeline_gate.judge_quality_pass, true);
  assert.equal(result.pipeline_gate.pass, true);
});
