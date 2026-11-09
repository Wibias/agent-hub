import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import { loadPatterns, loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { createP44IsolatedShadowRollbackHarness } from '../../reference-graph/p44-isolated-shadow-rollback.mjs';
import {
  evaluateP46SignedLabLease, createP46DistributedLabShadowGate,
} from '../../reference-graph/p46-distributed-lab-shadow-lease.mjs';

const key = generateKeyPairSync('ed25519');
const publicKeyPem = key.publicKey.export({ type: 'spki', format: 'pem' });
const publicKeySha256 = createHash('sha256')
  .update(key.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
const now = new Date('2026-11-09T19:10:02.000Z');
const sha = '83a3794cc54d2f2d129b83e8e672e18b35f11cff';
const labId = 'p46-isolated-lab-20261109';
const scope = {
  mode: 'isolated-shadow-rehearsal', profiles: ['standard', 'deep'],
  default_off: true, production_route_wiring: false,
};
const request = {
  profile: 'standard', limit: 12, surface: 'public-home',
  platform: 'web-responsive', job: 'creator landing page',
  dimensions: 'visual-world,topology',
};
const exact = {
  status: 'exact', record_order_exact: true, pattern_order_exact: true,
  authoritative_source: 'legacy-control',
  activation_authorized: false, graph_runtime_activated: false,
};

function envelope(patch = {}, signingKey = key.privateKey) {
  const payload = {
    schema_version: 'reference-graph.p46-lab-lease.v1',
    repository: 'Wibias/agent-hub', repository_sha: sha,
    project_ref: 'vrznfnxzlxaavpqbzbzd', lab_id: labId,
    scope: 'isolated-shadow-rehearsal', profiles: ['standard', 'deep'],
    sequence: 1, decision: 'shadow-probe-only',
    issued_at: '2026-11-09T19:10:00.000Z',
    expires_at: '2026-11-09T19:10:06.000Z', default_off: true,
    ...patch,
  };
  const payload_json = JSON.stringify(payload);
  return {
    schema_version: 'reference-graph.p46-signed-lab-envelope.v1',
    payload_json,
    signature_base64: sign(null, Buffer.from(payload_json), signingKey).toString('base64'),
  };
}
const verification = {
  publicKeyPem, publicKeySha256, expectedRepositorySha: sha,
  expectedLabId: labId, now,
};
function makeGate(coordinator, shadowProbe = () => exact, overrides = {}) {
  return createP46DistributedLabShadowGate({
    readSignedEnvelope: async () => coordinator.current,
    shadowProbe, scope, publicKeyPem, publicKeySha256,
    expectedRepositorySha: sha, expectedLabId: labId,
    clock: () => now, pollMs: 10, readTimeoutMs: 50, ...overrides,
  });
}

test('P46 validates signed short-lived lease but never asserts release authorization', () => {
  const v = evaluateP46SignedLabLease({ envelope: envelope(), ...verification });
  assert.equal(v.valid, true);
  assert.equal(v.lab_shadow_eligible, true);
  assert.equal(v.activation_authorized, false);
  assert.equal(v.production_graph_activated, false);
  assert.equal(v.owner_release_attested, false);
  const revoked = evaluateP46SignedLabLease({
    envelope: envelope({ decision: 'revoked', sequence: 2 }), ...verification,
  });
  assert.equal(revoked.valid, true);
  assert.equal(revoked.lab_shadow_eligible, false);
});

test('P46 rejects forged signatures, key substitution, scope, SHA and stale or long leases', () => {
  const impostor = generateKeyPairSync('ed25519');
  const cases = [
    envelope({}, impostor.privateKey),
    envelope({ repository_sha: '0'.repeat(40) }),
    envelope({ project_ref: 'other-project' }),
    envelope({ lab_id: 'another-lab-identity' }),
    envelope({ profiles: ['standard', 'quick'] }),
    envelope({ default_off: false }),
    envelope({ sequence: -1 }),
    envelope({ expires_at: '2026-11-09T19:12:00.000Z' }),
    envelope({ expires_at: '2026-11-09T19:10:01.000Z' }),
    envelope({ unexpected: 'field' }),
    { ...envelope(), signature_base64: 'bad' },
  ];
  for (const item of cases) {
    const v = evaluateP46SignedLabLease({ envelope: item, ...verification });
    assert.equal(v.lab_shadow_eligible, false);
    assert.equal(v.activation_authorized, false);
  }
  assert.equal(evaluateP46SignedLabLease({
    envelope: envelope(), ...verification,
    publicKeySha256: '0'.repeat(64),
  }).lab_shadow_eligible, false);
});

test('P46 two independent lab workers observe shared signed revocation, preserving Legacy authority', async () => {
  const coordinator = { current: envelope() };
  let callsA = 0, callsB = 0;
  const a = makeGate(coordinator, () => { callsA++; return exact; });
  const b = makeGate(coordinator, () => { callsB++; return exact; });
  assert.deepEqual(await a.probe({ request }), exact);
  assert.deepEqual(await b.probe({ request }), exact);
  coordinator.current = envelope({ decision: 'revoked', sequence: 2 });
  await assert.rejects(a.probe({ request }), /BLOCKED/);
  await assert.rejects(b.probe({ request }), /BLOCKED/);
  assert.equal(callsA, 1);
  assert.equal(callsB, 1);
  assert.equal(a.status().local_probe_latched_off, true);
  assert.equal(b.status().local_probe_latched_off, true);
  assert.equal(a.status().activation_authorized, false);
  coordinator.current = envelope({ sequence: 3 });
  await assert.rejects(a.probe({ request }), /BLOCKED/);
});

test('P46 signed sequence rollback latches off and never starts a new probe', async () => {
  const coordinator = { current: envelope({ sequence: 3 }) };
  let count = 0;
  const gate = makeGate(coordinator, () => { count++; return exact; });
  await gate.probe({ request });
  coordinator.current = envelope({ sequence: 2 });
  await assert.rejects(gate.probe({ request }), /BLOCKED/);
  assert.equal(count, 1);
  assert.equal(gate.status().local_probe_latched_off, true);
});

test('P46 pending worker aborts after revocation in central shared coordinator', { timeout: 10000 }, async () => {
  const coordinator = { current: envelope() };
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  let aborted = 0;
  const gate = makeGate(coordinator, ({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      aborted++;
      reject(new Error('secret must never reach logs'));
    }, { once: true });
    started();
  }));
  const task = gate.probe({ request });
  await pending;
  coordinator.current = envelope({ decision: 'revoked', sequence: 2 });
  await assert.rejects(task, /P46 shadow BLOCKED/);
  assert.equal(aborted, 1);
  assert.equal(gate.status().local_probe_latched_off, true);
});

