import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRecallRelianceForContext } from '../../memory-engine/recall-relevance-pipeline.mjs';

function item(id) {
  return {
    claim: {
      id,
      state: 'active',
      kind: 'user_direct',
      subject: 'user memory',
      predicate: 'states',
      value_text: 'content-' + id,
    },
    evidence: {
      authority_class: 'user_direct',
      content_redacted: 'evidence-' + id,
    },
  };
}

function reliance(ids) {
  return {
    selected: ids.map(item),
    blocked: [],
    conflict_resolutions: [],
  };
}

function judgeSelecting(ids, { fail = false } = {}) {
  return async () => {
    if (fail) throw new Error('judge failed');
    return { selected_ids: ids, reason: 'fixture' };
  };
}

function fastResult(route, selectedIds, duration = 7) {
  return {
    route,
    selected_ids: selectedIds,
    duration_ms: duration,
    failed: false,
    policy_version: 'recall-fast-path-v1',
  };
}

function ids(result) {
  return result.selected.map((entry) => entry.claim.id);
}

test('shadow mode off leaves judge behavior structurally unchanged', async () => {
  const result = await filterRecallRelianceForContext({
    query: 'which memory applies?',
    reliance: reliance(['a', 'b']),
    judge: judgeSelecting(['b']),
  });

  assert.deepEqual(ids(result), ['b']);
  assert.equal(Object.hasOwn(result.selector, 'shadow_telemetry'), false);
  assert.deepEqual(Object.keys(result.selector).sort(), [
    'enabled',
    'error',
    'failed',
    'fallback_reason',
    'judgment',
    'selected_ids',
    'telemetry',
  ]);
});

test('shadow fast_v1 agreement keeps judge authoritative and records match telemetry', async () => {
  const result = await filterRecallRelianceForContext({
    query: 'which memory applies?',
    reliance: reliance(['a', 'b']),
    judge: judgeSelecting(['b']),
    shadowFastPath: async () => fastResult('fast_v1', ['b'], 11),
  });

  assert.deepEqual(ids(result), ['b']);
  assert.equal(result.selector.telemetry.judge_called, true);
  assert.deepEqual(result.selector.shadow_telemetry, {
    route: 'shadow',
    status: 'fast_v1_match',
    candidate_count: 2,
    selected_count: 1,
    judge_called: true,
    local_duration_ms: 11,
    total_duration_ms: 11 + result.selector.telemetry.duration_ms,
    duration_ms: 11,
    failed: false,
    policy_version: 'recall-fast-path-v1',
  });
});

test('shadow fast_v2 agreement keeps judge authoritative and identifies fast_v2', async () => {
  const result = await filterRecallRelianceForContext({
    query: 'which memory applies?',
    reliance: reliance(['a', 'b']),
    judge: judgeSelecting(['a']),
    shadowFastPath: async () => fastResult('fast_v2', ['a'], 13),
  });

  assert.deepEqual(ids(result), ['a']);
  assert.equal(result.selector.shadow_telemetry.status, 'fast_v2_match');
  assert.equal(result.selector.shadow_telemetry.selected_count, 1);
});

test('shadow disagreement never changes judge output and records mismatch', async () => {
  const result = await filterRecallRelianceForContext({
    query: 'which memory applies?',
    reliance: reliance(['a', 'b']),
    judge: judgeSelecting(['b']),
    shadowFastPath: async () => fastResult('fast_v1', ['a'], 5),
  });

  assert.deepEqual(ids(result), ['b']);
  assert.equal(result.selector.shadow_telemetry.status, 'fast_v1_mismatch');
});

test('shadow fast path failure is observational and does not fail authoritative recall', async () => {
  const result = await filterRecallRelianceForContext({
    query: 'which memory applies?',
    reliance: reliance(['a', 'b']),
    judge: judgeSelecting(['b']),
    shadowFastPath: async () => {
      throw new Error('local model unavailable');
    },
  });

  assert.deepEqual(ids(result), ['b']);
  assert.equal(result.selector.failed, false);
  assert.equal(result.selector.shadow_telemetry.status, 'fast_path_failed');
  assert.equal(result.selector.shadow_telemetry.failed, true);
});

