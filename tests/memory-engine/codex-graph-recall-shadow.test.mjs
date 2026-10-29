import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selectCodexAuthoritativeRecall,
} from '../../memory-engine/adapters/codex-recall-context-selection.mjs';

function item(id, authority = 'user_direct') {
  return {
    claim: {
      id,
      kind: 'knowledge',
      subject: id,
      predicate: 'states',
      value: `value ${id}`,
      state: 'active',
    },
    evidence: {
      authority_class: authority,
      content_redacted: `evidence ${id}`,
    },
  };
}

function reliance(allowed, blocked = null) {
  return {
    use: 'answer',
    selected: [allowed],
    blocked: blocked ? [{ item: blocked, reason: 'authority' }] : [],
    conflict_resolutions: [],
  };
}

test('graph recall observer runs only after authoritative Judge selection and sees reliance-approved candidates', async () => {
  const allowed = item('allowed');
  const blocked = item('blocked', 'external_untrusted');
  const events = [];
  let judgeCalls = 0;
  let callback = null;

  const result = await selectCodexAuthoritativeRecall({
    query: 'which memory matters?',
    items: [allowed, blocked],
    conflicts: [],
    evaluateReliance() {
      return reliance(allowed, blocked);
    },
    relevanceJudge({ items }) {
      judgeCalls += 1;
      events.push(`judge:${items.map((entry) => entry.claim.id).join(',')}`);
      return { selected_ids: ['allowed'], reason: 'useful' };
    },
    graphRecallObserver: async (input) => {
      events.push(`graph:${input.authoritativeSelectedIds.join(',')}`);
      assert.equal(input.query, 'which memory matters?');
      assert.deepEqual(input.candidates.map((entry) => entry.claim.id), ['allowed']);
      assert.deepEqual(input.authoritativeSelectedIds, ['allowed']);
      assert.equal(input.judgeCalled, true);
      assert.equal(input.judgeAvailable, true);
      return { type: 'graph-shadow', observed: true };
    },
    onGraphRecallObservation: async (input) => {
      callback = input;
    },
  });

  assert.equal(judgeCalls, 1);
  assert.deepEqual(events, ['judge:allowed', 'graph:allowed']);
  assert.deepEqual(result.selected.map((entry) => entry.claim.id), ['allowed']);
  assert.deepEqual(result.selector.selected_ids, ['allowed']);
  assert.equal(result.blocked[0].item.claim.id, 'blocked');
  assert.deepEqual(callback.graphResult, { type: 'graph-shadow', observed: true });
  assert.deepEqual(callback.authoritativeSelectedIds, ['allowed']);
  assert.equal(callback.judgeCalled, true);
  assert.equal(callback.judgeAvailable, true);
});

test('graph observer failure is fail-open and cannot change authoritative selection', async () => {
  const allowed = item('allowed');
  let judgeCalls = 0;
  let callbackCalls = 0;

  const result = await selectCodexAuthoritativeRecall({
    query: 'q',
    items: [allowed],
    conflicts: [],
    evaluateReliance() {
      return reliance(allowed);
    },
    relevanceJudge() {
      judgeCalls += 1;
      return { selected_ids: ['allowed'], reason: 'useful' };
    },
    graphRecallObserver: async () => {
      throw new Error('shadow failure');
    },
    onGraphRecallObservation: async () => {
      callbackCalls += 1;
    },
  });

  assert.equal(judgeCalls, 1);
  assert.equal(callbackCalls, 0);
  assert.deepEqual(result.selected.map((entry) => entry.claim.id), ['allowed']);
  assert.deepEqual(result.selector.selected_ids, ['allowed']);
  assert.equal(result.selector.telemetry.judge_called, true);
});

test('graph observation callback failure is fail-open and cannot change authoritative result', async () => {
  const allowed = item('allowed');
  const result = await selectCodexAuthoritativeRecall({
    query: 'q',
    items: [allowed],
    conflicts: [],
    evaluateReliance() {
      return reliance(allowed);
    },
    relevanceJudge() {
      return { selected_ids: ['allowed'], reason: 'useful' };
    },
    graphRecallObserver: async () => ({ observed: true }),
    onGraphRecallObservation: async () => {
      throw new Error('persistence failure');
    },
  });

  assert.deepEqual(result.selected.map((entry) => entry.claim.id), ['allowed']);
  assert.deepEqual(result.selector.selected_ids, ['allowed']);
});

test('authoritative fast path remains no-Judge when graph observer is configured', async () => {
  const allowed = item('allowed');
  let judgeCalls = 0;
  let observerInput = null;

  const result = await selectCodexAuthoritativeRecall({
    query: 'q',
    items: [allowed],
    conflicts: [],
    evaluateReliance() {
      return reliance(allowed);
    },
    recallFastPath: async () => ({
      route: 'fast_v1',
      selected_ids: ['allowed'],
      duration_ms: 1,
      failed: false,
      policy_version: 'recall-fast-path-v2',
    }),
    relevanceJudge: async () => {
      judgeCalls += 1;
      throw new Error('Judge must not run');
    },
    graphRecallObserver: async (input) => {
      observerInput = input;
      return { observed: true };
    },
  });

  assert.equal(judgeCalls, 0);
  assert.deepEqual(result.selected.map((entry) => entry.claim.id), ['allowed']);
  assert.deepEqual(result.selector.selected_ids, ['allowed']);
  assert.equal(result.selector.telemetry.judge_called, false);
  assert.deepEqual(observerInput.authoritativeSelectedIds, ['allowed']);
  assert.equal(observerInput.judgeCalled, false);
  assert.equal(observerInput.judgeAvailable, false);
});

test('graph observer options reject non-functions without changing existing fast-path contracts', async () => {
  const allowed = item('allowed');
  const base = {
    query: 'q',
    items: [allowed],
    conflicts: [],
    evaluateReliance() {
      return reliance(allowed);
    },
  };

  await assert.rejects(
    selectCodexAuthoritativeRecall({ ...base, graphRecallObserver: {} }),
    /graphRecallObserver must be a function or null/,
  );
  await assert.rejects(
    selectCodexAuthoritativeRecall({ ...base, onGraphRecallObservation: {} }),
    /onGraphRecallObservation must be a function or null/,
  );
});
