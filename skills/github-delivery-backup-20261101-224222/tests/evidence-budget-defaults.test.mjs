import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateCodexHook } from '../scripts/lib/codex-watchdog-hook.mjs';

function preSearch(index) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'files__search',
    tool_input: {
      search_query: [{ q: `distinct-query-${index}` }],
    },
  };
}

test('default Codex evidence budget allows 50 distinct evidence reads', () => {
  let state = {};
  const blocks = [];
  const warnings = [];

  for (let index = 1; index <= 50; index += 1) {
    const result = evaluateCodexHook(preSearch(index), state);
    state = result.state;

    if (result.output?.decision === 'block') {
      blocks.push({
        index,
        reason: result.output.reason,
      });
    }
    if (result.output?.hookSpecificOutput?.additionalContext) {
      warnings.push({
        index,
        message: result.output.hookSpecificOutput.additionalContext,
      });
    }
  }

  assert.deepEqual(
    blocks,
    [],
    `distinct evidence exploration must not be hard-blocked within 50 reads: ${JSON.stringify(blocks)}`,
  );

  assert.equal(
    state.watchdog.consecutiveEvidenceAttempts,
    50,
    'the watchdog should still account for all evidence attempts',
  );

  assert.ok(
    warnings.length >= 1,
    'the soft-limit warning should still exist before the hard limit',
  );
});

test('duplicate evidence protection still blocks an unchanged repeated read', () => {
  let state = {};

  const first = evaluateCodexHook(preSearch(1), state);
  state = first.state;

  assert.notEqual(first.output?.decision, 'block');

  const duplicate = evaluateCodexHook(preSearch(1), state);

  assert.equal(duplicate.output?.decision, 'block');
  assert.match(
    duplicate.output?.reason ?? '',
    /Duplicate read blocked on unchanged state/i,
  );
});