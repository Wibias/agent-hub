import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createP18AuthorityDescriptor,
  createP18GrantArtifacts,
  hashP18AuthorityDescriptor,
} from '../../reference-graph/p18-production-ceremony.mjs';
import { runP18ProductionActivationCli } from '../../reference-graph/cli/p18-production-activation.mjs';

const P13_EVIDENCE_PATH = 'reference-graph/evidence/p13-activation-grant-authority-evidence.json';
const PROJECT_URL = 'https://vrznfnxzlxaavpqbzbzd.supabase.co';
const NOW = new Date('2026-10-24T06:01:00.000Z');

function p13Evidence() {
  return JSON.parse(readFileSync(P13_EVIDENCE_PATH, 'utf8'));
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'reference-graph-p18-cli-'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  const authority = createP18AuthorityDescriptor({
    publicKeySpkiDer: publicDer,
    authorityId: 'agent-hub-production-authority',
    keyId: 'agent-hub-production-2026-10',
  });
  const approved = hashP18AuthorityDescriptor(authority);
  const artifacts = createP18GrantArtifacts({
    p13Evidence: p13Evidence(),
    authority,
    approvedAuthoritySha256: approved,
    now: new Date('2026-10-24T06:00:00.000Z'),
    nonce: '91'.repeat(32),
  });
  const signature = sign(null, Buffer.from(artifacts.canonical_payload_utf8, 'utf8'), privateKey);
  const paths = {
    dir,
    publicDer: join(dir, 'authority-public.der'),
    authority: join(dir, 'authority.json'),
    approval: join(dir, 'authority-approved.sha256'),
    payload: join(dir, 'grant.payload.json'),
    canonical: join(dir, 'grant.canonical.json'),
    signature: join(dir, 'grant.sig'),
    grant: join(dir, 'grant.json'),
    state: join(dir, 'activation-state-v1.json'),
  };
  await writeFile(paths.publicDer, publicDer);
  await writeFile(paths.authority, `${JSON.stringify(authority, null, 2)}\n`);
  await writeFile(paths.approval, `${approved}\n`);
  await writeFile(paths.payload, `${JSON.stringify(artifacts.grant_payload, null, 2)}\n`);
  await writeFile(paths.canonical, artifacts.canonical_payload_utf8);
  await writeFile(paths.signature, signature);
  await writeFile(paths.grant, `${JSON.stringify({ ...artifacts.grant_payload, signature_base64: signature.toString('base64') }, null, 2)}\n`);
  return { paths, authority, approved, artifacts };
}

function outputSink() {
  const chunks = [];
  return {
    write(value) { chunks.push(String(value)); },
    text() { return chunks.join(''); },
  };
}

function validEnv() {
  return {
    SUPABASE_URL: PROJECT_URL,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_runtime_key',
    SUPABASE_SECRET_KEY: 'sb_secret_operator_key',
  };
}

test('P18 CLI creates only a public authority descriptor and prints its approval hash', async () => {
  const { paths, approved } = await fixture();
  const out = outputSink();
  const target = join(paths.dir, 'authority-from-cli.json');
  const code = await runP18ProductionActivationCli({
    argv: ['--authority-descriptor', paths.publicDer, 'agent-hub-production-authority', 'agent-hub-production-2026-10', target],
    stdout: out,
  });
  assert.equal(code, 0);
  const descriptor = JSON.parse(await readFile(target, 'utf8'));
  assert.equal(descriptor.algorithm, 'Ed25519');
  assert.equal(out.text().trim(), approved);
  assert.doesNotMatch(await readFile(target, 'utf8'), /private/i);
});

test('P18 CLI prepares exact payload and canonical signing bytes only after independent approval', async () => {
  const { paths } = await fixture();
  const out = outputSink();
  const payload = join(paths.dir, 'prepared.payload.json');
  const canonical = join(paths.dir, 'prepared.canonical.json');
  const code = await runP18ProductionActivationCli({
    argv: ['--prepare-grant', paths.authority, paths.approval, payload, canonical],
    stdout: out,
    now: () => new Date('2026-10-24T06:00:00.000Z'),
    nonce: () => '92'.repeat(32),
  });
  assert.equal(code, 0);
  const payloadValue = JSON.parse(await readFile(payload, 'utf8'));
  const canonicalText = await readFile(canonical, 'utf8');
  assert.equal(payloadValue.nonce, '92'.repeat(32));
  assert.equal(payloadValue.expires_at, '2026-10-24T06:10:00.000Z');
  assert.deepEqual(JSON.parse(canonicalText), payloadValue);
  assert.match(out.text(), /^[0-9a-f]{64}\s*$/);
});

test('P18 CLI assembles and verifies a raw external signature before writing a grant', async () => {
  const { paths } = await fixture();
  const out = outputSink();
  const code = await runP18ProductionActivationCli({
    argv: ['--assemble-grant', paths.authority, paths.approval, paths.payload, paths.signature, paths.grant],
    stdout: out,
    now: () => NOW,
  });
  assert.equal(code, 0);
  const grant = JSON.parse(await readFile(paths.grant, 'utf8'));
  assert.match(grant.signature_base64, /^[A-Za-z0-9+/]+=*$/);
  assert.deepEqual(JSON.parse(out.text()), {
    grant_verified: true,
    activation_authorized: true,
    activation_performed: false,
  });
});

