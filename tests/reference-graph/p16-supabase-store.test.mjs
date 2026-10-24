import assert from 'node:assert/strict';
import test from 'node:test';

import { ReferenceGraphSupabaseStore } from '../../reference-graph/supabase-store.mjs';

const INPUT = Object.freeze({
  nonce: 'a1'.repeat(32),
  grant_payload_hash: 'b2'.repeat(32),
  request_hash: 'c3'.repeat(32),
  authority_hash: 'd4'.repeat(32),
});

function storeWith(fetchImpl) {
  return new ReferenceGraphSupabaseStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'p16-service-secret',
    fetchImpl,
  });
}

test('P16 store maps the exact grant-consumption input to the service-only RPC', async () => {
  const requests = [];
  const store = storeWith(async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({
      consumed: true,
      consumption_id: '00000000-0000-4000-8000-000000000016',
    }), { status: 200 });
  });

  const result = await store.consumeActivationGrantNonceP16(INPUT);

  assert.deepEqual(result, {
    consumed: true,
    consumption_id: '00000000-0000-4000-8000-000000000016',
  });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    'https://example.supabase.co/rest/v1/rpc/reference_graph_consume_activation_grant_nonce_p16',
  );
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    p_nonce: INPUT.nonce,
    p_grant_payload_hash: INPUT.grant_payload_hash,
    p_request_hash: INPUT.request_hash,
    p_authority_hash: INPUT.authority_hash,
  });
});

test('P16 store preserves the exact replay result without exposing prior consumption data', async () => {
  const store = storeWith(async () => new Response(JSON.stringify({
    consumed: false,
    consumption_id: null,
  }), { status: 200 }));

  assert.deepEqual(await store.consumeActivationGrantNonceP16(INPUT), {
    consumed: false,
    consumption_id: null,
  });
});

test('P16 store rejects malformed nonce or hash input before any network request', async () => {
  for (const [field, value] of [
    ['nonce', 'A1'.repeat(32)],
    ['nonce', 'a1'.repeat(31)],
    ['grant_payload_hash', 'z'.repeat(64)],
    ['request_hash', ''],
    ['authority_hash', null],
  ]) {
    let fetchCount = 0;
    const store = storeWith(async () => {
      fetchCount += 1;
      throw new Error('network must not be reached');
    });
    await assert.rejects(
      store.consumeActivationGrantNonceP16({ ...INPUT, [field]: value }),
      /64.*lowercase.*hex|lowercase.*64.*hex/i,
    );
    assert.equal(fetchCount, 0, field);
  }
});

test('P16 store rejects malformed RPC results instead of inventing consumption state', async () => {
  const malformed = [
    null,
    [],
    {},
    { consumed: true, consumption_id: null },
    { consumed: false, consumption_id: 'old-id' },
    { consumed: 'true', consumption_id: 'id' },
    { consumed: true, consumption_id: '' },
    { consumed: true, consumption_id: 'id', extra: true },
  ];

  for (const payload of malformed) {
    const store = storeWith(async () => new Response(JSON.stringify(payload), { status: 200 }));
    await assert.rejects(
      store.consumeActivationGrantNonceP16(INPUT),
      /P16.*consumption.*response|consumption.*response.*P16/i,
      JSON.stringify(payload),
    );
  }
});

test('P16 store preserves existing service-role credential redaction on RPC failure', async () => {
  const secret = 'p16-service-secret';
  const store = new ReferenceGraphSupabaseStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: secret,
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
