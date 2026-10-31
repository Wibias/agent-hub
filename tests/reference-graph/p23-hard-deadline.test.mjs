import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';

import {
  P10RuntimeTransportError,
  fetchP10QuickCandidatePool,
} from '../../reference-graph/p10-runtime-client.mjs';

const baseInput = {
  supabaseUrl: 'https://example.supabase.co',
  publishableKey: 'pk',
  expectedDate: '2026-10-24',
  timeoutMs: 20,
};

function isTimeout(error) {
  return error instanceof P10RuntimeTransportError && /timed out/i.test(error.message);
}

test('P10 hard-times-out and retries once when fetch ignores AbortSignal', { timeout: 500 }, async () => {
  let calls = 0;
  const startedAt = performance.now();

  await assert.rejects(
    fetchP10QuickCandidatePool({
      ...baseInput,
      fetchImpl: async () => {
        calls += 1;
        return new Promise(() => {});
      },
    }),
    isTimeout,
  );

  const elapsed = performance.now() - startedAt;
  assert.equal(calls, 2);
  assert.ok(elapsed < 250, `hard deadline exceeded: ${elapsed}ms`);
});

test('P10 hard-times-out and retries once when response.json never settles', { timeout: 500 }, async () => {
  let calls = 0;
  const startedAt = performance.now();

  await assert.rejects(
    fetchP10QuickCandidatePool({
      ...baseInput,
      fetchImpl: async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => new Promise(() => {}),
        };
      },
    }),
    isTimeout,
  );

  const elapsed = performance.now() - startedAt;
  assert.equal(calls, 2);
  assert.ok(elapsed < 250, `hard deadline exceeded: ${elapsed}ms`);
});
