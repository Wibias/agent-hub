import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateGraphRecallShadowRecords,
} from '../../scripts/eval-graph-recall-shadow.mjs';

function record({
  qualityEligible = true,
  localDurationMs = 10,
  sourceCandidateCount = 3,
  graphCandidateCount = 3,
  sourcePrunedCount = 0,
  novelGraphCount = 0,
  falseNegativeCount = 0,
  finalSelectionRecall = 1,
  exactPreservation = true,
  estimatedSourceCandidateTokens = 30,
  estimatedGraphCandidateTokens = 30,
} = {}) {
  return {
    schemaVersion: 1,
    source: 'exact_runtime',
    quality_eligible: qualityEligible,
    metrics: {
      source_candidate_count: sourceCandidateCount,
      graph_candidate_count: graphCandidateCount,
      source_pruned_count: sourcePrunedCount,
      novel_graph_count: novelGraphCount,
      false_negative_count: falseNegativeCount,
      final_selection_recall: finalSelectionRecall,
      exact_preservation: exactPreservation,
      estimated_source_candidate_tokens: estimatedSourceCandidateTokens,
      estimated_graph_candidate_tokens: estimatedGraphCandidateTokens,
      local_duration_ms: localDurationMs,
    },
  };
}

test('aggregates natural graph recall shadow observations deterministically', () => {
  const report = evaluateGraphRecallShadowRecords([
    record({
      localDurationMs: 10,
      sourceCandidateCount: 4,
      graphCandidateCount: 3,
      sourcePrunedCount: 1,
      novelGraphCount: 0,
      falseNegativeCount: 0,
      finalSelectionRecall: 1,
      exactPreservation: true,
      estimatedSourceCandidateTokens: 40,
      estimatedGraphCandidateTokens: 24,
    }),
    record({
      localDurationMs: 30,
      sourceCandidateCount: 2,
      graphCandidateCount: 4,
      sourcePrunedCount: 1,
      novelGraphCount: 2,
      falseNegativeCount: 1,
      finalSelectionRecall: 0.5,
      exactPreservation: false,
      estimatedSourceCandidateTokens: 20,
      estimatedGraphCandidateTokens: 40,
    }),
    record({
      qualityEligible: false,
      localDurationMs: 20,
      sourceCandidateCount: 3,
      graphCandidateCount: 2,
      sourcePrunedCount: 0,
      novelGraphCount: 1,
      falseNegativeCount: 0,
      finalSelectionRecall: null,
      exactPreservation: null,
      estimatedSourceCandidateTokens: 30,
      estimatedGraphCandidateTokens: 26,
    }),
  ]);

  assert.equal(report.type, 'agent_hub_graph_recall_shadow');
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.evidence, {
    total_observation_count: 3,
    quality_eligible_observation_count: 2,
    required_quality_sample_target: 100,
    promotion_evidence_sufficient: false,
  });
  assert.deepEqual(report.metrics, {
    mean_local_duration_ms: 20,
    p95_local_duration_ms: 30,
    mean_source_candidate_count: 3,
    mean_graph_candidate_count: 3,
    mean_estimated_source_candidate_tokens: 30,
    mean_estimated_graph_candidate_tokens: 30,
    source_pruning_rate: 2 / 9,
    novel_candidate_rate: 3 / 9,
    aggregate_false_negative_count: 1,
    macro_final_selection_recall: 0.75,
    exact_preservation_rate: 0.5,
  });
  assert.equal(report.production_recommendation, null);
});

