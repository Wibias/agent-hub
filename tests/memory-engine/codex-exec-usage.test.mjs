import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCodexExecJsonUsage,
} from '../../memory-engine/codex-exec-usage.mjs';

test('codex exec usage parser returns the last completed turn usage', () => {
  const stdout = [
    JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
    JSON.stringify({ type: 'turn.completed', usage: {
      input_tokens: 100,
      cached_input_tokens: 40,
      output_tokens: 20,
    } }),
    JSON.stringify({ type: 'turn.completed', usage: {
      input_tokens: 220,
      cached_input_tokens: 120,
      cache_write_input_tokens: 5,
      output_tokens: 33,
      reasoning_output_tokens: 11,
    } }),
  ].join('\n');

  assert.deepEqual(parseCodexExecJsonUsage(stdout), {
    input_tokens: 220,
    cached_input_tokens: 120,
    cache_write_input_tokens: 5,
    output_tokens: 33,
    reasoning_output_tokens: 11,
  });
});

test('usage parser tolerates optional fields and unrelated non-json lines', () => {
  const stdout = [
    'warning: something benign',
    '{not-json}',
    JSON.stringify({ type: 'turn.completed', usage: {
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 2,
    } }),
  ].join('\n');

  assert.deepEqual(parseCodexExecJsonUsage(stdout), {
    input_tokens: 10,
    cached_input_tokens: 0,
    cache_write_input_tokens: null,
    output_tokens: 2,
    reasoning_output_tokens: null,
  });
});

test('usage parser fails closed on invalid numeric usage and returns null when absent', () => {
  assert.equal(parseCodexExecJsonUsage(''), null);
  assert.equal(parseCodexExecJsonUsage('{"type":"item.completed"}'), null);
  assert.throws(
    () => parseCodexExecJsonUsage(JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: -1, cached_input_tokens: 0, output_tokens: 1 },
    })),
    /input_tokens/u,
  );
});
