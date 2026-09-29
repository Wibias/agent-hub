import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';

async function createEngine(clock = () => '2026-01-11T10:00:00Z') {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-approval-'));
  const engine = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3'), clock });
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  engine.registerProject({ projectId: 'project-b', repoIdentity: 'project-b' });
  return engine;
}

function ingestEvidence(engine, {
  evidenceId = 'e-user',
  projectId = 'project-a',
  authorityClass = 'user_direct',
  content = 'Approved: deploy build 42 to staging once today.',
} = {}) {
  return engine.ingest({
    evidence: {
      id: evidenceId,
      projectId,
      harness: 'codex',
      sessionId: 'S1',
      sourceKind: authorityClass === 'user_direct' ? 'session' : 'agent',
      sourceRef: authorityClass === 'user_direct' ? 'session:S1' : 'agent:S1',
      capturedAt: '2026-01-11T09:00:00Z',
      branch: 'main',
      commitSha: null,
      path: null,
      blobOid: null,
      content,
      authorityClass,
      metadata: {},
    },
    claim: {
      id: `claim:${evidenceId}`,
      kind: 'approval',
      subject: 'deployment approval',
      predicate: 'states',
      value: content,
      branchScope: 'main',
      createdAt: '2026-01-11T09:00:00Z',
    },
  });
}

function recordApproval(engine, overrides = {}) {
  return engine.recordApproval({
    id: 'approval-1',
    projectId: 'project-a',
    action: 'deploy',
    target: 'build-42',
    environment: 'staging',
    issuedAt: '2026-01-11T09:00:00Z',
    expiresAt: '2026-01-11T23:59:59Z',
    maxUses: 1,
    sourceEvidenceId: 'e-user',
    ...overrides,
  });
}

test('only user-direct evidence can mint an action approval', async (t) => {
  const engine = await createEngine();
  t.after(() => engine.close());

  ingestEvidence(engine, {
    evidenceId: 'e-agent',
    authorityClass: 'agent_inference',
    content: 'I think deploying build 42 to production is fine.',
  });

  assert.throws(
    () => engine.recordApproval({
      id: 'approval-agent',
      projectId: 'project-a',
      action: 'deploy',
      target: 'build-42',
      environment: 'production',
      issuedAt: '2026-01-11T09:00:00Z',
      expiresAt: '2026-01-11T23:59:59Z',
      maxUses: 1,
      sourceEvidenceId: 'e-agent',
    }),
    /source evidence must be user_direct/,
  );
});

test('approval scope is exact and expiration is fail-closed', async (t) => {
  let now = '2026-01-11T10:00:00Z';
  const engine = await createEngine(() => now);
  t.after(() => engine.close());

  ingestEvidence(engine);
  recordApproval(engine);

  const wrongEnvironment = engine.authorizeAction({
    projectId: 'project-a',
    action: 'deploy',
    target: 'build-42',
    environment: 'production',
  });
  assert.equal(wrongEnvironment.authorized, false);
  assert.equal(wrongEnvironment.reason, 'no_valid_approval');

  const valid = engine.authorizeAction({
    projectId: 'project-a',
    action: 'deploy',
    target: 'build-42',
    environment: 'staging',
  });
  assert.equal(valid.authorized, true);
  assert.equal(valid.approval.id, 'approval-1');

  now = '2026-01-12T00:00:00Z';
  const expired = engine.authorizeAction({
    projectId: 'project-a',
    action: 'deploy',
    target: 'build-42',
    environment: 'staging',
  });
  assert.equal(expired.authorized, false);
  assert.equal(expired.reason, 'no_valid_approval');
});

