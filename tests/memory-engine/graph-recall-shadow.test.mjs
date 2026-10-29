import test from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateGraphRecallCandidateTokens,
  evaluateGraphRecallShadow,
} from '../../memory-engine/graph-recall-shadow.mjs';

function graph() {
  return {
    schemaVersion: 1,
    nodes: [
      { id: 'a', value: 'alpha graph memory' },
      { id: 'b', value: 'beta graph memory' },
      { id: 'c', value: 'charlie graph memory' },
      { id: 'd', value: 'delta graph memory' },
      { id: 'novel', value: 'novel graph neighbor' },
    ],
    edges: [
      {
        id: 'a-b', from: 'a', to: 'b', relation: 'supersedes',
        origin: 'explicit', directed: true, weight: 1,
      },
      {
        id: 'b-c', from: 'b', to: 'c', relation: 'semantic_similarity',
        origin: 'inferred', directed: false, weight: 0.91,
      },
      {
        id: 'c-novel', from: 'c', to: 'novel', relation: 'semantic_similarity',
        origin: 'inferred', directed: false, weight: 0.93,
      },
      {
        id: 'a-d-low', from: 'a', to: 'd', relation: 'semantic_similarity',
        origin: 'inferred', directed: false, weight: 0.70,
      },
      {
        id: 'd-novel-explicit', from: 'd', to: 'novel', relation: 'conflicts_with',
        origin: 'explicit', directed: false, weight: 1,
      },
    ],
  };
}

function source(ids = ['a', 'missing', 'b', 'd']) {
  return ids.map((id) => ({ id, text: `source text ${id}` }));
}

test('graph recall shadow uses deterministic source-order anchors and reports missing source graph nodes', () => {
  const inputGraph = graph();
  const inputSource = source();
  const beforeGraph = structuredClone(inputGraph);
  const beforeSource = structuredClone(inputSource);
  const times = [100, 107];

  const report = evaluateGraphRecallShadow({
    graph: inputGraph,
    sourceCandidates: inputSource,
    authoritativeSelectedIds: ['b'],
    judgeCalled: true,
    judgeAvailable: true,
    clockMs: () => times.shift(),
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.policyVersion, 'graph-recall-shadow-v1');
  assert.deepEqual(report.anchorIds, ['a', 'b', 'd']);
  assert.deepEqual(report.missingAnchorIds, ['missing']);
  assert.equal(report.metrics.anchor_count, 3);
  assert.equal(report.metrics.missing_anchor_count, 1);
  assert.equal(report.metrics.local_duration_ms, 7);
  assert.deepEqual(inputGraph, beforeGraph);
  assert.deepEqual(inputSource, beforeSource);
});

test('graph recall shadow observes novel neighbors, pruning, and Judge-labeled false negatives without changing authority', () => {
  const report = evaluateGraphRecallShadow({
    graph: graph(),
    sourceCandidates: source(['a', 'c', 'd']),
    authoritativeSelectedIds: ['a', 'd'],
    judgeCalled: true,
    judgeAvailable: true,
    maxAnchors: 1,
    maxHops: 1,
    maxCandidates: 8,
    minWeight: 0.82,
    clockMs: () => 10,
  });

  assert.deepEqual(report.anchorIds, ['a']);
  assert.deepEqual(report.graphCandidateIds, ['a', 'b']);
  assert.deepEqual(report.sourceRetainedIds, ['a']);
  assert.deepEqual(report.sourcePrunedIds, ['c', 'd']);
  assert.deepEqual(report.novelGraphIds, ['b']);
  assert.deepEqual(report.authoritativeSelectedIds, ['a', 'd']);
  assert.deepEqual(report.authoritativeHitIds, ['a']);
  assert.deepEqual(report.falseNegativeIds, ['d']);
  assert.equal(report.qualityEligible, true);
  assert.equal(report.metrics.source_candidate_count, 3);
  assert.equal(report.metrics.graph_candidate_count, 2);
  assert.equal(report.metrics.source_retained_count, 1);
  assert.equal(report.metrics.source_pruned_count, 2);
  assert.equal(report.metrics.novel_graph_count, 1);
  assert.equal(report.metrics.authoritative_selected_count, 2);
  assert.equal(report.metrics.authoritative_hit_count, 1);
  assert.equal(report.metrics.false_negative_count, 1);
  assert.equal(report.metrics.final_selection_recall, 0.5);
  assert.equal(report.metrics.exact_preservation, false);
  assert.equal(report.metrics.graph_vs_source_candidate_delta, -1);
});

test('explicit relations remain traversable below the inferred similarity floor', () => {
  const report = evaluateGraphRecallShadow({
    graph: graph(),
    sourceCandidates: source(['d']),
    authoritativeSelectedIds: ['d'],
    judgeCalled: true,
    judgeAvailable: true,
    maxAnchors: 1,
    minWeight: 0.99,
    clockMs: () => 0,
  });

  assert.deepEqual(report.graphCandidateIds, ['d', 'novel']);
  assert.deepEqual(report.novelGraphIds, ['novel']);
});

test('no-Judge and empty-selection samples never fabricate final-selection recall', () => {
  const noJudge = evaluateGraphRecallShadow({
    graph: graph(),
    sourceCandidates: source(['a']),
    authoritativeSelectedIds: ['a'],
    judgeCalled: false,
    judgeAvailable: false,
    maxAnchors: 1,
    clockMs: () => 0,
  });
  assert.equal(noJudge.qualityEligible, false);
  assert.equal(noJudge.metrics.final_selection_recall, null);
  assert.equal(noJudge.metrics.exact_preservation, null);

  const emptyJudge = evaluateGraphRecallShadow({
    graph: graph(),
    sourceCandidates: source(['a']),
    authoritativeSelectedIds: [],
    judgeCalled: true,
    judgeAvailable: true,
    maxAnchors: 1,
    clockMs: () => 0,
  });
  assert.equal(emptyJudge.qualityEligible, true);
  assert.deepEqual(emptyJudge.falseNegativeIds, []);
  assert.equal(emptyJudge.metrics.false_negative_count, 0);
  assert.equal(emptyJudge.metrics.final_selection_recall, null);
  assert.equal(emptyJudge.metrics.exact_preservation, true);
});

test('candidate token estimate is deterministic UTF-8 bytes divided by four, rounded up', () => {
  assert.equal(estimateGraphRecallCandidateTokens(''), 0);
  assert.equal(estimateGraphRecallCandidateTokens('abcd'), 1);
  assert.equal(estimateGraphRecallCandidateTokens('abcde'), 2);
  assert.equal(estimateGraphRecallCandidateTokens('🙂'), 1);

  const report = evaluateGraphRecallShadow({
    graph: {
      schemaVersion: 1,
      nodes: [
        { id: 'a', value: 'graph a' },
        { id: 'novel', value: '12345678' },
      ],
      edges: [
        {
          id: 'a-novel', from: 'a', to: 'novel', relation: 'conflicts_with',
          origin: 'explicit', directed: false, weight: 1,
        },
      ],
    },
    sourceCandidates: [{ id: 'a', text: 'abcd' }],
    authoritativeSelectedIds: ['a'],
    judgeCalled: true,
    judgeAvailable: true,
    maxAnchors: 1,
    clockMs: () => 0,
  });

  assert.equal(report.metrics.estimated_source_candidate_tokens, 1);
  assert.equal(report.metrics.estimated_graph_candidate_tokens, 3);
});
