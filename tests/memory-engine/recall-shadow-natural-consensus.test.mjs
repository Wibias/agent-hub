import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateNaturalConsensusRecords } from '../../scripts/eval-recall-shadow-natural-consensus.mjs';

function record({ highs = [0.90], judge = [0], ranks = true, votes = 3 } = {}) {
  const candidates = highs.map((similarity, index) => ({
    candidate_key: 'k' + index,
    similarity,
    semantic_rank: ranks ? index + 1 : null,
    lexical_rank: ranks ? index + 1 : null,
    final_rank: ranks ? index + 1 : null,
    rrf_score: null,
    budget_retained: true,
    signal_votes: index === 0 ? votes : 0,
  }));
  return {
    source: 'exact_runtime', local_route: 'fast_v1', local_selected_keys: candidates.filter((candidate) => candidate.similarity >= 0.85).map((candidate) => candidate.candidate_key),
    judge_selected_keys: judge.map((index) => 'k' + index),
    diagnostics: {
      schema_version: 1,
      thresholds: { negative_threshold: 0.83, positive_threshold: 0.85, support_threshold: 0.86, single_margin_threshold: 0.03, lexical_k: 1, fused_k: 1, min_votes: 3 },
      candidates,
      top_margin: candidates.length >= 2 ? candidates[0].similarity - candidates[1].similarity : null,
    },
  };
}

test('experimental gates keep single-candidate positives out of non-trivial consensus', () => {
  const report = evaluateNaturalConsensusRecords([record({ highs: [0.90], judge: [] })]);
  const current = report.gates.find((entry) => entry.gate === 'current_v1');
  const strict = report.gates.find((entry) => entry.gate === 'unique_high_nontrivial_consensus');
  assert.equal(current.fast_errors, 1);
  assert.equal(strict.fast_cases, 0);
  assert.equal(strict.fallback_cases, 1);
  assert.equal(report.production_recommendation, null);
  assert.equal(report.evidence.promotion_evidence_sufficient, false);
});

test('strict gates can retain a uniquely supported two-candidate positive', () => {
  const report = evaluateNaturalConsensusRecords([record({ highs: [0.90, 0.80], judge: [0] })]);
  const strict = report.gates.find((entry) => entry.gate === 'unique_high_nontrivial_consensus');
  const votes = report.gates.find((entry) => entry.gate === 'unique_high_three_votes');
  assert.equal(strict.fast_cases, 1);
  assert.equal(strict.fast_errors, 0);
  assert.equal(votes.fast_cases, 1);
  assert.equal(votes.fast_errors, 0);
  assert.equal(report.best_observed_gate, 'unique_high');
});
