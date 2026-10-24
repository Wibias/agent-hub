import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { hashP13AuthorityDescriptor } from '../../reference-graph/p13-activation-grant-authority.mjs';

const CLI = 'reference-graph/cli/p14-authority-enrollment-grant.mjs';

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const authority = {
    schema_version: 'reference-graph.p13-ed25519-authority.v1',
    authority_id: 'p14-operator-test-authority',
    key_id: 'p14-operator-test-key',
    algorithm: 'Ed25519',
    public_key_spki_base64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  return { authority, privateKey, approved: hashP13AuthorityDescriptor(authority) };
}

test('plan remains ceremony-only while repository verification reports later schema evolution', () => {
  const plan = run(['--plan']);
  assert.equal(plan.status, 0, plan.stderr);
  const p = JSON.parse(plan.stdout);
  assert.equal(p.authority_state, 'awaiting-external-enrollment');
  assert.equal(p.activation_authorized, false);
  assert.equal(p.activation_performed, false);
  assert.equal(p.production_source, 'legacy-control');
  assert.equal(p.private_key_custody, 'external');
  assert.equal(p.allowed_modes.some((mode) => /--(?:sign|activate|deploy|set-env)/.test(mode)), false);

  const verify = run(['--verify-repository']);
  assert.equal(verify.status, 0, verify.stderr);
  const v = JSON.parse(verify.stdout);
  assert.equal(v.repository.p13_evidence_bytes, true);
  assert.equal(v.repository.private_key_or_signing_path, false);
  assert.equal(v.repository.activation_mutation_path, false);
  assert.equal(v.repository.supabase_mutation_path, false);
  assert.equal(v.repository.migration_010_or_later_present, true);
});

test('enrollment and unsigned payload require the independent approved authority hash', () => {
  const { authority, approved } = fixture();
  const dir = mkdtempSync(join(tmpdir(), 'p14-operator-enroll-'));
  try {
    const authorityPath = join(dir, 'authority.json');
    writeFileSync(authorityPath, JSON.stringify(authority));
    const enrolled = run(['--enrollment-manifest', authorityPath, approved]);
    assert.equal(enrolled.status, 0, enrolled.stderr);
    const manifest = JSON.parse(enrolled.stdout);
    assert.equal(manifest.approved_authority_sha256, approved);
    assert.equal(manifest.private_key_present, false);

    const payload = run([
      '--emit-grant-payload', authorityPath, approved,
      '2026-10-24T02:00:00.000Z', '2026-10-24T02:00:00.000Z', '2026-10-24T02:15:00.000Z', 'ab'.repeat(32),
    ]);
    assert.equal(payload.status, 0, payload.stderr);
    const out = JSON.parse(payload.stdout);
    assert.equal(out.grant_payload.issuer, authority.authority_id);
    assert.match(out.payload_sha256, /^[0-9a-f]{64}$/);
    assert.equal('signature_base64' in out.grant_payload, false);

    const bad = run(['--enrollment-manifest', authorityPath, '0'.repeat(64)]);
    assert.notEqual(bad.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('externally signed grant can authorize but operator never activates it', () => {
  const { authority, privateKey, approved } = fixture();
  const dir = mkdtempSync(join(tmpdir(), 'p14-operator-grant-'));
  try {
    const authorityPath = join(dir, 'authority.json');
    const grantPath = join(dir, 'grant.json');
    writeFileSync(authorityPath, JSON.stringify(authority));
    const payloadRun = run([
      '--emit-grant-payload', authorityPath, approved,
      '2026-10-24T02:00:00.000Z', '2026-10-24T02:00:00.000Z', '2026-10-24T02:15:00.000Z', 'cd'.repeat(32),
    ]);
    assert.equal(payloadRun.status, 0, payloadRun.stderr);
    const payload = JSON.parse(payloadRun.stdout).grant_payload;
    const grant = {
      ...payload,
      signature_base64: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
    };
    writeFileSync(grantPath, JSON.stringify(grant));

    const verified = run(['--verify-signed-grant', authorityPath, approved, grantPath, '2026-10-24T02:05:00.000Z']);
    assert.equal(verified.status, 0, verified.stderr);
    const value = JSON.parse(verified.stdout);
    assert.equal(value.grantVerified, true);
    assert.equal(value.activationAuthorized, true);
    assert.equal(value.activationPerformed, false);
    assert.equal(value.productionSource, 'legacy-control');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('historical P14 repository finalization fails closed after a later migration is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p14-finalize-'));
  try {
    const snapshot = join(dir, 'snapshot.json');
    writeFileSync(snapshot, JSON.stringify({
      git_sha: 'e'.repeat(40),
      verification_at: '2026-10-24T02:30:00.000Z',
      reference_time: '2026-10-24T02:30:00.000Z',
    }));
    const result = run(['--finalize-repository', snapshot]);
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.ceremony_ready, false);
    assert.equal(value.authority_state, 'awaiting-external-enrollment');
    assert.equal(value.grant_state, 'not-issued');
    assert.equal(value.activation_authorized, false);
    assert.equal(value.activation_performed, false);
    assert.equal(value.production_source, 'legacy-control');
    assert.match(value.blockers.join('\n'), /activation_boundary|no_activation_path|not successful/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('signing, activation, deployment, and malformed modes are rejected', () => {
  for (const args of [[], ['--sign'], ['--activate'], ['--apply'], ['--deploy'], ['--set-env']]) {
    const result = run(args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.match(result.stderr, /supported|read-only|ceremony/i);
  }
});