test('evidence sufficiency requires at least 100 quality-eligible observations', () => {
  const ninetyNine = Array.from({ length: 99 }, () => record());
  const oneHundred = [...ninetyNine, record()];
  const withIneligibleNoise = [
    ...Array.from({ length: 99 }, () => record()),
    ...Array.from({ length: 20 }, () => record({
      qualityEligible: false,
      finalSelectionRecall: null,
      exactPreservation: null,
    })),
  ];

  assert.equal(
    evaluateGraphRecallShadowRecords(ninetyNine).evidence.promotion_evidence_sufficient,
    false,
  );
  assert.equal(
    evaluateGraphRecallShadowRecords(oneHundred).evidence.promotion_evidence_sufficient,
    true,
  );
  assert.equal(
    evaluateGraphRecallShadowRecords(withIneligibleNoise).evidence.promotion_evidence_sufficient,
    false,
  );
});

test('macro recall excludes null denominator samples and recommendation always stays null', () => {
  const report = evaluateGraphRecallShadowRecords([
    record({ finalSelectionRecall: 1, exactPreservation: true }),
    record({ finalSelectionRecall: null, exactPreservation: true }),
    record({
      qualityEligible: false,
      finalSelectionRecall: null,
      exactPreservation: null,
    }),
  ]);

  assert.equal(report.metrics.macro_final_selection_recall, 1);
  assert.equal(report.metrics.exact_preservation_rate, 1);
  assert.equal(report.production_recommendation, null);
});

test('empty input has deterministic zero/null aggregates', () => {
  const report = evaluateGraphRecallShadowRecords([]);

  assert.deepEqual(report.evidence, {
    total_observation_count: 0,
    quality_eligible_observation_count: 0,
    required_quality_sample_target: 100,
    promotion_evidence_sufficient: false,
  });
  assert.deepEqual(report.metrics, {
    mean_local_duration_ms: null,
    p95_local_duration_ms: null,
    mean_source_candidate_count: null,
    mean_graph_candidate_count: null,
    mean_estimated_source_candidate_tokens: null,
    mean_estimated_graph_candidate_tokens: null,
    source_pruning_rate: null,
    novel_candidate_rate: null,
    aggregate_false_negative_count: 0,
    macro_final_selection_recall: null,
    exact_preservation_rate: null,
  });
  assert.equal(report.production_recommendation, null);
});

test('CLI reads durable graph shadow evidence and emits read-only JSON', async () => {
  const {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
  } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');

  const root = mkdtempSync(
    join(tmpdir(), 'agent-hub-graph-shadow-eval-'),
  );

  try {
    const dbPath = join(root, 'memory.sqlite3');
    const calibrationDir = join(
      root,
      'shadow-replay',
      'graph-calibration',
    );

    mkdirSync(calibrationDir, { recursive: true });

    const evidencePath = join(
      calibrationDir,
      `${'a'.repeat(64)}.json`,
    );

    writeFileSync(
      evidencePath,
      `${JSON.stringify(record({
        localDurationMs: 12,
        sourceCandidateCount: 4,
        graphCandidateCount: 3,
        sourcePrunedCount: 1,
        novelGraphCount: 1,
        falseNegativeCount: 0,
        finalSelectionRecall: 1,
        exactPreservation: true,
        estimatedSourceCandidateTokens: 40,
        estimatedGraphCandidateTokens: 24,
      }), null, 2)}\n`,
      'utf8',
    );

    const before = readFileSync(evidencePath, 'utf8');

    const script = fileURLToPath(
      new URL(
        '../../scripts/eval-graph-recall-shadow.mjs',
        import.meta.url,
      ),
    );

    const result = spawnSync(
      process.execPath,
      [script],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          AGENT_HUB_MEMORY_DB: dbPath,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.notEqual(
      result.stdout.trim(),
      '',
      'CLI must emit a JSON report',
    );

    const report = JSON.parse(result.stdout);

    assert.equal(report.type, 'agent_hub_graph_recall_shadow');
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.readOnly, true);
    assert.equal(report.evidence.total_observation_count, 1);
    assert.equal(
      report.evidence.quality_eligible_observation_count,
      1,
    );
    assert.equal(report.production_recommendation, null);

    assert.equal(
      readFileSync(evidencePath, 'utf8'),
      before,
      'evaluation must not mutate durable evidence',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
