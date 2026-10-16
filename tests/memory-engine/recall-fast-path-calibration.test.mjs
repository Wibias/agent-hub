import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateRecallFastPath,
  calibrateRecallFastPath,
} from '../../memory-engine/recall-fast-path-calibration.mjs';

const scored = [
  {
    id: 'direct',
    relevantClaimIds: ['a'],
    candidates: [
      { claimId: 'a', similarity: 0.92 },
      { claimId: 'b', similarity: 0.31 },
    ],
  },
  {
    id: 'negative',
    relevantClaimIds: [],
    candidates: [
      { claimId: 'a', similarity: 0.38 },
      { claimId: 'b', similarity: 0.27 },
    ],
  },
  {
    id: 'ambiguous',
    relevantClaimIds: ['a'],
    candidates: [
      { claimId: 'a', similarity: 0.73 },
      { claimId: 'b', similarity: 0.68 },
    ],
  },
];

test('fast path only decides outside the ambiguity band', () => {
  const result = evaluateRecallFastPath(scored, {
    negativeThreshold: 0.4,
    positiveThreshold: 0.8,
  });

  assert.equal(result.fast_cases, 2);
  assert.equal(result.fallback_cases, 1);
  assert.equal(result.fast_errors, 0);
  assert.equal(result.coverage, 2 / 3);
  assert.deepEqual(
    result.cases.map((entry) => [entry.id, entry.route, entry.selected_ids]),
    [
      ['direct', 'fast_positive', ['a']],
      ['negative', 'fast_negative', []],
      ['ambiguous', 'fallback', []],
    ],
  );
});

test('calibration prefers the highest-coverage zero-error threshold pair', () => {
  const result = calibrateRecallFastPath(scored, {
    thresholds: [0.3, 0.4, 0.6, 0.8, 0.9],
  });

  assert.equal(result.recommended.fast_errors, 0);
  assert.ok(result.recommended.fast_cases >= 2);
  assert.ok(result.recommended.coverage >= 2 / 3);
  assert.ok(result.sweep.tested_pairs > 0);
  assert.ok(result.sweep.zero_error_pairs > 0);
});

import {
  buildRecallCandidatePassage,
  scoreRecallCasesWithEmbedder,
} from '../../memory-engine/recall-fast-path-calibration.mjs';

test('E5 scoring embeds production-shaped passages once and scores each query', async () => {
  const passageCalls = [];
  const queryCalls = [];
  const embedder = {
    async embedPassages(texts) {
      passageCalls.push(texts);
      return texts.map((text) => (
        text.includes('Postgres')
          ? new Float32Array([1, 0])
          : new Float32Array([0, 1])
      ));
    },
    async embedQuery(text) {
      queryCalls.push(text);
      return new Float32Array([1, 0]);
    },
  };
  const item = (id, value) => ({
    claim: { id, kind: 'knowledge', subject: 'db', predicate: 'choice', value },
    evidence: { authority_class: 'user_direct', content_redacted: value },
  });
  const cases = [{
    id: 'db', query: 'Which DB?',
    items: [item('postgres', 'Postgres'), item('sqlite', 'SQLite')],
    relevantClaimIds: ['postgres'],
  }];

  assert.equal(
    buildRecallCandidatePassage(cases[0].items[0]),
    'passage: knowledge db choice Postgres',
  );
  const result = await scoreRecallCasesWithEmbedder(cases, { embedder });
  assert.equal(passageCalls.length, 1);
  assert.equal(queryCalls.length, 1);
  assert.deepEqual(result[0].candidates.map((entry) => entry.claimId), ['postgres', 'sqlite']);
  assert.equal(result[0].candidates[0].similarity, 1);
});
