import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecallFastPathDiagnostics } from '../../memory-engine/recall-fast-path-diagnostics.mjs';

const settings = {
  negativeThreshold: 0.83,
  positiveThreshold: 0.85,
  supportThreshold: 0.86,
  singleMarginThreshold: 0.03,
  lexicalK: 1,
  fusedK: 1,
  minVotes: 3,
};

test('diagnostics preserve exact scores and content-free retrieval signals', () => {
  const diagnostics = buildRecallFastPathDiagnostics({
    scoredCandidates: [
      { claimId: 'claim-a', similarity: 0.91 },
      { claimId: 'claim-b', similarity: 0.87 },
    ],
    retrievalTelemetry: {
      candidates: [
        { claim_id: 'claim-a', semantic_rank: 1, lexical_rank: 1, final_rank: 1, rrf_score: 0.031, budget_retained: true },
        { claim_id: 'claim-b', semantic_rank: 2, lexical_rank: 2, final_rank: 2, rrf_score: 0.02, budget_retained: true },
      ],
    },
    settings,
  });
  assert.equal(diagnostics.schema_version, 1);
  assert.equal(diagnostics.candidates[0].similarity, 0.91);
  assert.equal(diagnostics.candidates[0].signal_votes, 3);
  assert.equal(diagnostics.candidates[1].signal_votes, 1);
  assert.ok(Math.abs(diagnostics.top_margin - 0.04) < 1e-12);
  assert.equal(JSON.stringify(diagnostics).includes('secret text'), false);
});

test('single-candidate diagnostics use null top margin and null absent ranks', () => {
  const diagnostics = buildRecallFastPathDiagnostics({
    scoredCandidates: [{ claimId: 'claim-a', similarity: 0.88 }],
    retrievalTelemetry: null,
    settings,
  });
  assert.equal(diagnostics.top_margin, null);
  assert.equal(diagnostics.candidates[0].semantic_rank, null);
  assert.equal(diagnostics.candidates[0].lexical_rank, null);
  assert.equal(diagnostics.candidates[0].final_rank, null);
});

import { createRecallFastPathRuntime } from '../../memory-engine/recall-fast-path-runtime.mjs';

test('runtime adds diagnostics without changing the v1 route or selected ids', async () => {
  let now = 100;
  const runtime = createRecallFastPathRuntime({
    embedder: {
      async embedQuery() { return new Float32Array([1, 0]); },
      async embedPassages(passages) {
        assert.equal(passages.length, 2);
        return [new Float32Array([0.90, 0]), new Float32Array([0.80, 0])];
      },
    },
    settings,
    clockMs: () => now++,
  });
  const items = [
    { claim: { id: 'claim-a', state: 'active', kind: 'decision', subject: 'db', predicate: 'uses', value: 'A' }, evidence: { authority_class: 'repo_trusted', source_ref: 'x', content_redacted: 'A' } },
    { claim: { id: 'claim-b', state: 'active', kind: 'decision', subject: 'db', predicate: 'uses', value: 'B' }, evidence: { authority_class: 'repo_trusted', source_ref: 'y', content_redacted: 'B' } },
  ];
  const result = await runtime.select({
    query: 'Which database?',
    items,
    retrievalTelemetry: {
      candidates: [
        { claim_id: 'claim-a', semantic_rank: 1, lexical_rank: 1, final_rank: 1, rrf_score: 0.03, budget_retained: true },
        { claim_id: 'claim-b', semantic_rank: 2, lexical_rank: 2, final_rank: 2, rrf_score: 0.02, budget_retained: true },
      ],
    },
  });
  assert.equal(result.route, 'fast_v1');
  assert.deepEqual(result.selected_ids, ['claim-a']);
  assert.equal(result.diagnostics.schema_version, 1);
  assert.ok(Math.abs(result.diagnostics.candidates[0].similarity - 0.90) < 1e-6);
});
