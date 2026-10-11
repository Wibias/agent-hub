import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selectCodexAuthoritativeRecall,
} from '../../memory-engine/adapters/codex-recall-context-selection.mjs';

function item(id, authority = 'user_direct') {
  return {
    claim: { id, state: 'active' },
    evidence: { authority_class: authority },
  };
}

test('codex recall context selection runs relevance only after reliance filtering', async () => {
  const allowed = item('allowed');
  const blocked = item('blocked', 'external_untrusted');
  const seen = [];

  const result = await selectCodexAuthoritativeRecall({
    query: 'Which database do we use?',
    items: [allowed, blocked],
    conflicts: [],
    evaluateReliance({ items, conflicts, use }) {
      assert.equal(use, 'answer');
      assert.equal(items.length, 2);
      assert.deepEqual(conflicts, []);
      return {
        use,
        selected: [allowed],
        blocked: [{ item: blocked, reason: 'authority_not_allowed_for_answer' }],
        conflict_resolutions: [],
      };
    },
    relevanceJudge({ items }) {
      seen.push(...items.map((entry) => entry.claim.id));
      return {
        selected_ids: ['allowed'],
        reason: 'directly useful',
      };
    },
  });

  assert.deepEqual(seen, ['allowed']);
  assert.deepEqual(result.selected.map((entry) => entry.claim.id), ['allowed']);
  assert.equal(result.selector.enabled, true);
});

test('codex recall context selection preserves current behavior when relevance judge is disabled', async () => {
  const allowed = item('allowed');
  const result = await selectCodexAuthoritativeRecall({
    query: 'anything',
    items: [allowed],
    conflicts: [],
    evaluateReliance() {
      return {
        use: 'answer', selected: [allowed], blocked: [], conflict_resolutions: [],
      };
    },
  });

  assert.deepEqual(result.selected, [allowed]);
  assert.equal(result.selector.enabled, false);
});
