import assert from 'node:assert/strict';
import test from 'node:test';

import { ReferenceGraphSupabaseStore } from '../../reference-graph/supabase-store.mjs';

const INPUT = Object.freeze({
  nonce: 'aa'.repeat(32),
  grant_payload_hash: 'bb'.repeat(32),
  request_hash: 'cc'.repeat(32),
  authority_hash: 'dd'.repeat(32),
});

function successResponse() {
  return new Response(JSON.stringify({
    consumed: true,
    consumption_id: '00000000-0000-4000-8000-000000000018',
  }), { status: 200 });
}

test('P18 store prefers SUPABASE_SECRET_KEY over legacy service-role env', async () => {
  const requests = [];
  const store = ReferenceGraphSupabaseStore.fromEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_modern_key',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role-key',
  }, {
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return successResponse();
    },
  });

  await store.consumeActivationGrantNonceP16(INPUT);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.headers.apikey, 'sb_secret_modern_key');
  assert.equal(Object.hasOwn(requests[0].init.headers, 'authorization'), false);
});

test('P18 store sends modern sb_secret keys only in apikey header', async () => {
  const requests = [];
  const store = new ReferenceGraphSupabaseStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'sb_secret_admin_component_key',
    fetchImpl: async (_url, init) => {
      requests.push(init);
      return successResponse();
    },
  });

  await store.consumeActivationGrantNonceP16(INPUT);
  assert.equal(requests[0].headers.apikey, 'sb_secret_admin_component_key');
  assert.equal(Object.hasOwn(requests[0].headers, 'authorization'), false);
});

test('P18 store preserves legacy service-role JWT authorization compatibility', async () => {
  const requests = [];
  const legacy = 'eyJlegacy-service-role-jwt';
  const store = ReferenceGraphSupabaseStore.fromEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: legacy,
  }, {
    fetchImpl: async (_url, init) => {
      requests.push(init);
      return successResponse();
    },
  });

  await store.consumeActivationGrantNonceP16(INPUT);
  assert.equal(requests[0].headers.apikey, legacy);
  assert.equal(requests[0].headers.authorization, `Bearer ${legacy}`);
});

test('P18 store redacts modern secret keys from RPC errors', async () => {
  const secret = 'sb_secret_redaction_check';
  const store = ReferenceGraphSupabaseStore.fromEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: secret,
  }, {
    fetchImpl: async () => new Response(JSON.stringify({
      message: `backend rejected ${secret}`,
    }), { status: 500, statusText: 'Internal Server Error' }),
  });

  await assert.rejects(
    store.consumeActivationGrantNonceP16(INPUT),
    (error) => {
      assert.equal(String(error).includes(secret), false);
      assert.match(String(error), /\[redacted\]/);
      return true;
    },
  );
});