test('action, target, and artifact scope must match exactly', async (t) => {
  const engine = await createEngine();
  t.after(() => engine.close());

  ingestEvidence(engine);
  recordApproval(engine, {
    action: 'deploy',
    target: 'service-api',
    environment: 'staging',
    artifact: 'build-42',
  });

  for (const request of [
    { action: 'restart', target: 'service-api', environment: 'staging', artifact: 'build-42' },
    { action: 'deploy', target: 'service-web', environment: 'staging', artifact: 'build-42' },
    { action: 'deploy', target: 'service-api', environment: 'staging', artifact: 'build-43' },
    { action: 'deploy', target: 'service-api', environment: 'staging', artifact: null },
  ]) {
    const decision = engine.authorizeAction({
      projectId: 'project-a',
      ...request,
      });
    assert.equal(decision.authorized, false);
  }

  const exact = engine.authorizeAction({
    projectId: 'project-a',
    action: 'deploy',
    target: 'service-api',
    environment: 'staging',
    artifact: 'build-42',
  });
  assert.equal(exact.authorized, true);
});

test('one-time approval is consumed atomically and cannot be reused', async (t) => {
  const engine = await createEngine();
  t.after(() => engine.close());

  ingestEvidence(engine);
  recordApproval(engine);

  const first = engine.authorizeAction({
    projectId: 'project-a',
    action: 'deploy',
    target: 'build-42',
    environment: 'staging',
    consume: true,
  });
  assert.equal(first.authorized, true);
  assert.equal(first.consumed, true);
  assert.equal(first.approval.uses, 1);

  const second = engine.authorizeAction({
    projectId: 'project-a',
    action: 'deploy',
    target: 'build-42',
    environment: 'staging',
    consume: true,
  });
  assert.equal(second.authorized, false);
  assert.equal(second.reason, 'no_valid_approval');
  assert.equal(engine.getApproval('approval-1').uses, 1);
});

test('revocation disables an otherwise matching approval', async (t) => {
  let now = '2026-01-11T09:30:00Z';
  const engine = await createEngine(() => now);
  t.after(() => engine.close());

  ingestEvidence(engine);
  recordApproval(engine);
  engine.revokeApproval({
    approvalId: 'approval-1',
    projectId: 'project-a',
  });
  now = '2026-01-11T10:00:00Z';

  const decision = engine.authorizeAction({
    projectId: 'project-a',
    action: 'deploy',
    target: 'build-42',
    environment: 'staging',
  });
  assert.equal(decision.authorized, false);
  assert.equal(decision.reason, 'no_valid_approval');
  assert.equal(engine.getApproval('approval-1').revoked_at, '2026-01-11T09:30:00.000Z');
});

test('caller-supplied timestamps cannot resurrect an expired approval', async (t) => {
  const engine = await createEngine(() => '2026-01-12T09:00:00Z');
  t.after(() => engine.close());

  ingestEvidence(engine);
  recordApproval(engine);

  const decision = engine.authorizeAction({
    projectId: 'project-a',
    action: 'deploy',
    target: 'build-42',
    environment: 'staging',
    at: '2026-01-11T10:00:00Z',
  });

  assert.equal(decision.authorized, false);
  assert.equal(decision.reason, 'no_valid_approval');
  assert.equal(decision.request.evaluated_at, '2026-01-12T09:00:00.000Z');
});

test('approval source evidence cannot cross project boundaries', async (t) => {
  const engine = await createEngine();
  t.after(() => engine.close());

  ingestEvidence(engine, {
    evidenceId: 'e-project-b',
    projectId: 'project-b',
  });

  assert.throws(
    () => recordApproval(engine, {
      sourceEvidenceId: 'e-project-b',
    }),
    /source evidence cannot cross project boundaries/,
  );
});

test('approval constraints must be satisfied explicitly', async (t) => {
  const engine = await createEngine();
  t.after(() => engine.close());

  ingestEvidence(engine);
  recordApproval(engine, {
    constraints: {
      region: 'eu-central',
      checks: { tests: true, review: true },
    },
  });

  const missing = engine.authorizeAction({
    projectId: 'project-a',
    action: 'deploy',
    target: 'build-42',
    environment: 'staging',
    constraints: { region: 'eu-central' },
  });
  assert.equal(missing.authorized, false);

  const valid = engine.authorizeAction({
    projectId: 'project-a',
    action: 'deploy',
    target: 'build-42',
    environment: 'staging',
    constraints: {
      region: 'eu-central',
      checks: { review: true, tests: true },
      ticket: 'OPS-42',
    },
  });
  assert.equal(valid.authorized, true);
});
