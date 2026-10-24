import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertSecretFreeP15Receipt,
  createP15Receipt,
  finalizeP15Receipt,
} from '../../reference-graph/p15-receipt.mjs';
import {
  createP14EnrollmentManifest,
  createP14UnsignedGrantPayload,
} from '../../reference-graph/p14-authority-enrollment-grant.mjs';
import { hashP13AuthorityDescriptor } from '../../reference-graph/p13-activation-grant-authority.mjs';

const P13_EVIDENCE_PATH = 'reference-graph/evidence/p13-activation-grant-authority-evidence.json';

function p13Evidence() {
  return JSON.parse(readFileSync(P13_EVIDENCE_PATH, 'utf8'));
}

function p13EvidenceSha256() {
  return createHash('sha256').update(readFileSync(P13_EVIDENCE_PATH)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function ceremonyFixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const authority = {
    schema_version: 'reference-graph.p13-ed25519-authority.v1',
    authority_id: 'p15-receipt-test-authority',
    key_id: 'p15-receipt-key-1',
    algorithm: 'Ed25519',
    public_key_spki_base64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  const enrollmentManifest = createP14EnrollmentManifest({
    p13Evidence: p13Evidence(),
    p13EvidenceSha256: p13EvidenceSha256(),
    authority,
    approvedAuthoritySha256: hashP13AuthorityDescriptor(authority),
  });
  const payload = createP14UnsignedGrantPayload({
    p13Evidence: p13Evidence(),
    enrollmentManifest,
    issuedAt: '2026-10-24T02:30:00.000Z',
    notBefore: '2026-10-24T02:30:00.000Z',
    expiresAt: '2026-10-24T02:45:00.000Z',
    nonce: 'cd'.repeat(32),
  });
  return {
    p13Evidence: p13Evidence(),
    enrollmentManifest,
    grant: {
      ...payload,
      signature_base64: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
    },
  };
}

function receipt() {
  return createP15Receipt({
    gitSha: '7953f636ea72ba20a09d74c0beaa5d640a0b2849',
    verificationAt: '2026-10-24T02:31:00.000Z',
  });
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
    quick: { authoritative_source: 'reference-graph', record_exact: true, pattern_exact: true },
    standard: { authoritative_source: 'legacy-control' },
    deep: { authoritative_source: 'legacy-control' },
  };
}

function legacyProbe() {
  return {
    quick: { authoritative_source: 'legacy-control', record_exact: null, pattern_exact: null },
    standard: { authoritative_source: 'legacy-control' },
    deep: { authoritative_source: 'legacy-control' },
  };
}

function execution(overrides = {}) {
  return {
    ...ceremonyFixture(),
    readActivationState: async () => legacyState(),
    consumeGrantNonce: async () => ({ consumed: true, consumption_id: 'consume-r1' }),
    applyActivation: async () => ({ applied: true, change_id: 'activate-r1' }),
    probeRuntime: async () => graphProbe(),
    rollbackActivation: async () => ({ rolled_back: true, change_id: 'rollback-r1' }),
    now: () => new Date('2026-10-24T02:31:00.000Z'),
    ...overrides,
  };
}

test('P15 receipt starts blocked on exact P14 authority boundary with repository default off', () => {
  const value = receipt();
  assert.equal(value.schema_version, 'reference-graph.p15-activation-executor.v1');
  assert.equal(value.p14_evidence_head, '43fd2adf9e73749b03283f7ae7c6e700bd383b35');
  assert.equal(value.p14_evidence_sha256, '610f9f832d994e565fe6912e3aa1e25d5fe5b549fa08f1a48f477ee9b3956393');
  assert.equal(value.state, 'blocked');
  assert.equal(value.grant_state, 'not-issued');
  assert.equal(value.grant_verified, false);
  assert.equal(value.grant_consumed, false);
  assert.equal(value.activation_authorized, false);
  assert.equal(value.activation_performed, false);
  assert.equal(value.rollback_performed, false);
  assert.equal(value.rollback_verified, false);
  assert.equal(value.repository_default_graph_enabled, false);
  assert.equal(value.production_source, 'legacy-control');
  assert.equal(value.external_blocker, 'production-ed25519-authority-and-grant-not-provided');
});

test('P15 receipt rejects secret-shaped fields and literal secret material', () => {
  assert.throws(
    () => assertSecretFreeP15Receipt({ ...receipt(), private_key: 'forbidden' }),
    /private|secret|credential|signing/i,
  );
  assert.throws(
    () => assertSecretFreeP15Receipt({ ...receipt(), note: 'literal-secret-value' }, ['literal-secret-value']),
    /secret material/i,
  );
  assert.equal(assertSecretFreeP15Receipt(receipt()), true);
});

test('caller cannot finalize fabricated activation claims or precomputed executor results', async () => {
  await assert.rejects(
    () => finalizeP15Receipt(receipt(), {
      execution: {
        ...execution(),
        activation_authorized: true,
      },
    }),
    /exact|execution|artifact|field/i,
  );
  await assert.rejects(
    () => finalizeP15Receipt(receipt(), {
      executionResult: {
        status: 'activated',
        grant_verified: true,
        activation_authorized: true,
        activation_performed: true,
      },
    }),
    /exact|execution|artifact|field/i,
  );
});

test('P15 receipt becomes activated only by executing real signed ceremony artifacts', async () => {
  const value = await finalizeP15Receipt(receipt(), { execution: execution() });
  assert.equal(value.state, 'activated');
  assert.equal(value.grant_state, 'issued');
  assert.equal(value.grant_verified, true);
  assert.equal(value.grant_consumed, true);
  assert.equal(value.activation_authorized, true);
  assert.equal(value.activation_performed, true);
  assert.equal(value.rollback_performed, false);
  assert.equal(value.rollback_verified, false);
  assert.equal(value.repository_default_graph_enabled, false);
  assert.equal(value.production_source, 'reference-graph');
  assert.equal(value.external_blocker, null);
  assert.equal(value.retry_requires_new_grant, true);
  assert.equal(typeof value.consumption_id, 'string');
  assert.equal(typeof value.activation_change_id, 'string');
  assert.equal(value.grant, null);
  assert.equal(value.enrollment_manifest, null);
});

test('P15 receipt records rolled-back only after live legacy restoration is verified', async () => {
  const probes = [
    { ...graphProbe(), quick: { ...graphProbe().quick, record_exact: false } },
    legacyProbe(),
  ];
  const value = await finalizeP15Receipt(receipt(), {
    execution: execution({ probeRuntime: async () => probes.shift() }),
  });
  assert.equal(value.state, 'rolled-back');
  assert.equal(value.grant_verified, true);
  assert.equal(value.grant_consumed, true);
  assert.equal(value.activation_authorized, true);
  assert.equal(value.activation_performed, false);
  assert.equal(value.rollback_performed, true);
  assert.equal(value.rollback_verified, true);
  assert.equal(value.production_source, 'legacy-control');
  assert.equal(value.retry_requires_new_grant, true);
  assert.equal(typeof value.rollback_change_id, 'string');
});

test('unverified rollback is blocked and never reported as restored', async () => {
  const probes = [
    { ...graphProbe(), deep: { authoritative_source: 'reference-graph' } },
    graphProbe(),
  ];
  const value = await finalizeP15Receipt(receipt(), {
    execution: execution({ probeRuntime: async () => probes.shift() }),
  });
  assert.equal(value.state, 'blocked');
  assert.equal(value.rollback_performed, true);
  assert.equal(value.rollback_verified, false);
  assert.equal(value.production_source, 'unknown');
  assert.notEqual(value.external_blocker, null);
});
