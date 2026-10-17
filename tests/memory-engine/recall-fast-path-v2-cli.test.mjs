import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  parseRecallFastPathV2Args,
  runRecallFastPathV2CalibrationCli,
} from '../../scripts/eval-recall-fast-path-v2.mjs';

test('v2 CLI parser defaults to benchmark-v1 thresholds and bounded consensus sweep', () => {
  assert.deepEqual(
    parseRecallFastPathV2Args(['--cases', 'cases.json', '--json'], '/repo', {
      MEMORY_E5_MODEL_CACHE: '/cache/e5',
    }),
    {
      casesPath: resolve('/repo/cases.json'),
      cacheDir: resolve('/cache/e5'),
      negativeThreshold: 0.83,
      positiveThreshold: 0.85,
      supportMin: 0.75,
      supportMax: 0.86,
      supportStep: 0.01,
      marginMin: 0.01,
      marginMax: 0.10,
      marginStep: 0.01,
      lexicalMaxK: 5,
      fusedMaxK: 5,
      estimatedFallbackMs: 7000,
      json: true,
    },
  );
});

test('v2 CLI calibrates over production-shaped hybrid diagnostics and reports latency estimate', async () => {
  const logs = [];
  const cases = [{ id: 'one', query: 'x', items: [{ claim: { id: 'a' } }], relevantClaimIds: ['a'] }];
  const hybridCases = [{
    id: 'one',
    relevantClaimIds: ['a'],
    candidates: [
      { claimId: 'a', similarity: 0.91, lexicalRank: 1, semanticRank: 1, finalRank: 1, rrfScore: 0.03 },
      { claimId: 'b', similarity: 0.84, lexicalRank: 2, semanticRank: 2, finalRank: 2, rrfScore: 0.02 },
    ],
  }];

  const result = await runRecallFastPathV2CalibrationCli({
    argv: ['--cases', 'cases.json', '--cache-dir', '/cache/e5', '--json'],
    cwd: '/repo',
    env: {},
    log(value) { logs.push(value); },
    dependencies: {
      async readCases() { return cases; },
      async createEmbedder() {
        return { modelId: 'e5-test', modelRevision: 'rev', dimensions: 2 };
      },
      async scoreBaselineCases() {
        return [{
          id: 'one', relevantClaimIds: ['a'],
          candidates: [
            { claimId: 'a', similarity: 0.858 },
            { claimId: 'b', similarity: 0.78 },
          ],
        }];
      },
      evaluateBaseline() {
        return {
          fast_cases: 1, fallback_cases: 0, fast_errors: 0,
          cases: [{ id: 'one', route: 'fast_positive', selected_ids: ['a'] }],
        };
      },
      async rankCases() { return hybridCases; },
    },
  });

  assert.equal(result.type, 'agent_hub_recall_fast_path_calibration_v2');
  assert.equal(result.baseline.fast_cases, 1);
  assert.equal(result.calibration.recommended.cases[0].baseline_preserved, true);
  assert.equal(result.calibration.recommended.cases[0].route, 'fast_positive');
  assert.equal(result.calibration.recommended.fast_errors, 0);
  assert.equal(result.performance.estimated_mean_fallback_latency_ms >= 0, true);
  assert.equal(JSON.parse(logs[0]).model.id, 'e5-test');
});
