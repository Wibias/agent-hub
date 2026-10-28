import assert from 'node:assert/strict';
import test from 'node:test';

import {
  P10RuntimeTransportError,
  fetchP10QuickCandidatePool,
} from '../../reference-graph/p10-runtime-client.mjs';

function candidate() {
  return {
    asset_id: '11111111-1111-5111-8111-111111111111',
    legacy_id: 'ref-one',
    product: 'One',
    surface_family: 'public-home',
    platform: 'web-responsive',
    page_role: 'marketing',
    motion: 'static',
    source_family: 'one.example',
    topology: 'hero-grid',
    access_status: 'AVAILABLE',
    evidence_class: 'TESTED',
    ordinary_or_failure_prone: false,
    multi_state_flow: false,
    tags: ['visual-verified'],
    search_text: 'creator landing page',
    snapshot_date: '2026-10-24',
    refreshed_at: '2026-10-24T00:00:00.000Z',
  };
}

function timeoutPromise(options) {
  return new Promise((_resolve, reject) => {
    options.signal.addEventListener(
      'abort',
      () => reject(options.signal.reason ?? new Error('aborted')),
      { once: true },
    );
  });
}

test('P10 retries exactly once after a timeout and succeeds on the retry', async () => {
  let calls = 0;
  const result = await fetchP10QuickCandidatePool({
    supabaseUrl: 'https://example.supabase.co',
    publishableKey: 'pk',
    expectedDate: '2026-10-24',
    timeoutMs: 5,
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (calls === 1) return timeoutPromise(options);
      return {
        ok: true,
        status: 200,
        async json() { return [candidate()]; },
      };
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.candidates[0].legacy_id, 'ref-one');
  assert.ok(result.transport.latency_ms >= 5);
});

test('P10 gives up after the second timeout', async () => {
  let calls = 0;
  await assert.rejects(
    fetchP10QuickCandidatePool({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'pk',
      expectedDate: '2026-10-24',
      timeoutMs: 5,
      fetchImpl: async (_url, options) => {
        calls += 1;
        return timeoutPromise(options);
      },
    }),
    (error) => error instanceof P10RuntimeTransportError && /timed out/i.test(error.message),
  );

  assert.equal(calls, 2);
});

test('P10 does not retry non-timeout HTTP failures', async () => {
  let calls = 0;
  await assert.rejects(
    fetchP10QuickCandidatePool({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'pk',
      expectedDate: '2026-10-24',
      timeoutMs: 5,
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status: 503, async json() { return {}; } };
      },
    }),
    (error) => error instanceof P10RuntimeTransportError && /503/.test(error.message),
  );

  assert.equal(calls, 1);
});
