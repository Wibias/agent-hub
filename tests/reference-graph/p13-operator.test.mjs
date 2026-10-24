import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  hashP13AuthorityDescriptor,
  hashP13GrantRequest,
} from '../../reference-graph/p13-activation-grant-authority.mjs';

const ROOT = process.cwd();
const CLI = 'reference-graph/cli/p13-activation-grant-authority.mjs';
const P12_HEAD = '5f676c806ae864b507723ea867f5e3afd6fd4adb';
const P12_BINDING_HASH = '68930447847df8d31de01b7fb60049136ae6fd0d74c837283fb837ff7e79961b';

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function ephemeralGrant(request) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const authority = {
    schema_version: 'reference-graph.p13-ed25519-authority.v1',
    authority_id: 'ephemeral-test-authority',
    key_id: 'ephemeral-key-1',
    algorithm: 'Ed25519',
    public_key_spki_base64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  const payload = {
    schema_version: 'reference-graph.p13-activation-grant.v1',
    request_hash: hashP13GrantRequest(request),
    p12_evidence_head: P12_HEAD,
    p12_binding_hash: P12_BINDING_HASH,
    target: request.target,
    profile: 'quick',
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_value: 'graph',
    issuer: authority.authority_id,
    key_id: authority.key_id,
    issued_at: '2026-10-24T02:00:00.000Z',
    not_before: '2026-10-24T02:00:00.000Z',
    expires_at: '2026-10-24T02:15:00.000Z',
    nonce: 'cd'.repeat(32),
    signature_algorithm: 'Ed25519',
  };
  return {
    authority,
    trusted: hashP13AuthorityDescriptor(authority),
    grant: {
      ...payload,
      signature_base64: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
    },
  };
}

test('P13 plan and request modes are read-only and bind the exact P12 authority boundary', () => {
  const plan = run(['--plan']);
  assert.equal(plan.status, 0, plan.stderr);
  const planValue = JSON.parse(plan.stdout);
  assert.equal(planValue.p12_evidence_head, P12_HEAD);
  assert.equal(planValue.p12_binding_hash, P12_BINDING_HASH);
  assert.equal(planValue.authority_state, 'unconfigured');
  assert.equal(planValue.grant_state, 'not-issued');
  assert.equal(planValue.activation_authorized, false);
  assert.equal(planValue.activation_performed, false);
  assert.equal(planValue.production_source, 'legacy-control');
  assert.equal(planValue.allowed_modes.some((mode) => /activate|apply|deploy|sign|issue|set-env/i.test(mode)), false);

  const emitted = run(['--emit-request']);
  assert.equal(emitted.status, 0, emitted.stderr);
  const emittedValue = JSON.parse(emitted.stdout);
  assert.equal(emittedValue.grant_request.p12_evidence_head, P12_HEAD);
  assert.equal(emittedValue.grant_request.p12_binding_hash, P12_BINDING_HASH);
  assert.match(emittedValue.grant_request.p12_evidence_sha256, /^[0-9a-f]{64}$/);
  assert.equal(emittedValue.request_hash, hashP13GrantRequest(emittedValue.grant_request));
  assert.equal(emittedValue.activation_authorized, false);
});

test('repository verification recomputes P12 evidence bytes and preserves graph-off defaults', () => {
  const result = run(['--verify-repository']);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.repository.p12_evidence_contract, true);
  assert.match(value.repository.p12_evidence_sha256, /^[0-9a-f]{64}$/);
  assert.equal(value.grant_request.p12_evidence_sha256, value.repository.p12_evidence_sha256);
  assert.equal(value.repository.repository_default_graph_enabled, false);
  assert.equal(value.repository.migration_010_or_later_present, false);
  assert.equal(value.repository.signing_private_key_path, false);
  assert.equal(value.repository.activation_mutation_path, false);
  assert.equal(value.repository.supabase_mutation_path, false);
  assert.equal(value.activation_authorized, false);
  assert.equal(value.production_source, 'legacy-control');
});

test('verify-grant can authenticate an exact ephemeral grant without authorizing or performing activation', () => {
  const requestResult = run(['--emit-request']);
  assert.equal(requestResult.status, 0, requestResult.stderr);
  const request = JSON.parse(requestResult.stdout).grant_request;
  const fixture = ephemeralGrant(request);
  const dir = mkdtempSync(join(tmpdir(), 'p13-grant-'));
  try {
    const grantPath = join(dir, 'grant.json');
    const authorityPath = join(dir, 'authority.json');
    writeFileSync(grantPath, JSON.stringify(fixture.grant));
    writeFileSync(authorityPath, JSON.stringify(fixture.authority));

    const valid = run([
      '--verify-grant',
      grantPath,
      authorityPath,
      fixture.trusted,
      '2026-10-24T02:05:00.000Z',
    ]);
    assert.equal(valid.status, 0, valid.stderr);
    const validValue = JSON.parse(valid.stdout);
    assert.equal(validValue.grant_verified, true, JSON.stringify(validValue));
    assert.equal(validValue.activation_authorized, false);
    assert.equal(validValue.activation_performed, false);
    assert.equal(validValue.repository_default_graph_enabled, false);
    assert.equal(validValue.production_source, 'legacy-control');

    const untrusted = run([
      '--verify-grant',
      grantPath,
      authorityPath,
      '',
      '2026-10-24T02:05:00.000Z',
    ]);
    assert.equal(untrusted.status, 0, untrusted.stderr);
    const untrustedValue = JSON.parse(untrusted.stdout);
    assert.equal(untrustedValue.grant_verified, false);
    assert.match(untrustedValue.blockers.join('\n'), /trusted authority/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repository finalization emits infrastructure-ready evidence while production authority remains absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p13-finalize-'));
  try {
    const snapshot = join(dir, 'snapshot.json');
    writeFileSync(snapshot, JSON.stringify({
      git_sha: 'e'.repeat(40),
      verification_at: '2026-10-24T02:20:00.000Z',
      reference_time: '2026-10-24T02:20:00.000Z',
    }));
    const result = run(['--finalize-repository', snapshot]);
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.infrastructure_ready, true, JSON.stringify(value.blockers));
    assert.equal(value.authority_state, 'unconfigured');
    assert.equal(value.trusted_authority_sha256, null);
    assert.equal(value.grant_state, 'not-issued');
    assert.equal(value.grant_verified, false);
    assert.equal(value.activation_authorized, false);
    assert.equal(value.activation_performed, false);
    assert.equal(value.repository_default_graph_enabled, false);
    assert.equal(value.production_source, 'legacy-control');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-grant rejects non-canonical verification time', () => {
  const requestResult = run(['--emit-request']);
  assert.equal(requestResult.status, 0, requestResult.stderr);
  const request = JSON.parse(requestResult.stdout).grant_request;
  const fixture = ephemeralGrant(request);
  const dir = mkdtempSync(join(tmpdir(), 'p13-time-'));
  try {
    const grantPath = join(dir, 'grant.json');
    const authorityPath = join(dir, 'authority.json');
    writeFileSync(grantPath, JSON.stringify(fixture.grant));
    writeFileSync(authorityPath, JSON.stringify(fixture.authority));
    const result = run([
      '--verify-grant',
      grantPath,
      authorityPath,
      fixture.trusted,
      '2026-10-24T04:05:00+02:00',
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /canonical UTC ISO timestamp/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('activation-like or malformed modes are rejected', () => {
  for (const args of [[], ['--activate'], ['--sign'], ['--issue'], ['--deploy'], ['--set-env']]) {
    const result = run(args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.match(result.stderr, /read-only mode|supported/i);
  }
});
