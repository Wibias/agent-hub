import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertSecretFreeReceipt } from '../../reference-graph/p3-receipt.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const evidenceFile = path.join(root, 'reference-graph/evidence/p3-live-shadow-evidence.json');

function loadEvidence() {
  return JSON.parse(readFileSync(evidenceFile, 'utf8'));
}

test('P3 evidence binds the dedicated live target and preserves legacy production selection', () => {
  const evidence = loadEvidence();

  assert.equal(evidence.phase, 'P3');
  assert.equal(evidence.target.project_ref, 'vrznfnxzlxaavpqbzbzd');
  assert.equal(evidence.target.project_name, 'agent-hub-reference-graph');
  assert.equal(evidence.target.region, 'eu-central-1');
  assert.equal(evidence.production_source, 'legacy-control');
  assert.equal(evidence.cutover_ready, false);
  assert.equal(evidence.eligible_for_cutover_review, false);
  assertSecretFreeReceipt(evidence);
});

test('P3 evidence records idempotent live import and unavailable exact-model embeddings', () => {
  const evidence = loadEvidence();

  assert.equal(evidence.phases.import.status, 'success');
  assert.equal(evidence.phases.import.detail.plan.record_count, 600);
  assert.equal(evidence.phases.import.detail.plan.capture_count, 600);
  assert.equal(evidence.phases.import.detail.plan.source_count, 576);
  assert.equal(evidence.phases.import.detail.plan.asset_count, 600);
  assert.equal(evidence.phases.import.detail.batch_size, 25);
  assert.equal(evidence.phases.import.detail.runs, 2);
  assert.equal(evidence.phases.import.detail.idempotent, true);
  assert.equal(evidence.phases.import.detail.store_stats.assets, 600);
  assert.equal(evidence.phases.import.detail.store_stats.sources, 576);

  assert.equal(evidence.phases.embeddings.status, 'unavailable');
  assert.equal(evidence.phases.embeddings.detail.model_id, 'ollama/snowflake-arctic-embed:33m');
  assert.equal(evidence.phases.embeddings.detail.model_revision, 'e8db018629b4');
  assert.equal(evidence.phases.embeddings.detail.persisted_total, 0);
  assert.equal(evidence.phases.embeddings.detail.persisted_active_profile, 0);
});

test('P3 live lexical evidence reproduces the healthy-snapshot baseline and blocks cutover', () => {
  const evidence = loadEvidence();
  const lexical = evidence.evaluations.lexical.summary;

  assert.equal(evidence.control_reference_time, '2026-07-21T12:00:00.000Z');
  assert.equal(evidence.benchmark_control_health.healthy, true);
  assert.equal(evidence.current_control_health.healthy, false);
  assert.equal(lexical.case_count, 24);
  assert.equal(lexical.comparable_case_count, 24);
  assert.equal(lexical.average_overlap_at_k, 0.53125);
  assert.equal(lexical.legacy_top1_retention_rate, 0.7083333333333334);
  assert.equal(lexical.graph_empty_rate, 0);
  assert.equal(lexical.average_exact_surface_rate, 1);
  assert.equal(lexical.average_exact_platform_rate, 1);
  assert.equal(lexical.cutover_ready, false);
  assert.deepEqual(lexical.blockers, [
    'average overlap below threshold',
    'legacy top-1 retention below threshold',
  ]);

  assert.equal(evidence.evaluations.semantic.status, 'unavailable');
  assert.equal(evidence.evaluations.hybrid.status, 'unavailable');
  assert.equal(evidence.decision, 'no-cutover');
});

test('P3 evidence records the live lexical repair and tested implementation run', () => {
  const evidence = loadEvidence();

  assert.equal(evidence.phases.schema.status, 'success');
  assert.ok(evidence.phases.schema.detail.committed_migrations.includes('004_reference_graph_lexical_overlap.sql'));
  assert.equal(evidence.phases.schema.detail.live_lexical_repair.initial_empty_case_count, 24);
  assert.equal(evidence.phases.schema.detail.live_lexical_repair.post_fix_empty_case_count, 0);
  assert.equal(evidence.phases.schema.detail.live_lexical_repair.post_fix_candidate_smoke_count, 24);
  assert.equal(evidence.verification.implementation_github_actions_run, 39891759367);
  assert.equal(evidence.verification.implementation_git_sha, '7d606a28f65c6b72ef2312a0e9dace24dc2e2320');
  assert.equal(evidence.verification.tests, 73);
  assert.equal(evidence.verification.failures, 0);
});
