import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRecallFastPathRuntime,
  RECALL_FAST_PATH_DEFAULTS,
} from '../../memory-engine/recall-fast-path-runtime.mjs';

function item(id, value = id) {
  return {
    claim: {
      id,
      kind: 'knowledge',
      subject: id,
      predicate: 'states',
      value,
      state: 'active',
    },
    evidence: { authority_class: 'user_direct', content_redacted: value },
  };
}

function embedder(scoresByPassage) {
  return {
    async embedQuery() { return new Float32Array([1]); },
    async embedPassages(passages) {
      return passages.map((passage) => {
        for (const [needle, score] of Object.entries(scoresByPassage)) {
          if (passage.includes(needle)) return new Float32Array([score]);
        }
        return new Float32Array([0]);
      });
    },
  };
}

test('v1 returns a safe local decision without hybrid telemetry', async () => {
  const runtime = createRecallFastPathRuntime({
    embedder: embedder({ alpha: 0.91, beta: 0.70 }),
  });
  const result = await runtime.select({
    query: 'alpha?',
    items: [item('a', 'alpha'), item('b', 'beta')],
  });
  assert.equal(result.route, 'fast_v1');
  assert.deepEqual(result.selected_ids, ['a']);
  assert.equal(result.selected_count, 1);
  assert.equal(result.failed, false);
});

test('v2 rescues only a v1 fallback backed by semantic lexical and fused top consensus', async () => {
  const runtime = createRecallFastPathRuntime({
    embedder: embedder({ alpha: 0.90, beta: 0.84 }),
  });
  const result = await runtime.select({
    query: 'alpha?',
    items: [item('a', 'alpha'), item('b', 'beta')],
    retrievalTelemetry: {
      items: [
        { claim_id: 'a', lexical_rank: 1, semantic_rank: 1, final_rank: 1, rrf_score: 0.03, budget_retained: true },
        { claim_id: 'b', lexical_rank: 2, semantic_rank: 2, final_rank: 2, rrf_score: 0.02, budget_retained: true },
      ],
    },
  });
  assert.equal(result.route, 'fast_v2');
  assert.equal(result.decision, 'single_consensus');
  assert.deepEqual(result.selected_ids, ['a']);
});

test('ambiguous fallback stays undecided when consensus is incomplete', async () => {
  const runtime = createRecallFastPathRuntime({
    embedder: embedder({ alpha: 0.84, beta: 0.83 }),
  });
  const result = await runtime.select({
    query: 'alpha and beta?',
    items: [item('a', 'alpha'), item('b', 'beta')],
    retrievalTelemetry: {
      items: [
        { claim_id: 'a', lexical_rank: 1, semantic_rank: 1, final_rank: 1, rrf_score: 0.03, budget_retained: true },
        { claim_id: 'b', lexical_rank: 2, semantic_rank: 2, final_rank: 2, rrf_score: 0.02, budget_retained: true },
      ],
    },
  });
  assert.equal(result.route, 'fallback');
  assert.deepEqual(result.selected_ids, []);
});

test('runtime uses the calibrated v2 settings', () => {
  assert.deepEqual(RECALL_FAST_PATH_DEFAULTS, {
    negativeThreshold: 0.83,
    positiveThreshold: 0.85,
    supportThreshold: 0.86,
    singleMarginThreshold: 0.03,
    lexicalK: 1,
    fusedK: 1,
    minVotes: 3,
  });
});
