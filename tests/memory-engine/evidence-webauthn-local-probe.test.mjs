import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  EvidenceWebAuthnLocalProbe, computeEvidenceWebAuthnProbeChallenge,
} from '../../memory-engine/evidence-webauthn-local-probe.mjs';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { EvidenceBoundProposalStore } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import { evidenceExtractionFingerprint } from '../../memory-engine/evidence-bound-extraction.mjs';
import { memoryEvidenceReviewSnapshot } from '../../memory-engine/evidence-bound-review-readonly.mjs';
import { createMemoryUiServer, parseMemoryUiArgs } from '../../scripts/memory-ui.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const fact = 'A real scoped E~ proposal needs deliberate review.';
const meaning = Object.freeze({
  projectId: 'github.com/example/evidence-review',
  branch: 'preview',
  revisionSha: 'a'.repeat(40),
  proposalRef: 'E~0123456789',
  reviewSnapshotSha256: 'b'.repeat(64),
  canonicalFactSha256: hash(fact),
  canonicalFact: fact,
  decision: 'confirm',
});
const origin = 'http://localhost:4317';
const b64 = input => Buffer.from(input).toString('base64url');

function harness() {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const probe = new EvidenceWebAuthnLocalProbe();
  const enrollment = probe.begin({ meaning, origin, blockers: ['relation_requires_review'] });
  const signedClient = (challenge, type, atOrigin = origin) => b64(JSON.stringify({
    type, challenge, origin: atOrigin, crossOrigin: false,
  }));
  const register = () => probe.enroll({
    sessionId: enrollment.sessionId,
    credentialId: b64('webauthn-test-credential-1'),
    publicKeySpki: b64(keys.publicKey.export({ format: 'der', type: 'spki' })),
    clientDataJSON: signedClient(enrollment.publicKey.challenge, 'webauthn.create'),
  });
  function assertion({ uv = true, atOrigin = origin } = {}) {
    const challenge = probe.challenge({ sessionId: enrollment.sessionId });
    const client = Buffer.from(JSON.stringify({
      type: 'webauthn.get', origin: atOrigin,
      challenge: challenge.publicKey.challenge, crossOrigin: false,
    }));
    const auth = Buffer.alloc(37);
    createHash('sha256').update('localhost').digest().copy(auth);
    auth[32] = uv ? 0x05 : 0x01;
    auth.writeUInt32BE(1, 33);
    const signed = Buffer.concat([auth, createHash('sha256').update(client).digest()]);
    return {
      sessionId: enrollment.sessionId,
      credentialId: b64('webauthn-test-credential-1'),
      clientDataJSON: b64(client),
      authenticatorData: b64(auth),
      signature: b64(sign('sha256', signed, keys.privateKey)),
      freshMeaning: { ...meaning },
    };
  }
  return { probe, enrollment, register, assertion };
}

test('exact challenge is bound to project, action, E~ ref, snapshot and fact digest', () => {
  const nonce = Buffer.alloc(32, 0x42);
  const expected = createHash('sha256').update(JSON.stringify([
    'agenthub-evidence-bound-uv-v1', meaning.projectId, meaning.branch,
    meaning.revisionSha, meaning.proposalRef, meaning.reviewSnapshotSha256,
    meaning.canonicalFactSha256, meaning.decision,
  ])).update(Buffer.from([0])).update(nonce).digest('base64url');
  assert.equal(computeEvidenceWebAuthnProbeChallenge(meaning, nonce), expected);
  assert.notEqual(computeEvidenceWebAuthnProbeChallenge({
    ...meaning, decision: 'reject',
  }, nonce), expected);
  assert.notEqual(computeEvidenceWebAuthnProbeChallenge({
    ...meaning, reviewSnapshotSha256: 'c'.repeat(64),
  }, nonce), expected);
});

test('ephemeral browser WebAuthn create/get verifies UV but never approves a Claim', async () => {
  const h = harness();
  assert.equal(h.enrollment.meaning.canonicalFact, fact);
  assert.deepEqual(h.enrollment.blockers, ['relation_requires_review']);
  assert.equal(h.register().humanApprovalVerified, false);
  const signedAssertion = h.assertion();
  const response = await h.probe.finish(signedAssertion);
  assert.equal(response.status, 'browser_webauthn_uv_observed_not_approved');
  assert.equal(response.browserUserVerificationObserved, true);
  assert.equal(response.humanApprovalVerified, false);
  assert.equal(response.protectedApproval, false);
  assert.equal(response.claimWritten, false);
  assert.equal(response.claimsCreated, 0);
  await assert.rejects(h.probe.finish(signedAssertion), /consumed/);
});

test('invalid signature consumes the assertion and cannot be retried', async () => {
  const h = harness();
  h.register();
  const attack = h.assertion();
  attack.signature = b64(Buffer.alloc(70, 0xaa));
  assert.equal((await h.probe.finish(attack)).status, 'probe_signature_invalid');
  await assert.rejects(h.probe.finish(attack), /consumed/);
});

test('wrong localhost origin, missing UV and changed snapshot fail closed', async () => {
  const originAttack = harness();
  originAttack.register();
  assert.equal((await originAttack.probe.finish(originAttack.assertion({
    atOrigin: 'http://example.invalid:4317',
  }))).status, 'probe_invalid_assertion');
  const missingUv = harness();
  missingUv.register();
  assert.equal((await missingUv.probe.finish(missingUv.assertion({ uv: false })))
    .status, 'probe_authenticator_flags_or_origin_invalid');
  const stale = harness();
  stale.register();
  const assertion = stale.assertion();
  assertion.freshMeaning.reviewSnapshotSha256 = 'e'.repeat(64);
  assert.equal((await stale.probe.finish(assertion)).status, 'probe_evidence_changed');
});

