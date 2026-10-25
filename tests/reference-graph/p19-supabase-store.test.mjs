import assert from 'node:assert/strict';
import test from 'node:test';

import { ReferenceGraphSupabaseStore } from '../../reference-graph/supabase-store.mjs';

const INPUT = Object.freeze({
  grant_payload_hash: 'b2'.repeat(32),
  request_hash: 'c3'.repeat(32),
  authority_hash: 'd4'.repeat(32),
});

function storeWith(fetchImpl, serviceRoleKey = 'p19-service-secret') {
  return new ReferenceGraphSupabaseStore({
    url: 'https://example.supabase.co',
    serviceRoleKey,
    fetchImpl,
  });
}

test('P19 store maps the exact public activation hashes to the service-only attestation RPC', async () => {
  const requests = [];
  const store = storeWith(async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({
      matching_count: 1,
      total_count: 1,
      exact_match: true,
    }), { status: 200 });
  });

  const result = await store.attestActivationConsumptionP19(INPUT);

  assert.deepEqual(result, {
    matching_count: 1,
    total_count: 1,
    exact_match: true,
  });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    'https://example.supabase.co/rest/v1/rpc/reference_graph_attest_activation_consumption_p19',
  );
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    p_grant_payload_hash: INPUT.grant_payload_hash,
    p_request_hash: INPUT.request_hash,
    p_authority_hash: INPUT.authority_hash,
  });
});

test('P19 store rejects malformed public hash input before any network request', async () => {
  for (const [field, value] of [
    ['grant_payload_hash', 'B2'.repeat(32)],
    ['grant_payload_hash', 'b2'.repeat(31)],
    ['request_hash', 'z'.repeat(64)],
    ['request_hash', ''],
    ['authority_hash', null],
  ]) {
    let fetchCount = 0;
    const store = storeWith(async () => {
      fetchCount += 1;
      throw new Error('network must not be reached');
    });
    await assert.rejects(
      store.attestActivationConsumptionP19({ ...INPUT, [field]: value }),
      /64.*lowercase.*hex|lowercase.*64.*hex/i,
    );
    assert.equal(fetchCount, 0, field);
  }
});

test('P19 store rejects malformed attestation results instead of inventing ledger state', async () => {
  const malformed = [
    null,
    [],
    {},
    { matching_count: -1, total_count: 1, exact_match: false },
    { matching_count: 1.5, total_count: 2, exact_match: false },
    { matching_count: 1, total_count: -1, exact_match: true },
    { matching_count: 1, total_count: 1.2, exact_match: true },
    { matching_count: 1, total_count: 1, exact_match: 'true' },
    { matching_count: 1, total_count: 1, exact_match: true, extra: true },
    { matching_count: 1, exact_match: true },
  ];

  for (const payload of malformed) {
    const store = storeWith(async () => new Response(JSON.stringify(payload), { status: 200 }));
    await assert.rejects(
      store.attestActivationConsumptionP19(INPUT),
      /P19 activation attestation response is malformed/,
      JSON.stringify(payload),
    );
  }
});

test('P19 store preserves credential redaction on attestation RPC failure', async () => {
  const secret = 'p19-service-secret';
  const store = storeWith(async () => new Response(JSON.stringify({
    message: `backend rejected ${secret}`,
  }), { status: 500, statusText: 'Internal Server Error' }), secret);

  await assert.rejects(
    store.attestActivationConsumptionP19(INPUT),
    (error) => {
      assert.equal(String(error).includes(secret), false);
      assert.match(String(error), /\[redacted\]/);
      return true;
    },
  );
});
