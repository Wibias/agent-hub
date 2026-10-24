import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assembleAndVerifyP18Grant,
  createP18AuthorityDescriptor,
  createP18GrantArtifacts,
  hashP18AuthorityDescriptor,
  preflightP18ProductionActivation,
} from '../../reference-graph/p18-production-ceremony.mjs';
import { applyP17LocalActivation } from '../../reference-graph/p17-local-runtime-actuator.mjs';

const P13_EVIDENCE_PATH = 'reference-graph/evidence/p13-activation-grant-authority-evidence.json';
const PROJECT_URL = 'https://vrznfnxzlxaavpqbzbzd.supabase.co';
const NOW = new Date('2026-10-24T06:01:00.000Z');

function p13Evidence() {
  return JSON.parse(readFileSync(P13_EVIDENCE_PATH, 'utf8'));
}

function ceremonyFixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const authority = createP18AuthorityDescriptor({
    publicKeySpkiDer: publicKey.export({ type: 'spki', format: 'der' }),
    authorityId: 'agent-hub-production-authority',
    keyId: 'agent-hub-production-2026-10',
  });
  const approvedAuthoritySha256 = hashP18AuthorityDescriptor(authority);
  const artifacts = createP18GrantArtifacts({
    p13Evidence: p13Evidence(),
    authority,
    approvedAuthoritySha256,
    now: new Date('2026-10-24T06:00:00.000Z'),
    nonce: '81'.repeat(32),
  });
  const signature = sign(null, Buffer.from(artifacts.canonical_payload_utf8, 'utf8'), privateKey);
  const assembled = assembleAndVerifyP18Grant({
    p13Evidence: p13Evidence(),
    authority,
    approvedAuthoritySha256,
    grantPayload: artifacts.grant_payload,
    signature,
    now: NOW,
  });
  return { authority, approvedAuthoritySha256, grant: assembled.grant };
}

async function missingStatePath() {
  const dir = await mkdtemp(join(tmpdir(), 'reference-graph-p18-preflight-'));
  return join(dir, 'activation-state-v1.json');
}

function validEnv(overrides = {}) {
  return {
    SUPABASE_URL: `${PROJECT_URL}/`,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_runtime_key',
    SUPABASE_SECRET_KEY: 'sb_secret_operator_key',
    ...overrides,
  };
}

test('P18 production preflight verifies target, external authority, current grant, credentials presence, and legacy host state', async () => {
  const ceremony = ceremonyFixture();
  const statePath = await missingStatePath();
  const result = await preflightP18ProductionActivation({
    p13Evidence: p13Evidence(),
    ...ceremony,
    env: validEnv(),
    statePath,
    now: NOW,
  });

  assert.deepEqual(result, {
    preflight_ready: true,
    target_project_ref: 'vrznfnxzlxaavpqbzbzd',
    elevated_key_type: 'secret',
    grant_verified: true,
    activation_authorized: true,
    authority_hash: ceremony.approvedAuthoritySha256,
    request_hash: ceremony.grant.request_hash,
    grant_payload_hash: result.grant_payload_hash,
    production_source: 'legacy-control',
    quick_graph_enabled: false,
    repository_default_graph_enabled: false,
  });
  assert.match(result.grant_payload_hash, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(result), /sb_secret_|sb_publishable_|signature|nonce/i);
});

test('P18 production preflight accepts legacy elevated key fallback without exposing it', async () => {
  const ceremony = ceremonyFixture();
  const statePath = await missingStatePath();
  const result = await preflightP18ProductionActivation({
    p13Evidence: p13Evidence(),
    ...ceremony,
    env: validEnv({
      SUPABASE_SECRET_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role-jwt',
    }),
    statePath,
    now: NOW,
  });
  assert.equal(result.preflight_ready, true);
  assert.equal(result.elevated_key_type, 'legacy-service-role');
  assert.equal(JSON.stringify(result).includes('legacy-service-role-jwt'), false);
});

test('P18 production preflight rejects wrong target or missing runtime/elevated credentials before activation', async () => {
  const ceremony = ceremonyFixture();
  const cases = [
    [validEnv({ SUPABASE_URL: 'https://wrong-project.supabase.co' }), /target|project/i],
    [validEnv({ SUPABASE_PUBLISHABLE_KEY: '' }), /publishable/i],
    [validEnv({ SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' }), /elevated|secret|service-role/i],
  ];
  for (const [env, pattern] of cases) {
    await assert.rejects(
      preflightP18ProductionActivation({
        p13Evidence: p13Evidence(),
        ...ceremony,
        env,
        statePath: await missingStatePath(),
        now: NOW,
      }),
      pattern,
    );
  }
});

test('P18 production preflight rejects expired signed grants and non-legacy local pre-state', async () => {
  const ceremony = ceremonyFixture();
  await assert.rejects(
    preflightP18ProductionActivation({
      p13Evidence: p13Evidence(),
      ...ceremony,
      env: validEnv(),
      statePath: await missingStatePath(),
      now: new Date('2026-10-24T06:11:00.001Z'),
    }),
    /grant|expired|verification/i,
  );

  const statePath = await missingStatePath();
  await applyP17LocalActivation({
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_value: 'graph',
    grant_payload_hash: 'a'.repeat(64),
    consumption_id: 'preflight-existing-graph',
  }, { statePath });
  await assert.rejects(
    preflightP18ProductionActivation({
      p13Evidence: p13Evidence(),
      ...ceremony,
      env: validEnv(),
      statePath,
      now: NOW,
    }),
    /legacy|pre-state|already/i,
  );
});

test('P18 preflight source has no Supabase store, RPC, nonce-consumption, or mutation dependency', async () => {
  const source = await readFile('reference-graph/p18-production-ceremony.mjs', 'utf8');
  assert.doesNotMatch(source, /ReferenceGraphSupabaseStore|consumeActivationGrantNonceP16|\.rpc\s*\(|executeP17Activation|applyP17LocalActivation/i);
});
