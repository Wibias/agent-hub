import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  loadReviewCases,
  parseArgs,
  sweep,
  thresholdRange,
} from '../../scripts/eval-recall-shadow-review-calibration.mjs';

test('defaults pin negative threshold and positive sweep', () => {
  const options = parseArgs(
    [],
    process.cwd(),
    { LOCALAPPDATA: 'C:\\Temp' },
    'win32',
  );

  assert.equal(options.negativeThreshold, 0.83);
  assert.equal(options.positiveMin, 0.85);
  assert.equal(options.positiveMax, 0.99);
  assert.equal(options.positiveStep, 0.005);

  assert.deepEqual(
    thresholdRange(0.85, 0.86, 0.005),
    [0.85, 0.855, 0.86],
  );
});

test('loads only fast_v1 mismatch review pairs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shadow-review-'));

  try {
    const id = 'a'.repeat(64);

    await writeFile(
      join(dir, `${id}.json`),
      JSON.stringify({
        id,
        query: 'q',
        candidates: [
          {
            claim: { id: 'a', value: 'A' },
            evidence: { id: 'e' },
            rank: 0,
          },
        ],
        localFastPath: {
          route: 'fast_v1',
          selected_ids: ['a'],
        },
      }),
    );

    await writeFile(
      join(dir, `${id}.result.json`),
      JSON.stringify({
        status: 'fast_v1_mismatch',
        judge_selected_ids: [],
      }),
    );

    const loaded = await loadReviewCases(dir);

    assert.equal(loaded.cases.length, 1);
    assert.equal(loaded.cases[0].id, id);
    assert.deepEqual(loaded.cases[0].relevantClaimIds, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('positive-only sweep finds lowest zero-error threshold', () => {
  const result = sweep(
    [
      {
        id: 'false-positive',
        relevantClaimIds: [],
        candidates: [
          { claimId: 'a', similarity: 0.86 },
        ],
      },
      {
        id: 'overselect',
        relevantClaimIds: ['b'],
        candidates: [
          { claimId: 'b', similarity: 0.90 },
          { claimId: 'c', similarity: 0.86 },
        ],
      },
    ],
    {
      negativeThreshold: 0.83,
      positiveMin: 0.85,
      positiveMax: 0.90,
      positiveStep: 0.005,
    },
  );

  assert.equal(result.baseline.fast_errors, 2);
  assert.equal(result.baseline.false_positive_cases, 1);
  assert.equal(result.baseline.overselect_cases, 1);

  assert.ok(result.recommendation);
  assert.equal(result.recommendation.positive_threshold, 0.865);
  assert.equal(result.recommendation.fast_errors, 0);
});
