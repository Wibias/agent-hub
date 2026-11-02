import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function never() {
  return new Promise(() => {});
}

test('P10 gives the single retry its larger retryTimeoutMs budget', { timeout: 500 }, async () => {
  let calls = 0;
  const result = await fetchP10QuickCandidatePool({
    supabaseUrl: 'https://example.supabase.co',
    publishableKey: 'pk',
    expectedDate: '2026-10-24',
    timeoutMs: 20,
    retryTimeoutMs: 100,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return never();
      await sleep(60);
      return {
        ok: true,
        status: 200,
        async json() { return [candidate()]; },
      };
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.candidates[0].legacy_id, 'ref-one');
  assert.ok(result.transport.latency_ms >= 70, `retry returned too early: ${result.transport.latency_ms}ms`);
  assert.ok(result.transport.latency_ms < 200, `retry exceeded hard budget: ${result.transport.latency_ms}ms`);
});

test('P10 hard-stops after primary plus retry budgets', { timeout: 500 }, async () => {
  let calls = 0;
  const startedAt = performance.now();

  await assert.rejects(
    fetchP10QuickCandidatePool({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'pk',
      expectedDate: '2026-10-24',
      timeoutMs: 20,
      retryTimeoutMs: 80,
      fetchImpl: async () => {
        calls += 1;
        return never();
      },
    }),
    (error) => error instanceof P10RuntimeTransportError && /timed out/i.test(error.message),
  );

  const elapsed = performance.now() - startedAt;
  assert.equal(calls, 2);
  assert.ok(elapsed >= 90, `second attempt did not receive retry budget: ${elapsed}ms`);
  assert.ok(elapsed < 200, `combined hard budget exceeded: ${elapsed}ms`);
});
