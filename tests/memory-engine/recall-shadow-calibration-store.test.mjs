import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildRecallShadowCalibrationRecord,
  RecallShadowCalibrationStore,
  recallShadowCalibrationCandidateKey,
} from '../../memory-engine/recall-shadow-calibration-store.mjs';

function sample(status = 'fast_v1_match') {
  const id = 'a'.repeat(64);
  return {
    packet: {
      id,
      createdAt: '2026-10-17T00:00:00.000Z',
      candidates: [
        { claim: { id: 'raw-claim-a', value: 'SECRET VALUE' }, evidence: { content_redacted: 'SECRET EVIDENCE' } },
        { claim: { id: 'raw-claim-b', value: 'OTHER' }, evidence: { content_redacted: 'OTHER EVIDENCE' } },
      ],
      localFastPath: {
        route: 'fast_v1', decision: 'positive', selected_ids: ['raw-claim-a'], policy_version: 'recall-fast-path-v2',
        diagnostics: {
          schema_version: 1,
          thresholds: { negative_threshold: 0.83, positive_threshold: 0.85, support_threshold: 0.86, single_margin_threshold: 0.03, lexical_k: 1, fused_k: 1, min_votes: 3 },
          candidates: [
            { claim_id: 'raw-claim-a', similarity: 0.9, semantic_rank: 1, lexical_rank: 1, final_rank: 1, rrf_score: 0.03, budget_retained: true, signal_votes: 3 },
            { claim_id: 'raw-claim-b', similarity: 0.8, semantic_rank: 2, lexical_rank: 2, final_rank: 2, rrf_score: 0.02, budget_retained: true, signal_votes: 0 },
          ],
          top_margin: 0.1,
        },
      },
    },
    result: { status, judgeCalled: true, judgeSelectedIds: ['raw-claim-a'] },
  };
}

test('calibration record hashes ids and contains no query/claim/evidence content', () => {
  const built = buildRecallShadowCalibrationRecord(sample());
  assert.equal(built.status, 'ready');
  const text = JSON.stringify(built.record);
  assert.equal(text.includes('raw-claim-a'), false);
  assert.equal(text.includes('SECRET VALUE'), false);
  assert.equal(text.includes('SECRET EVIDENCE'), false);
  assert.equal(built.record.local_selected_keys[0], recallShadowCalibrationCandidateKey('raw-claim-a'));
});

test('legacy diagnostics and judge unavailable are skipped rather than fabricated', () => {
  const legacy = sample();
  delete legacy.packet.localFastPath.diagnostics;
  assert.equal(buildRecallShadowCalibrationRecord(legacy).reason, 'legacy_without_exact_diagnostics');
  const unavailable = sample('judge_unavailable');
  assert.equal(buildRecallShadowCalibrationRecord(unavailable).reason, 'non_quality_status');
});

test('store is immutable, idempotent, and conflicts never overwrite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task9-calibration-'));
  try {
    const store = new RecallShadowCalibrationStore({ rootDir: root });
    const record = buildRecallShadowCalibrationRecord(sample()).record;
    assert.equal(store.record(record).status, 'recorded');
    assert.equal(store.record(record).status, 'existing');
    const path = join(root, 'calibration', record.packet_id + '.json');
    const before = await readFile(path, 'utf8');
    const conflicting = structuredClone(record);
    conflicting.local_decision = 'different';
    assert.throws(() => store.record(conflicting), (error) => error?.code === 'RECALL_SHADOW_CALIBRATION_CONFLICT');
    assert.equal(await readFile(path, 'utf8'), before);
    assert.equal(store.count(), 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
