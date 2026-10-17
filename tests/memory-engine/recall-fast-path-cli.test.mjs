import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  parseRecallFastPathArgs,
  runRecallFastPathCalibrationCli,
} from '../../scripts/eval-recall-fast-path.mjs';

test('fast-path CLI parser uses the pinned E5 cache env and bounded threshold defaults', () => {
  assert.deepEqual(
    parseRecallFastPathArgs(['--cases', 'cases.json', '--json'], '/repo', {
      MEMORY_E5_MODEL_CACHE: '/cache/e5',
    }),
    {
      casesPath: resolve('/repo/cases.json'),
      cacheDir: resolve('/cache/e5'),
      thresholdMin: 0,
      thresholdMax: 1,
      thresholdStep: 0.01,
      json: true,
    },
  );
});

test('fast-path CLI scores cases with E5 and reports a safe recommendation', async () => {
  const logs = [];
  const item = (id, value) => ({
    claim: { id, kind: 'knowledge', subject: 'db', predicate: 'choice', value },
    evidence: { authority_class: 'user_direct', content_redacted: value },
  });
  const cases = [
    { id: 'positive', query: 'Postgres?', items: [item('pg', 'Postgres'), item('ui', 'UI')], relevantClaimIds: ['pg'] },
    { id: 'negative', query: 'Weather?', items: [item('pg', 'Postgres'), item('ui', 'UI')], relevantClaimIds: [] },
  ];
  const result = await runRecallFastPathCalibrationCli({
    argv: ['--cases', 'cases.json', '--cache-dir', '/cache/e5', '--json'],
    cwd: '/repo',
    env: {},
    log(value) { logs.push(value); },
    dependencies: {
      async readCases() { return cases; },
      async createEmbedder() {
        return {
          modelId: 'e5-test', modelRevision: 'rev', dimensions: 2,
          async embedPassages(texts) {
            return texts.map((text) => text.includes('Postgres')
              ? new Float32Array([1, 0])
              : new Float32Array([0, 1]));
          },
          async embedQuery(text) {
            return text.includes('Postgres')
              ? new Float32Array([1, 0])
              : new Float32Array([0.5, 0.5]);
          },
        };
      },
    },
  });

  assert.equal(result.type, 'agent_hub_recall_fast_path_calibration_v1');
  assert.equal(result.calibration.recommended.fast_errors, 0);
  assert.ok(result.calibration.recommended.coverage > 0);
  assert.equal(JSON.parse(logs[0]).model.id, 'e5-test');
});
