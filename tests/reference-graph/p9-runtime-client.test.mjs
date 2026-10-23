import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  P9RuntimeTransportError,
  fetchP9QuickCandidatePool,
} from '../../reference-graph/p9-runtime-client.mjs';

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
    ...overrides,
  };
}

test('P9 runtime client calls only the zero-argument runtime RPC with publishable-key auth', async () => {
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    return {
      ok: true,
      status: 200,
      async json() { return [candidate()]; },
    };
  };

  const result = await fetchP9QuickCandidatePool({
    supabaseUrl: 'https://vrznfnxzlxaavpqbzbzd.supabase.co/',
    publishableKey: 'publishable-test-value',
    fetchImpl,
  });

  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, 'https://vrznfnxzlxaavpqbzbzd.supabase.co/rest/v1/rpc/reference_graph_quick_candidate_pool_runtime_p9');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.apikey, 'publishable-test-value');
  assert.equal(options.headers['content-type'], 'application/json');
  assert.equal(options.body, '{}');
  assert.ok(options.signal instanceof AbortSignal);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].legacy_id, 'ref-one');
  assert.deepEqual(Object.keys(result.transport).sort(), ['candidate_count', 'latency_ms', 'status']);
  assert.equal(result.transport.status, 'available');
  assert.equal(result.transport.candidate_count, 1);
  assert.ok(Number.isFinite(result.transport.latency_ms));
  assert.doesNotMatch(JSON.stringify(result), /publishable-test-value/);
});

test('P9 runtime client rejects duplicate asset and legacy identities', async () => {
  for (const payload of [
    [candidate(), candidate({ legacy_id: 'ref-two' })],
    [candidate(), candidate({ asset_id: '22222222-2222-5222-8222-222222222222' })],
  ]) {
    const fetchImpl = async () => ({ ok: true, status: 200, async json() { return payload; } });
    await assert.rejects(
      fetchP9QuickCandidatePool({
        supabaseUrl: 'https://example.supabase.co',
        publishableKey: 'pk',
        fetchImpl,
      }),
      P9RuntimeTransportError,
    );
  }
});

test('P9 runtime client rejects malformed candidate payloads before use', async () => {
  const payloads = [
    {},
    [candidate({ asset_id: '' })],
    [candidate({ legacy_id: '' })],
    [candidate({ tags: 'not-an-array' })],
  ];

  for (const payload of payloads) {
    const fetchImpl = async () => ({ ok: true, status: 200, async json() { return payload; } });
    await assert.rejects(
      fetchP9QuickCandidatePool({
        supabaseUrl: 'https://example.supabase.co',
        publishableKey: 'pk',
        fetchImpl,
      }),
      P9RuntimeTransportError,
    );
  }
});

test('P9 runtime client fails closed on non-2xx and invalid JSON responses', async () => {
  await assert.rejects(
    fetchP9QuickCandidatePool({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'pk',
      fetchImpl: async () => ({ ok: false, status: 503, async json() { return {}; } }),
    }),
    (error) => error instanceof P9RuntimeTransportError && /503/.test(error.message),
  );

  await assert.rejects(
    fetchP9QuickCandidatePool({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'pk',
      fetchImpl: async () => ({ ok: true, status: 200, async json() { throw new SyntaxError('bad json'); } }),
    }),
    P9RuntimeTransportError,
  );
});

test('P9 runtime client aborts a hung request at the configured timeout', async () => {
  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason ?? new Error('aborted')), { once: true });
  });

  await assert.rejects(
    fetchP9QuickCandidatePool({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'pk',
      fetchImpl,
      timeoutMs: 5,
    }),
    (error) => error instanceof P9RuntimeTransportError && /timed out/i.test(error.message),
  );
});

test('P9 runtime client source has no service-role credential surface', () => {
  const source = readFileSync(path.join(root, 'reference-graph/p9-runtime-client.mjs'), 'utf8');
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service[_-]?role[_-]?key/i);
  assert.match(source, /reference_graph_quick_candidate_pool_runtime_p9/);
});
