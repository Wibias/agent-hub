import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  P14_EVIDENCE_HEAD,
  P14_EVIDENCE_SHA256,
  executeP15Activation,
} from '../../reference-graph/p15-activation-executor.mjs';
import {
  createP14EnrollmentManifest,
  createP14UnsignedGrantPayload,
} from '../../reference-graph/p14-authority-enrollment-grant.mjs';
import { hashP13AuthorityDescriptor } from '../../reference-graph/p13-activation-grant-authority.mjs';

const P13_EVIDENCE_PATH = 'reference-graph/evidence/p13-activation-grant-authority-evidence.json';
const P14_EVIDENCE_PATH = 'reference-graph/evidence/p14-authority-enrollment-grant-evidence.json';
const EXPECTED_P14_HEAD = '43fd2adf9e73749b03283f7ae7c6e700bd383b35';
const EXPECTED_P14_SHA256 = '610f9f832d994e565fe6912e3aa1e25d5fe5b549fa08f1a48f477ee9b3956393';

function p13Evidence() {
  return JSON.parse(readFileSync(P13_EVIDENCE_PATH, 'utf8'));
}

function actualP13EvidenceSha256() {
  return createHash('sha256').update(readFileSync(P13_EVIDENCE_PATH)).digest('hex');
}

function actualP14EvidenceSha256() {
  return createHash('sha256').update(readFileSync(P14_EVIDENCE_PATH)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function ceremonyFixture({ expiresAt = '2026-10-24T02:15:00.000Z' } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const authority = {
    schema_version: 'reference-graph.p13-ed25519-authority.v1',
    authority_id: 'p15-ephemeral-test-authority',
    key_id: 'p15-ephemeral-key-1',
    algorithm: 'Ed25519',
    public_key_spki_base64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  const approvedAuthoritySha256 = hashP13AuthorityDescriptor(authority);
  const enrollmentManifest = createP14EnrollmentManifest({
    p13Evidence: p13Evidence(),
    p13EvidenceSha256: actualP13EvidenceSha256(),
    authority,
    approvedAuthoritySha256,
  });
  const payload = createP14UnsignedGrantPayload({
    p13Evidence: p13Evidence(),
    enrollmentManifest,
    issuedAt: '2026-10-24T02:00:00.000Z',
    notBefore: '2026-10-24T02:00:00.000Z',
    expiresAt,
    nonce: 'ab'.repeat(32),
  });
  const grant = {
    ...payload,
    signature_base64: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
  };
  return { enrollmentManifest, grant };
}

function legacyState() {
  return {
    production_source: 'legacy-control',
    quick_graph_enabled: false,
    repository_default_graph_enabled: false,
  };
}

function graphProbe() {
  return {
    quick: {
      authoritative_source: 'reference-graph',
      record_exact: true,
      pattern_exact: true,
    },
    standard: { authoritative_source: 'legacy-control' },
    deep: { authoritative_source: 'legacy-control' },
  };
}

function legacyProbe() {
  return {
    quick: {
      authoritative_source: 'legacy-control',
      record_exact: null,
      pattern_exact: null,
    },
    standard: { authoritative_source: 'legacy-control' },
    deep: { authoritative_source: 'legacy-control' },
  };
}

function callbacks(overrides = {}) {
  return {
    readActivationState: async () => legacyState(),
    consumeGrantNonce: async () => ({ consumed: true, consumption_id: 'consume-1' }),
    applyActivation: async () => ({ applied: true, change_id: 'activate-1' }),
    probeRuntime: async () => graphProbe(),
    rollbackActivation: async () => ({ rolled_back: true, change_id: 'rollback-1' }),
    ...overrides,
  };
}

function input(overrides = {}) {
  const ceremony = ceremonyFixture();
  return {
    p13Evidence: p13Evidence(),
    enrollmentManifest: ceremony.enrollmentManifest,
    grant: ceremony.grant,
    now: () => new Date('2026-10-24T02:05:00.000Z'),
    ...callbacks(),
    ...overrides,
  };
}

test('P15 pins the exact final P14 evidence head and evidence bytes', () => {
  assert.equal(P14_EVIDENCE_HEAD, EXPECTED_P14_HEAD);
  assert.equal(P14_EVIDENCE_SHA256, EXPECTED_P14_SHA256);
  assert.equal(actualP14EvidenceSha256(), EXPECTED_P14_SHA256);
});

test('invalid or stale grant fails closed before reading or mutating production', async () => {
  const ceremony = ceremonyFixture();
  const calls = [];
  const result = await executeP15Activation(input({
    ...ceremony,
    grant: { ...ceremony.grant, signature_base64: Buffer.alloc(64, 7).toString('base64') },
    readActivationState: async () => { calls.push('read'); return legacyState(); },
    consumeGrantNonce: async () => { calls.push('consume'); return { consumed: true, consumption_id: 'x' }; },
    applyActivation: async () => { calls.push('apply'); return { applied: true, change_id: 'x' }; },
  }));
  assert.equal(result.status, 'blocked');
  assert.equal(result.grant_verified, false);
  assert.equal(result.activation_authorized, false);
  assert.equal(result.grant_consumed, false);
  assert.equal(result.activation_performed, false);
  assert.deepEqual(calls, []);
});

test('non-legacy or malformed pre-state fails before nonce consumption', async () => {
  for (const state of [
    { ...legacyState(), quick_graph_enabled: true },
    { ...legacyState(), production_source: 'reference-graph' },
    { ...legacyState(), repository_default_graph_enabled: true },
    { production_source: 'legacy-control' },
  ]) {
    let consumed = false;
    const result = await executeP15Activation(input({
      readActivationState: async () => state,
      consumeGrantNonce: async () => { consumed = true; return { consumed: true, consumption_id: 'x' }; },
    }));
    assert.equal(result.status, 'blocked');
    assert.equal(result.activation_performed, false);
    assert.equal(consumed, false);
  }
});

test('nonce is consumed before the fresh verification and production mutation', async () => {
  const events = [];
  const times = [
    new Date('2026-10-24T02:05:00.000Z'),
    new Date('2026-10-24T02:05:01.000Z'),
  ];
  const result = await executeP15Activation(input({
    now: () => { events.push('now'); return times.shift(); },
    readActivationState: async () => { events.push('read'); return legacyState(); },
    consumeGrantNonce: async () => { events.push('consume'); return { consumed: true, consumption_id: 'consume-1' }; },
    applyActivation: async () => { events.push('apply'); return { applied: true, change_id: 'activate-1' }; },
    probeRuntime: async () => { events.push('probe'); return graphProbe(); },
  }));
  assert.equal(result.status, 'activated');
  assert.equal(result.grant_consumed, true);
  assert.equal(result.activation_performed, true);
  assert.deepEqual(events, ['now', 'read', 'consume', 'now', 'apply', 'probe']);
});

test('grant expiring after nonce consumption cannot mutate production and cannot be retried', async () => {
  const ceremony = ceremonyFixture({ expiresAt: '2026-10-24T02:06:00.000Z' });
  const events = [];
  const times = [
    new Date('2026-10-24T02:05:00.000Z'),
    new Date('2026-10-24T02:06:01.000Z'),
  ];
  const result = await executeP15Activation(input({
    ...ceremony,
    now: () => times.shift(),
    consumeGrantNonce: async () => { events.push('consume'); return { consumed: true, consumption_id: 'consume-1' }; },
    applyActivation: async () => { events.push('apply'); return { applied: true, change_id: 'activate-1' }; },
  }));
  assert.equal(result.status, 'authorized');
  assert.equal(result.grant_verified, false);
  assert.equal(result.grant_consumed, true);
  assert.equal(result.activation_performed, false);
  assert.equal(result.retry_requires_new_grant, true);
  assert.deepEqual(events, ['consume']);
});

test('successful activation changes only quick and requires exact live isolation and parity', async () => {
  const applyInputs = [];
  const result = await executeP15Activation(input({
    applyActivation: async (value) => {
      applyInputs.push(value);
      return { applied: true, change_id: 'activate-1' };
    },
  }));
  assert.equal(result.status, 'activated');
  assert.equal(result.activation_authorized, true);
  assert.equal(result.grant_consumed, true);
  assert.equal(result.activation_performed, true);
  assert.equal(result.production_source, 'reference-graph');
  assert.equal(result.rollback_performed, false);
  assert.equal(result.rollback_verified, false);
  assert.equal(applyInputs.length, 1);
  assert.equal(applyInputs[0].activation_flag, 'REFERENCE_GRAPH_QUICK_RUNTIME');
  assert.equal(applyInputs[0].activation_value, 'graph');
  assert.equal(applyInputs[0].grant_nonce, 'ab'.repeat(32));
  assert.match(applyInputs[0].grant_payload_hash, /^[0-9a-f]{64}$/);
  assert.match(applyInputs[0].request_hash, /^[0-9a-f]{64}$/);
  assert.match(applyInputs[0].authority_hash, /^[0-9a-f]{64}$/);
});

test('replay rejection or malformed consumption result stops before activation', async () => {
  for (const consumeResult of [
    { consumed: false, consumption_id: null },
    { consumed: true },
    { consumed: true, consumption_id: '' },
    null,
  ]) {
    let applied = false;
    const result = await executeP15Activation(input({
      consumeGrantNonce: async () => consumeResult,
      applyActivation: async () => { applied = true; return { applied: true, change_id: 'activate-1' }; },
    }));
    assert.equal(result.status, 'authorized');
    assert.equal(result.grant_consumed, false);
    assert.equal(result.activation_performed, false);
    assert.equal(applied, false);
  }
});

test('post-mutation parity or isolation failure rolls back and verifies legacy restoration', async () => {
  const probes = [
    {
      ...graphProbe(),
      quick: { ...graphProbe().quick, pattern_exact: false },
    },
    legacyProbe(),
  ];
  const events = [];
  const result = await executeP15Activation(input({
    applyActivation: async () => { events.push('apply'); return { applied: true, change_id: 'activate-1' }; },
    probeRuntime: async () => { events.push('probe'); return probes.shift(); },
    rollbackActivation: async (value) => {
      events.push('rollback');
      assert.equal(value.activation_flag, 'REFERENCE_GRAPH_QUICK_RUNTIME');
      assert.equal(value.activation_change_id, 'activate-1');
      return { rolled_back: true, change_id: 'rollback-1' };
    },
  }));
  assert.equal(result.status, 'rolled-back');
  assert.equal(result.activation_performed, false);
  assert.equal(result.rollback_performed, true);
  assert.equal(result.rollback_verified, true);
  assert.equal(result.production_source, 'legacy-control');
  assert.equal(result.retry_requires_new_grant, true);
  assert.deepEqual(events, ['apply', 'probe', 'rollback', 'probe']);
});

test('rollback verification failure is never reported as restored', async () => {
  const probes = [
    { ...graphProbe(), standard: { authoritative_source: 'reference-graph' } },
    graphProbe(),
  ];
  const result = await executeP15Activation(input({
    probeRuntime: async () => probes.shift(),
  }));
  assert.equal(result.status, 'rollback-unverified');
  assert.equal(result.activation_performed, false);
  assert.equal(result.rollback_performed, true);
  assert.equal(result.rollback_verified, false);
  assert.equal(result.production_source, 'unknown');
  assert.equal(result.retry_requires_new_grant, true);
});