test('zero candidates skip local shadow work and record no_candidates', async () => {
  let shadowCalls = 0;
  let judgeCalls = 0;
  const result = await filterRecallRelianceForContext({
    query: 'which memory applies?',
    reliance: reliance([]),
    judge: async () => {
      judgeCalls += 1;
      return { selected_ids: [], reason: 'fixture' };
    },
    shadowFastPath: async () => {
      shadowCalls += 1;
      return fastResult('fast_v1', []);
    },
  });

  assert.deepEqual(ids(result), []);
  assert.equal(judgeCalls, 0);
  assert.equal(shadowCalls, 0);
  assert.equal(result.selector.shadow_telemetry.route, 'shadow');
  assert.equal(result.selector.shadow_telemetry.status, 'no_candidates');
  assert.equal(result.selector.shadow_telemetry.candidate_count, 0);
  assert.equal(result.selector.shadow_telemetry.selected_count, 0);
});

test('judge failure remains authoritative failure and shadow cannot rescue it', async () => {
  const result = await filterRecallRelianceForContext({
    query: 'which memory applies?',
    reliance: reliance(['a', 'b']),
    judge: judgeSelecting([], { fail: true }),
    shadowFastPath: async () => fastResult('fast_v1', ['a'], 9),
  });

  assert.deepEqual(ids(result), []);
  assert.equal(result.selector.failed, true);
  assert.equal(result.selector.fallback_reason, 'selector_failed');
  assert.equal(result.selector.shadow_telemetry.status, 'judge_unavailable');
  assert.equal(result.selector.shadow_telemetry.selected_count, 1);
});

test('shadow works while normal fast path is disabled', async () => {
  const result = await filterRecallRelianceForContext({
    query: 'which memory applies?',
    reliance: reliance(['a', 'b']),
    judge: judgeSelecting(['b']),
    fastPath: null,
    shadowFastPath: async () => fastResult('fast_v1', ['a']),
  });

  assert.deepEqual(ids(result), ['b']);
  assert.equal(result.selector.shadow_telemetry.status, 'fast_v1_mismatch');
});

test('normal fast path without shadow keeps existing fast_v1 authority', async () => {
  let judgeCalls = 0;
  const result = await filterRecallRelianceForContext({
    query: 'which memory applies?',
    reliance: reliance(['a', 'b']),
    judge: async () => {
      judgeCalls += 1;
      return { selected_ids: ['b'], reason: 'fixture' };
    },
    fastPath: async () => fastResult('fast_v1', ['a']),
  });

  assert.deepEqual(ids(result), ['a']);
  assert.equal(judgeCalls, 0);
  assert.equal(result.selector.telemetry.route, 'fast_v1');
  assert.equal(Object.hasOwn(result.selector, 'shadow_telemetry'), false);
});

test('shadow fallback stays observational and is reported without content', async () => {
  const secretQuery = 'SECRET QUERY TEXT';
  const result = await filterRecallRelianceForContext({
    query: secretQuery,
    reliance: reliance(['a']),
    judge: judgeSelecting(['a']),
    shadowFastPath: async () => fastResult('fallback', [], 17),
  });

  assert.deepEqual(ids(result), ['a']);
  assert.equal(result.selector.shadow_telemetry.status, 'fast_path_fallback');
  const serialized = JSON.stringify(result.selector.shadow_telemetry);
  assert.equal(serialized.includes(secretQuery), false);
  assert.equal(serialized.includes('content-a'), false);
  assert.equal(serialized.includes('evidence-a'), false);
  assert.equal(serialized.includes('a'), true); // aggregate/status strings may contain the letter a
  assert.equal(Object.hasOwn(result.selector.shadow_telemetry, 'selected_ids'), false);
});

test('judge-only selector telemetry identifies judge route and preserves total duration', async () => {
  let now = 1_000;

  const result = await filterRecallRelianceForContext({
    query: 'which memory applies?',
    reliance: reliance(['a', 'b']),
    judge: async () => {
      now = 1_042;
      return {
        selected_ids: ['b'],
        reason: 'fixture',
      };
    },
    clockMs: () => now,
  });

  assert.deepEqual(ids(result), ['b']);
  assert.equal(result.selector.telemetry.route, 'judge');
  assert.equal(result.selector.telemetry.local_duration_ms, 0);
  assert.equal(result.selector.telemetry.total_duration_ms, 42);
  assert.equal(result.selector.telemetry.duration_ms, 42);
  assert.equal(result.selector.telemetry.judge_called, true);
});