test('P18 CLI preflight is read-only and prints only the secret-free preflight receipt', async () => {
  const { paths } = await fixture();
  await runP18ProductionActivationCli({
    argv: ['--assemble-grant', paths.authority, paths.approval, paths.payload, paths.signature, paths.grant],
    stdout: outputSink(),
    now: () => NOW,
  });
  const out = outputSink();
  const code = await runP18ProductionActivationCli({
    argv: ['--preflight', paths.authority, paths.approval, paths.grant],
    env: validEnv(),
    stdout: out,
    statePath: paths.state,
    now: () => NOW,
  });
  assert.equal(code, 0);
  const receipt = JSON.parse(out.text());
  assert.equal(receipt.preflight_ready, true);
  assert.equal(receipt.production_source, 'legacy-control');
  assert.equal(receipt.target_project_ref, 'vrznfnxzlxaavpqbzbzd');
  assert.doesNotMatch(out.text(), /sb_secret_|sb_publishable_|signature_base64|nonce/i);
});

test('P18 CLI rejects any activation token except the exact production confirmation before creating a store', async () => {
  const { paths } = await fixture();
  let stores = 0;
  let activations = 0;
  await assert.rejects(
    runP18ProductionActivationCli({
      argv: ['--activate-production', paths.authority, paths.approval, paths.grant, 'yes-really-activate'],
      env: validEnv(),
      stdout: outputSink(),
      createStore() { stores += 1; return {}; },
      executeActivation: async () => { activations += 1; return {}; },
    }),
    /ACTIVATE-QUICK-REFERENCE-GRAPH|confirmation/i,
  );
  assert.equal(stores, 0);
  assert.equal(activations, 0);
});

test('P18 CLI activates only after preflight, creates the elevated store afterward, and emits an allowlisted receipt', async () => {
  const { paths, authority, approved } = await fixture();
  const events = [];
  const out = outputSink();
  const fakeStore = { consumeActivationGrantNonceP16: async () => ({ consumed: true, consumption_id: 'hidden' }) };
  const code = await runP18ProductionActivationCli({
    argv: ['--activate-production', paths.authority, paths.approval, paths.grant, 'ACTIVATE-QUICK-REFERENCE-GRAPH'],
    env: validEnv(),
    stdout: out,
    statePath: paths.state,
    now: () => NOW,
    preflight: async (input) => {
      events.push('preflight');
      assert.equal(input.approvedAuthoritySha256, approved);
      assert.deepEqual(input.authority, authority);
      return { preflight_ready: true };
    },
    createStore(env) {
      events.push('store');
      assert.equal(env.SUPABASE_SECRET_KEY, 'sb_secret_operator_key');
      return fakeStore;
    },
    executeActivation: async (input) => {
      events.push('activate');
      assert.equal(input.supabaseStore, fakeStore);
      return {
        status: 'activated',
        grant_verified: true,
        activation_authorized: true,
        grant_consumed: true,
        consumption_id: 'must-not-print',
        activation_performed: true,
        activation_change_id: 'must-not-print',
        rollback_performed: false,
        rollback_verified: false,
        production_source: 'reference-graph',
        retry_requires_new_grant: true,
        request_hash: 'a'.repeat(64),
        authority_hash: approved,
        grant_payload_hash: 'b'.repeat(64),
        blocker: null,
        grant_nonce: 'c'.repeat(64),
      };
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(events, ['preflight', 'store', 'activate']);
  assert.deepEqual(JSON.parse(out.text()), {
    status: 'activated',
    grant_verified: true,
    activation_authorized: true,
    grant_consumed: true,
    activation_performed: true,
    rollback_performed: false,
    rollback_verified: false,
    production_source: 'reference-graph',
    retry_requires_new_grant: true,
    request_hash: 'a'.repeat(64),
    authority_hash: approved,
    grant_payload_hash: 'b'.repeat(64),
    blocker: null,
  });
  assert.doesNotMatch(out.text(), /must-not-print|consumption_id|activation_change_id|grant_nonce|sb_secret_/i);
});

test('P18 CLI status reads local state only and does not require credentials', async () => {
  const { paths } = await fixture();
  const out = outputSink();
  const code = await runP18ProductionActivationCli({
    argv: ['--status'],
    env: {},
    stdout: out,
    statePath: paths.state,
  });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out.text()), {
    production_source: 'legacy-control',
    quick_graph_enabled: false,
    repository_default_graph_enabled: false,
  });
});

test('P18 production CLI has no signer/private-key API or secret CLI flag', async () => {
  const source = await readFile('reference-graph/cli/p18-production-activation.mjs', 'utf8');
  assert.doesNotMatch(source, /generateKeyPair|createPrivateKey|private[_-]?key|\bsign\s*\(/i);
  assert.doesNotMatch(source, /--(?:secret|service-role|publishable)-?(?:key)?/i);
  assert.match(source, /ReferenceGraphSupabaseStore\.fromEnv/);
  assert.match(source, /executeP17Activation/);
  assert.match(source, /ACTIVATE-QUICK-REFERENCE-GRAPH/);
});

test('P18 runbook keeps private-key custody outside .agents and uses OpenSSL raw Ed25519 signing', async () => {
  const source = await readFile('reference-graph/P18.md', 'utf8');
  assert.match(source, /\.agent-hub-authority/);
  assert.match(source, /genpkey.*ED25519/i);
  assert.match(source, /aes-256/i);
  assert.match(source, /pkey.*-pubout.*-outform DER/i);
  assert.match(source, /pkeyutl.*-sign.*-rawin/i);
  assert.match(source, /ACTIVATE-QUICK-REFERENCE-GRAPH/);
  assert.match(source, /SUPABASE_SECRET_KEY/);
  assert.match(source, /legacy.*SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY.*legacy/i);
  assert.match(source, /Quick.*reference-graph/i);
  assert.match(source, /Standard.*legacy-control/i);
  assert.match(source, /Deep.*legacy-control/i);
});
