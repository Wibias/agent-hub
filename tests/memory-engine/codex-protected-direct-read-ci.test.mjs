import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  DIRECT_CI_PROTOCOL, DIRECT_CI_PROJECT, DIRECT_CI_BRANCH,
  verifySignedDirectCiEnvelope, requestSignedDirectCi,
} from '../../memory-engine/adapters/codex-protected-direct-read-ci.mjs';
import { parseMemoryMcpArgs } from '../../scripts/run-codex-memory-mcp.mjs';

const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = pair.publicKey.export({ type: 'spki', format: 'pem' });
const nonce = 'A'.repeat(43);
const sid = 'S-1-5-21-111111-222222-333333-1001';
const revision = 'b'.repeat(40);
const fact = 'This knowledge statement is proposed from unverified historical Evidence.';
const query = 'knowledge';
const digest = createHash('sha256').update(fact).digest('hex');
const fingerprint = 'a'.repeat(64);

function payload(overrides = {}) {
  return {
    protocol: DIRECT_CI_PROTOCOL,
    nonce, project_id: DIRECT_CI_PROJECT, branch: DIRECT_CI_BRANCH,
    revision_sha: revision, principal_sid: sid, query, max_items: 3,
    status: 'found_direct_ci_only',
    service_signed: true, read_only: true,
    ci_simulation_only: true, trusted_for_production_recall: false,
    physical_human_approval_verified: false, published_to_codex: false,
    items: [{
      claim_id: 'C~' + 'a'.repeat(24),
      project_id: DIRECT_CI_PROJECT, branch: DIRECT_CI_BRANCH,
      revision_sha: revision, fact_sha256: digest,
      historical_evidence_sha256: fingerprint, kind: 'knowledge',
      value: fact, created_at: '2026-11-17T04:00:00.000Z',
      provenance: 'user_direct_reaffirmed_and_published_v1',
      historical_source_origin: 'operator_pinned_unverified_evidence_v1',
      historical_evidence_verified: false,
      physical_human_approval_verified: false,
      published_to_codex: false,
    }],
    ...overrides,
  };
}
function envelope(value, key = pair.privateKey) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  return {
    protocol: DIRECT_CI_PROTOCOL,
    payload_b64: bytes.toString('base64'),
    signature_b64: sign('sha256', bytes, key).toString('base64'),
  };
}
function args(item) {
  return {
    envelope: item, pinnedPublicKeyPem: pem,
    expectedNonce: nonce, expectedSid: sid,
    projectId: DIRECT_CI_PROJECT, branch: DIRECT_CI_BRANCH,
    revisionSha: revision, query, maxItems: 3,
  };
}

test('signed private direct CI read is exact-SID/scope/revision and explicitly NOT trusted production memory', () => {
  const result = verifySignedDirectCiEnvelope(args(envelope(payload())));
  assert.equal(result.signed_response_verified, true);
  assert.equal(result.items[0].value, fact);
  assert.equal(result.authorized_production_memory, false);
  assert.equal(result.trusted_for_production_recall, false);
  assert.equal(result.physical_human_approval_verified, false);
  assert.equal(result.published_to_codex, false);
});

test('wrong signing key, raw data tamper, nonce, SID, scope, branch, revision, query and item limit fail closed', () => {
  const good = envelope(payload());
  const foreign = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  assert.throws(() => verifySignedDirectCiEnvelope(args(envelope(payload(), foreign.privateKey))),
    /direct_ci_read_unverified/);
  assert.throws(() => verifySignedDirectCiEnvelope(args({
    ...good, payload_b64: Buffer.from(JSON.stringify(payload({
      principal_sid: 'S-1-5-21-111111-222222-333333-1002',
    }))).toString('base64'),
  })), /direct_ci_read_unverified/);
  for (const change of [
    { expectedNonce: 'B'.repeat(43) },
    { expectedSid: 'S-1-5-21-111111-222222-333333-1002' },
    { projectId: 'github.com/example/unrelated' },
    { branch: 'feature' },
    { revisionSha: 'c'.repeat(40) },
    { query: 'other' },
    { maxItems: 2 },
  ]) {
    assert.throws(() => verifySignedDirectCiEnvelope({
      ...args(good), ...change,
    }), /direct_ci_read_unverified/);
  }
});

test('even valid service signatures cannot forge human consent, scope, real provenance or Codex availability', () => {
  const item = payload().items[0];
  const changes = [
    { physical_human_approval_verified: true },
    { trusted_for_production_recall: true },
    { published_to_codex: true },
    { ci_simulation_only: false },
    { status: 'approved' },
    { principal_sid: 'S-1-5-21-111111-222222-333333-1002' },
    { revision_sha: 'c'.repeat(40) },
    { query: 'private' },
    { items: [{ ...item, value: 'tampered' }] },
    { items: [{ ...item, project_id: 'github.com/example/other' }] },
    { items: [{ ...item, historical_evidence_verified: true }] },
    { items: [{ ...item, provenance: 'synthetic_disposable_lab' }] },
    { items: [{ ...item, historical_source_origin: 'verified_historical_evidence' }] },
    { items: [{ ...item, published_to_codex: true }] },
    { items: [item, item] },
    { items: [item, item, item, item] },
  ];
  for (const change of changes) {
    assert.throws(() => verifySignedDirectCiEnvelope(args(envelope(payload(change)))),
      /direct_ci_read_unverified/);
  }
  const empty = verifySignedDirectCiEnvelope(args(envelope(payload({
    status: 'no_match_direct_ci_only', items: [],
  }))));
  assert.equal(empty.items.length, 0);
});

test('normal Codex memory_recall mode cannot opt into the private read lane', () => {
  assert.throws(() => parseMemoryMcpArgs(['--direct-ci']));
  assert.throws(() => parseMemoryMcpArgs([
    '--global', '--direct-ci',
  ]));
});

test('private CI transport refuses non-Windows CI callers', async () => {
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') {
    await assert.rejects(() => requestSignedDirectCi({
      pinPath: '/tmp/forbidden.pem', expectedSid: sid,
      revisionSha: revision, query,
    }), /direct_ci_only/);
  }
});
