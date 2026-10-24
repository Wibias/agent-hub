import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { executeP17Activation } from '../../reference-graph/p17-activation-runner.mjs';
import { readP17RawState } from '../../reference-graph/p17-local-runtime-actuator.mjs';
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
    authority_id: 'p17-ephemeral-test-authority',
    key_id: 'p17-ephemeral-key-1',
    algorithm: 'Ed25519',
    public_key_spki_base64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  const approvedAuthoritySha256 = hashP13AuthorityDescriptor(authority);
  const enrollmentManifest = createP14EnrollmentManifest({
    p13Evidence: p13Evidence(),
    p13EvidenceSha256: p13EvidenceSha256(),
    authority,
    approvedAuthoritySha256,
  });
  const payload = createP14UnsignedGrantPayload({
    p13Evidence: p13Evidence(),
    enrollmentManifest,
    issuedAt: '2026-10-24T02:00:00.000Z',
    notBefore: '2026-10-24T02:00:00.000Z',
    expiresAt: '2026-10-24T02:15:00.000Z',
    nonce: 'cd'.repeat(32),
  });
  const grant = {
    ...payload,
    signature_base64: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
  };
  return { enrollmentManifest, grant };
}

async function tempStatePath() {
  const dir = await mkdtemp(join(tmpdir(), 'reference-graph-p17-runner-'));
  return join(dir, 'activation-state-v1.json');
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

test('P17 composes P15 with exact P16 nonce consumption before local graph mutation', async () => {
  const statePath = await tempStatePath();
  const ceremony = ceremonyFixture();
  const events = [];
  const consumeInputs = [];
  const store = {
    async consumeActivationGrantNonceP16(input) {
      events.push('consume');
      consumeInputs.push(input);
      assert.equal(await readP17RawState({ statePath }), null);
      return { consumed: true, consumption_id: 'p17-consumption-1' };
    },
  };

  const result = await executeP17Activation({
    p13Evidence: p13Evidence(),
    enrollmentManifest: ceremony.enrollmentManifest,
    grant: ceremony.grant,
    supabaseStore: store,
    statePath,
    now: () => new Date('2026-10-24T02:05:00.000Z'),
    probeRuntime: async () => {
      events.push('probe');
      const state = await readP17RawState({ statePath });
      assert.equal(state?.mode, 'graph');
      assert.equal(state?.consumption_id, 'p17-consumption-1');
      return graphProbe();
    },
  });

  assert.equal(result.status, 'activated');
  assert.equal(result.grant_consumed, true);
  assert.equal(result.activation_performed, true);
  assert.deepEqual(events, ['consume', 'probe']);
  assert.equal(consumeInputs.length, 1);
  assert.deepEqual(Object.keys(consumeInputs[0]).sort(), [
    'authority_hash',
    'grant_payload_hash',
    'nonce',
    'request_hash',
  ]);
  assert.equal(consumeInputs[0].nonce, 'cd'.repeat(32));
  assert.match(consumeInputs[0].grant_payload_hash, /^[0-9a-f]{64}$/);
  assert.match(consumeInputs[0].request_hash, /^[0-9a-f]{64}$/);
  assert.match(consumeInputs[0].authority_hash, /^[0-9a-f]{64}$/);
});

test('P16 replay rejection blocks P17 local mutation', async () => {
  const statePath = await tempStatePath();
  const ceremony = ceremonyFixture();
  let probes = 0;
  const result = await executeP17Activation({
    p13Evidence: p13Evidence(),
    enrollmentManifest: ceremony.enrollmentManifest,
    grant: ceremony.grant,
    supabaseStore: {
      async consumeActivationGrantNonceP16() {
        return { consumed: false, consumption_id: null };
      },
    },
    statePath,
    now: () => new Date('2026-10-24T02:05:00.000Z'),
    probeRuntime: async () => { probes += 1; return graphProbe(); },
  });

  assert.equal(result.status, 'authorized');
  assert.equal(result.grant_consumed, false);
  assert.equal(result.activation_performed, false);
  assert.equal(probes, 0);
  assert.equal(await readP17RawState({ statePath }), null);
});

test('P17 runner refuses a store without the P16 irreversible consumption capability', async () => {
  const statePath = await tempStatePath();
  const ceremony = ceremonyFixture();
  await assert.rejects(
    executeP17Activation({
      p13Evidence: p13Evidence(),
      enrollmentManifest: ceremony.enrollmentManifest,
      grant: ceremony.grant,
      supabaseStore: {},
      statePath,
      now: () => new Date('2026-10-24T02:05:00.000Z'),
      probeRuntime: async () => graphProbe(),
    }),
    /consumeActivationGrantNonceP16/,
  );
});

test('P17 production runner introduces no signer or private-key implementation', async () => {
  const source = await readFile('reference-graph/p17-activation-runner.mjs', 'utf8');
  assert.doesNotMatch(source, /generateKeyPair|private[_-]?key|createPrivateKey|\bsign\s*\(/i);
  assert.match(source, /executeP15Activation/);
  assert.match(source, /consumeActivationGrantNonceP16/);
});