test('P46 network partition, coordinator timeout and bad signature fail closed', async () => {
  for (const mode of ['unavailable', 'timeout', 'forged']) {
    let calls = 0;
    const coordinator = { current: envelope() };
    const gate = makeGate(coordinator, () => { calls++; return exact; }, {
      readTimeoutMs: 20,
      readSignedEnvelope: async () => {
        if (mode === 'unavailable') throw new Error('network partition');
        if (mode === 'timeout') return new Promise(() => {});
        return envelope({}, generateKeyPairSync('ed25519').privateKey);
      },
    });
    await assert.rejects(gate.probe({ request }), /BLOCKED/);
    assert.equal(calls, 0);
    assert.equal(gate.status().local_probe_latched_off, true);
    assert.equal(gate.status().activation_authorized, false);
  }
});

test('P46 default-off scope forbids production wiring or Quick', () => {
  const coordinator = { current: envelope() };
  for (const bad of [
    { ...scope, default_off: false },
    { ...scope, production_route_wiring: true },
    { ...scope, profiles: ['quick', 'deep'] },
  ]) {
    assert.throws(() => makeGate(coordinator, () => exact, { scope: bad }), /isolated lab scope/);
  }
});

test('P46 lab gate inside P44 returns only P11 Legacy and writes usage once', async () => {
  const coordinator = { current: envelope() };
  const gate = makeGate(coordinator);
  const h = createP44IsolatedShadowRollbackHarness({
    shadowProbe: args => gate.probe(args),
  });
  h.armForRehearsal(scope);
  let writes = 0;
  const r = await h.run({
    records: loadRecords(), patterns: loadPatterns(), request,
    now, recordUsageEnabled: true, recordUsageFn: () => writes++,
  });
  assert.equal(r.routing.authoritative_source, 'legacy-control');
  assert.equal(r.shadow.status, 'exact');
  assert.equal(writes, 1);
  assert.equal(r.shadow.activation_authorized, false);
});
