import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const evidenceFile = path.join(root, 'reference-graph/evidence/p2-shadow-evidence.json');

function loadEvidence() {
  return JSON.parse(readFileSync(evidenceFile, 'utf8'));
}

test('P2 evidence records healthy snapshot control separately from stale current control', () => {
  const evidence = loadEvidence();

  assert.equal(evidence.phase, 'P2');
  assert.equal(evidence.production_source, 'legacy-control');
  assert.equal(evidence.control_reference_time, '2026-07-21T12:00:00.000Z');
  assert.equal(evidence.benchmark_control_health.healthy, true);
  assert.equal(evidence.benchmark_control_health.fresh_pool_count, 600);
  assert.equal(evidence.current_control_health.healthy, false);
  assert.equal(evidence.current_control_health.fresh_pool_count, 2);
});

test('P2 evidence binds the shipped experimental profile to exact model identity and measured quality', () => {
  const evidence = loadEvidence();
  const profile = evidence.active_experimental_profile;

  assert.equal(profile.id, 'snowflake-arctic-embed-33m-raw-v1');
  assert.equal(profile.model_id, 'ollama/snowflake-arctic-embed:33m');
  assert.equal(profile.model_revision, 'e8db018629b4');
  assert.equal(
    profile.model_digest,
    'e8db018629b498a0a1a2eadbe8ab29477c1d7c4b6ba8ff2a69b0a6ed193713be',
  );
  assert.equal(profile.dimensions, 384);
  assert.equal(profile.quality_status, 'experimental');
  assert.equal(profile.cutover_approved, false);
  assert.equal(profile.semantic.average_overlap_at_k, 0.28125);
  assert.equal(profile.semantic.legacy_top1_retention_rate, 0.4166666666666667);
  assert.equal(profile.hybrid.average_overlap_at_k, 0.4270833333333333);
  assert.equal(profile.hybrid.legacy_top1_retention_rate, 0.5);
  assert.equal(profile.semantic.cutover_ready, false);
  assert.equal(profile.hybrid.cutover_ready, false);
});

test('P2 evidence keeps lexical baseline and exploratory probes honest and blocks cutover', () => {
  const evidence = loadEvidence();

  assert.equal(evidence.lexical_baseline.average_overlap_at_k, 0.53125);
  assert.equal(evidence.lexical_baseline.legacy_top1_retention_rate, 0.7083333333333334);
  assert.equal(evidence.lexical_baseline.cutover_ready, false);

  assert.equal(evidence.all_minilm_probe.model_revision, '1b226e2802db');
  assert.equal(evidence.all_minilm_probe.dimensions, 384);
  assert.ok(
    evidence.all_minilm_probe.hybrid.average_overlap_at_k
      < evidence.lexical_baseline.average_overlap_at_k,
  );

  assert.equal(evidence.best_exploratory_probe.adopted, false);
  assert.equal(evidence.best_exploratory_probe.hybrid.average_overlap_at_k, 0.5208333333333334);
  assert.equal(
    evidence.best_exploratory_probe.hybrid.legacy_top1_retention_rate,
    0.6666666666666666,
  );
  assert.equal(evidence.best_exploratory_probe.hybrid.cutover_ready, false);
  assert.equal(evidence.decision, 'no-cutover');
  assert.equal(evidence.cutover_approved, false);
});

test('P2 evidence cites the real-model runs that produced the recorded measurements', () => {
  const evidence = loadEvidence();
  assert.deepEqual(evidence.github_actions_runs, [
    39881950029,
    39882352517,
    39882708171,
    39883080852,
  ]);
});
