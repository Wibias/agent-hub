import test from 'node:test';
import assert from 'node:assert/strict';

import { selectCodexAuthoritativeRecall } from '../../memory-engine/adapters/codex-recall-context-selection.mjs';

function item(id) {
  return {
    claim: { id, kind: 'knowledge', subject: id, predicate: 'states', value: id, state: 'active' },
    evidence: { authority_class: 'user_direct', content_redacted: id },
  };
}

test('Codex context selection passes only authority-approved items into fast path', async () => {
  const allowed = item('allowed');
  const blocked = item('blocked');
  let seen = null;
  const result = await selectCodexAuthoritativeRecall({
    query: 'q',
    items: [allowed, blocked],
    conflicts: [],
    evaluateReliance() {
      return {
        use: 'answer',
        selected: [allowed],
        blocked: [{ item: blocked, reason: 'authority' }],
        conflict_resolutions: [],
      };
    },
    recallFastPath: async ({ items, retrievalTelemetry }) => {
      seen = {
        ids: items.map((entry) => entry.claim.id),
        retrievalTelemetry,
      };
      return {
        route: 'fast_v1',
        selected_ids: ['allowed'],
        duration_ms: 1,
        failed: false,
        policy_version: 'recall-fast-path-v2',
      };
    },
    fastPathContext: { retrievalTelemetry: { id: 'run' } },
    relevanceJudge: async () => {
      throw new Error('must not run');
    },
  });
  assert.deepEqual(seen, {
    ids: ['allowed'],
    retrievalTelemetry: { id: 'run' },
  });
  assert.deepEqual(result.selected.map((entry) => entry.claim.id), ['allowed']);
  assert.equal(result.blocked[0].item.claim.id, 'blocked');
});
