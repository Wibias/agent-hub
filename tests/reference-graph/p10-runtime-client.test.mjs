import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  P10RuntimeTransportError,
  fetchP10QuickCandidatePool,
} from '../../reference-graph/p10-runtime-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

function candidate(overrides = {}) {
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
    ...overrides,
  };
}

test('P10 runtime client GETs only the current projection with publishable-key auth', async () => {
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    return {
      ok: true,
      status: 200,
      async json() { return [candidate()]; },
    };
  };

  const result = await fetchP10QuickCandidatePool({
    supabaseUrl: 'https://vrznfnxzlxaavpqbzbzd.supabase.co/',
    publishableKey: 'publishable-test-value',
    expectedDate: '2026-10-24',
    fetchImpl,
  });

  assert.equal(calls.length, 1);
  const [rawUrl, options] = calls[0];
  const url = new URL(rawUrl);
  assert.equal(url.origin, 'https://vrznfnxzlxaavpqbzbzd.supabase.co');
  assert.equal(url.pathname, '/rest/v1/reference_graph_quick_runtime_projection_p10');
  assert.equal(url.searchParams.get('snapshot_date'), 'eq.2026-10-24');
  assert.equal(url.searchParams.get('order'), 'asset_id.asc');
  assert.match(url.searchParams.get('select') ?? '', /asset_id/);
  assert.match(url.searchParams.get('select') ?? '', /search_text/);
  assert.match(url.searchParams.get('select') ?? '', /snapshot_date/);
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.apikey, 'publishable-test-value');
  assert.equal(options.body, undefined);
  assert.ok(options.signal instanceof AbortSignal);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].legacy_id, 'ref-one');
  assert.equal(result.candidates[0].snapshot_date, '2026-10-24');
  assert.deepEqual(Object.keys(result.transport).sort(), [
    'candidate_count',
    'latency_ms',
    'refreshed_at',
    'snapshot_date',
    'status',
  ]);
  assert.equal(result.transport.status, 'available');
  assert.equal(result.transport.candidate_count, 1);
  assert.equal(result.transport.snapshot_date, '2026-10-24');
  assert.equal(result.transport.refreshed_at, '2026-10-24T00:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(result), /publishable-test-value/);
});

test('P10 runtime client fails closed on empty or wrong-date snapshots', async () => {
  for (const payload of [
    [],
    [candidate({ snapshot_date: '2026-10-23' })],
  ]) {
    await assert.rejects(
      fetchP10QuickCandidatePool({
        supabaseUrl: 'https://example.supabase.co',
        publishableKey: 'pk',
        expectedDate: '2026-10-24',
        fetchImpl: async () => ({ ok: true, status: 200, async json() { return payload; } }),
      }),
      P10RuntimeTransportError,
    );
  }
});

test('P10 runtime client rejects duplicate asset and legacy identities', async () => {
  for (const payload of [
    [candidate(), candidate({ legacy_id: 'ref-two' })],
    [candidate(), candidate({ asset_id: '22222222-2222-5222-8222-222222222222' })],
  ]) {
    await assert.rejects(
      fetchP10QuickCandidatePool({
        supabaseUrl: 'https://example.supabase.co',
        publishableKey: 'pk',
        expectedDate: '2026-10-24',
        fetchImpl: async () => ({ ok: true, status: 200, async json() { return payload; } }),
      }),
      P10RuntimeTransportError,
    );
  }
});

test('P10 runtime client rejects malformed payloads and invalid expected dates', async () => {
  for (const payload of [
    {},
    [candidate({ asset_id: '' })],
    [candidate({ legacy_id: '' })],
    [candidate({ tags: 'not-an-array' })],
    [candidate({ refreshed_at: '' })],
  ]) {
    await assert.rejects(
      fetchP10QuickCandidatePool({
        supabaseUrl: 'https://example.supabase.co',
        publishableKey: 'pk',
        expectedDate: '2026-10-24',
        fetchImpl: async () => ({ ok: true, status: 200, async json() { return payload; } }),
      }),
      P10RuntimeTransportError,
    );
  }

  await assert.rejects(
    fetchP10QuickCandidatePool({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'pk',
      expectedDate: '24-10-2026',
      fetchImpl: async () => ({ ok: true, status: 200, async json() { return [candidate()]; } }),
    }),
    P10RuntimeTransportError,
  );
});

test('P10 runtime client fails closed on non-2xx invalid JSON and timeout', async () => {
  await assert.rejects(
    fetchP10QuickCandidatePool({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'pk',
      expectedDate: '2026-10-24',
      fetchImpl: async () => ({ ok: false, status: 503, async json() { return {}; } }),
    }),
    (error) => error instanceof P10RuntimeTransportError && /503/.test(error.message),
  );

  await assert.rejects(
    fetchP10QuickCandidatePool({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'pk',
      expectedDate: '2026-10-24',
      fetchImpl: async () => ({ ok: true, status: 200, async json() { throw new SyntaxError('bad json'); } }),
    }),
    P10RuntimeTransportError,
  );

  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener(
      'abort',
      () => reject(options.signal.reason ?? new Error('aborted')),
      { once: true },
    );
  });
  await assert.rejects(
    fetchP10QuickCandidatePool({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'pk',
      expectedDate: '2026-10-24',
      fetchImpl,
      timeoutMs: 5,
    }),
    (error) => error instanceof P10RuntimeTransportError && /timed out/i.test(error.message),
  );
});

test('P10 runtime client source has no RPC or service-role credential path', () => {
  const source = readFileSync(path.join(root, 'reference-graph/p10-runtime-client.mjs'), 'utf8');
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service[_-]?role[_-]?key/i);
  assert.doesNotMatch(source, /\/rest\/v1\/rpc\//i);
  assert.match(source, /reference_graph_quick_runtime_projection_p10/);
});