test('no fabricated fact, wrong RP host, or reuse of registration is accepted', () => {
  const h = harness();
  assert.throws(() => h.probe.begin({
    meaning: { ...meaning, canonicalFact: 'forged' }, origin,
  }), /meaning/);
  assert.throws(() => h.probe.begin({
    meaning, origin: 'http://127.0.0.1:4317',
  }), /localhost/);
  h.register();
  assert.throws(() => h.register(), /consumed/);
});

test('real Console HTTP prepares an actual E~ only in explicitly enabled localhost mode', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agenthub-webauthn-git-'));
  const repo = join(root, 'repository');
  const dbPath = join(root, 'memory.sqlite3');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init', '-b', 'preview');
  git('config', 'user.name', 'WebAuthn Probe Test');
  git('config', 'user.email', 'webauthn-probe@example.test');
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', 'https://github.com/example/evidence-review.git');
  writeFileSync(join(repo, 'README.md'), 'WebAuthn test.');
  git('add', 'README.md');
  git('commit', '-m', 'webAuthn fixture');
  const revision = git('rev-parse', 'HEAD');

  const memory = new MemoryEngine({ dbPath });
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    memory.close();
    rmSync(root, { recursive: true, force: true });
  });
  memory.registerProject({
    projectId: meaning.projectId, repoIdentity: meaning.projectId,
  });
  memory.recordEvidence({
    id: 'e-webauthn', projectId: meaning.projectId,
    harness: 'codex', sessionId: 'test-session',
    sourceKind: 'session', sourceRef: 'session:test-session',
    capturedAt: '2026-11-14T11:00:00.000Z', branch: 'preview',
    content: fact, authorityClass: 'user_direct',
    metadata: { event_type: 'user_prompt' },
  });
  const store = new EvidenceBoundProposalStore({
    dbPath, inspectTextSensitivity: () => ({ containsSecret: false }),
  });
  const proposal = store.record({
    id: 'local-probe-proposal', projectId: meaning.projectId,
    branch: 'preview', kind: 'knowledge', canonicalFact: fact,
    evidenceIds: ['e-webauthn'],
    fingerprint: evidenceExtractionFingerprint({ kind: 'knowledge', canonicalFact: fact }),
    policyVersion: 'test-extraction', evaluatorId: 'test-judge',
    createdAt: '2026-11-14T11:00:10.000Z',
  });
  store.close();
  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE memory_evidence_proposals SET status='needs_confirmation' WHERE id=?")
    .run(proposal.id);
  db.close();

  const initial = memory.exportCanonical();
  const before = memoryEvidenceReviewSnapshot({
    dbPath, projectId: meaning.projectId, branch: 'preview',
  });
  const ref = before.items[0].ref;
  const disabled = createMemoryUiServer({
    dbPath, memory, repositoryRoots: [repo], includeRuntimeHealth: false,
  });
  server = disabled.server;
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const disabledPort = server.address().port;
  const disabledApi = await fetch(
    'http://127.0.0.1:' + disabledPort + '/api/webauthn-probe/prepare',
    { headers: { Host: 'localhost:' + disabledPort } },
  );
  assert.equal(disabledApi.status, 404);
  await new Promise(done => server.close(done));
  server = null;
  const runtime = createMemoryUiServer({
    dbPath, memory, repositoryRoots: [repo],
    includeRuntimeHealth: false, webauthnProbe: true,
  });
  server = runtime.server;
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;
  const headers = { Host: 'localhost:' + port };
  const overview = await (await fetch(base + '/api/overview', {
    headers,
  })).json();
  assert.equal(overview.webauthnProbe.enabled, true);
  const query = new URLSearchParams({
    projectId: meaning.projectId, branch: 'preview',
    proposalRef: ref, decision: 'confirm',
  });
  const res = await fetch(base + '/api/webauthn-probe/prepare?' + query, { headers });
  assert.equal(res.status, 200);
  const prepared = await res.json();
  assert.equal(prepared.meaning.proposalRef, ref);
  assert.equal(prepared.meaning.revisionSha, revision);
  assert.equal(prepared.meaning.canonicalFact, fact);
  assert.equal(prepared.claimWritten, false);
  assert.equal(prepared.reviewAuthorityEstablished, false);
  const post = await fetch(base + '/api/webauthn-probe/challenge', {
    method: 'POST', headers: { ...headers,
      Origin: 'http://example.invalid:4317', 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: prepared.sessionId }),
  });
  assert.equal(post.status, 403);
  git('checkout', '-b', 'wrong-branch');
  const stale = await fetch(base + '/api/webauthn-probe/prepare?' + query, { headers });
  assert.equal(stale.status, 409);
  assert.deepEqual(memory.exportCanonical(), initial);
  const unchanged = memoryEvidenceReviewSnapshot({
    dbPath, projectId: meaning.projectId, branch: 'preview',
  });
  assert.equal(unchanged.total, before.total);
  assert.equal(unchanged.items[0].status, 'needs_confirmation');
});

test('operator CLI switch is default OFF unless explicitly selected', () => {
  assert.equal(parseMemoryUiArgs([]).webauthnProbe, false);
  assert.equal(parseMemoryUiArgs(['--webauthn-probe']).webauthnProbe, true);
});
