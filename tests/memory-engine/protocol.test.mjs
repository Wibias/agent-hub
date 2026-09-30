import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  MEMORY_PROTOCOL_V1,
  createMemoryProtocol,
} from '../../memory-engine/protocol.mjs';

async function createEngine(name) {
  const root = await mkdtemp(join(tmpdir(), `memory-protocol-${name}-`));
  return new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
}

function request(operation, payload = {}, requestId = 'req-1') {
  return {
    protocol: MEMORY_PROTOCOL_V1,
    operation,
    request_id: requestId,
    payload,
  };
}

function capturePayload(overrides = {}) {
  return {
    id: 'e-1',
    project_id: 'project-a',
    harness: 'codex',
    session_id: 'session-1',
    source_kind: 'session',
    source_ref: 'session:session-1',
    captured_at: '2026-09-30T00:00:00Z',
    branch: 'main',
    commit_sha: null,
    path: null,
    blob_oid: null,
    content: 'Use Postgres.',
    metadata: { event_type: 'decision' },
    ...overrides,
  };
}

function claimPayload(overrides = {}) {
  return {
    evidence_id: 'e-1',
    claim: {
      id: 'c-1',
      kind: 'decision',
      subject: 'database',
      predicate: 'uses',
      value: 'Postgres',
      branch_scope: 'main',
      created_at: '2026-09-30T00:00:00Z',
      ...overrides,
    },
    lifecycle: {},
  };
}

async function capture(protocol, payload = capturePayload(), requestId = 'capture-1') {
  const response = await protocol.handle(request('capture_evidence', payload, requestId));
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.result;
}

async function assertClaim(protocol, payload = claimPayload(), requestId = 'claim-1') {
  const response = await protocol.handle(request('assert_claim', payload, requestId));
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.result;
}

test('protocol rejects version and operation mismatches with deterministic safe errors', async (t) => {
  const engine = await createEngine('version');
  t.after(() => engine.close());
  const protocol = createMemoryProtocol({ memory: engine });

  const wrongVersion = await protocol.handle({
    protocol: 'memory.protocol.v999',
    operation: 'status',
    request_id: 'req-version',
    payload: {},
  });
  assert.deepEqual(wrongVersion, {
    protocol: MEMORY_PROTOCOL_V1,
    request_id: 'req-version',
    ok: false,
    error: {
      code: 'unsupported_protocol',
      message: 'Unsupported memory protocol version.',
    },
  });

  const wrongOperation = await protocol.handle(
    request('delete_everything', {}, 'req-operation'),
  );
  assert.deepEqual(wrongOperation, {
    protocol: MEMORY_PROTOCOL_V1,
    request_id: 'req-operation',
    ok: false,
    error: {
      code: 'unsupported_operation',
      message: 'Unsupported memory protocol operation.',
    },
  });
});

test('capture_evidence derives authority from trusted classifier and forbids caller authority', async (t) => {
  const engine = await createEngine('authority');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  const classifications = [];
  const protocol = createMemoryProtocol({
    memory: engine,
    classifyAuthority(channel) {
      classifications.push(channel);
      return channel.sourceKind === 'session'
        ? 'user_direct'
        : 'tool_observation';
    },
  });

  const result = await capture(protocol);
  assert.equal(result.evidence.id, 'e-1');
  assert.equal(result.evidence.authority_class, 'user_direct');
  assert.deepEqual(classifications, [{
    harness: 'codex',
    sessionId: 'session-1',
    sourceKind: 'session',
    sourceRef: 'session:session-1',
    metadata: { event_type: 'decision' },
  }]);

  const forbidden = await protocol.handle(request('capture_evidence', {
    ...capturePayload({ id: 'e-forged' }),
    authority_class: 'user_direct',
  }, 'req-forged'));
  assert.equal(forbidden.ok, false);
  assert.deepEqual(forbidden.error, {
    code: 'forbidden_field',
    message: 'Request contains a forbidden field.',
  });
  assert.equal(engine.getEvidence('e-forged'), null);
});

test('capture_evidence fails closed when no authority classifier is configured', async (t) => {
  const engine = await createEngine('no-classifier');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  const protocol = createMemoryProtocol({ memory: engine });

  const response = await protocol.handle(
    request('capture_evidence', capturePayload()),
  );
  assert.equal(response.ok, false);
  assert.deepEqual(response.error, {
    code: 'authority_classifier_unavailable',
    message: 'Authority classification is unavailable.',
  });
  assert.equal(engine.exportCanonical().evidence.length, 0);
});

test('assert_claim is default-deny and trusted claim authorizer can allow exact assertion', async (t) => {
  const engine = await createEngine('claim-auth');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  const classifier = () => 'user_direct';
  const denied = createMemoryProtocol({
    memory: engine,
    classifyAuthority: classifier,
  });
  await capture(denied);

  const deniedResponse = await denied.handle(
    request('assert_claim', claimPayload(), 'claim-denied'),
  );
  assert.equal(deniedResponse.ok, false);
  assert.deepEqual(deniedResponse.error, {
    code: 'claim_assertion_denied',
    message: 'Claim assertion is not authorized.',
  });
  assert.equal(engine.getClaim('c-1'), null);

  const authorizerCalls = [];
  const allowed = createMemoryProtocol({
    memory: engine,
    classifyAuthority: classifier,
    async authorizeClaim(context) {
      authorizerCalls.push(context);
      return (
        context.evidence.id === 'e-1'
        && context.evidence.authority_class === 'user_direct'
        && context.claim.value === 'Postgres'
      );
    },
  });

  const result = await assertClaim(allowed);
  assert.equal(result.claim.id, 'c-1');
  assert.equal(result.claim.created_from_evidence_id, 'e-1');
  assert.equal(authorizerCalls.length, 1);
  assert.equal(authorizerCalls[0].evidence.id, 'e-1');
});

test('recall and history preserve project/branch scope and enforce wire budgets', async (t) => {
  const engine = await createEngine('recall');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  engine.registerProject({ projectId: 'project-b', repoIdentity: 'project-b' });

  const protocol = createMemoryProtocol({
    memory: engine,
    classifyAuthority: () => 'user_direct',
    authorizeClaim: () => true,
  });

  await capture(protocol, capturePayload({
    id: 'e-main-old',
    content: 'Use SQLite first.',
  }), 'capture-main-old');
  await assertClaim(protocol, {
    ...claimPayload({
      id: 'c-main-old',
      value: 'SQLite',
      created_at: '2026-09-29T00:00:00Z',
    }),
    evidence_id: 'e-main-old',
  }, 'claim-main-old');

  await capture(protocol, capturePayload({
    id: 'e-main-new',
    content: 'Use Postgres with concurrent writers. '.repeat(100),
  }), 'capture-main-new');
  await assertClaim(protocol, {
    ...claimPayload({
      id: 'c-main-new',
      value: 'Postgres',
    }),
    evidence_id: 'e-main-new',
    lifecycle: { supersedes: ['c-main-old'] },
  }, 'claim-main-new');

  await capture(protocol, capturePayload({
    id: 'e-feature',
    branch: 'feature/oauth',
    content: 'Feature branch uses OAuth.',
  }), 'capture-feature');
  await assertClaim(protocol, {
    ...claimPayload({
      id: 'c-feature',
      subject: 'authentication',
      value: 'OAuth',
      branch_scope: 'feature/oauth',
    }),
    evidence_id: 'e-feature',
  }, 'claim-feature');

  await capture(protocol, capturePayload({
    id: 'e-other',
    project_id: 'project-b',
    source_ref: 'session:project-b',
    content: 'Project B uses Redis.',
  }), 'capture-other');
  await assertClaim(protocol, {
    ...claimPayload({
      id: 'c-other',
      subject: 'cache',
      value: 'Redis',
    }),
    evidence_id: 'e-other',
  }, 'claim-other');

  const current = await protocol.handle(request('recall', {
    project_id: 'project-a',
    branch: 'main',
    revision_sha: null,
    query: 'database Postgres SQLite Redis OAuth concurrent writers',
    max_items: 10,
    max_serialized_bytes: 16_384,
  }, 'recall-current'));
  assert.equal(current.ok, true);
  assert.ok(current.result.items.length <= 10);
  assert.ok(Buffer.byteLength(JSON.stringify(current.result), 'utf8') <= 16_384);
  assert.equal(
    current.result.items.some((item) => item.claim.id === 'c-main-old'),
    false,
  );
  assert.equal(
    current.result.items.some((item) => item.claim.id === 'c-feature'),
    false,
  );
  assert.equal(
    current.result.items.some((item) => item.claim.id === 'c-other'),
    false,
  );

  const tinyBudget = await protocol.handle(request('recall', {
    project_id: 'project-a',
    branch: 'main',
    revision_sha: null,
    query: 'Postgres concurrent writers',
    max_items: 10,
    max_serialized_bytes: 512,
  }, 'recall-tiny-budget'));
  assert.equal(tinyBudget.ok, true);
  assert.ok(
    Buffer.byteLength(JSON.stringify(tinyBudget.result), 'utf8') <= 512,
  );

  const history = await protocol.handle(request('history', {
    project_id: 'project-a',
    branch: 'main',
    revision_sha: null,
    query: 'database Postgres SQLite',
    max_items: 10,
    max_serialized_bytes: 16_384,
  }, 'recall-history'));
  assert.equal(history.ok, true);
  assert.ok(history.result.items.length <= 10);
  assert.ok(Buffer.byteLength(JSON.stringify(history.result), 'utf8') <= 16_384);
  assert.equal(
    history.result.items.some((item) => item.claim.id === 'c-main-old'),
    true,
  );
});

test('authorize delegates exact structured capability checks and consumes one-time approval', async (t) => {
  const engine = await createEngine('authorize');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  engine.recordEvidence({
    id: 'e-approval',
    projectId: 'project-a',
    harness: 'codex',
    sessionId: 'session-approval',
    sourceKind: 'session',
    sourceRef: 'session:session-approval',
    capturedAt: '2026-09-30T00:00:00Z',
    branch: 'main',
    commitSha: null,
    path: null,
    blobOid: null,
    content: 'Approve deployment to staging.',
    authorityClass: 'user_direct',
    metadata: {},
  });
  engine.recordApproval({
    id: 'approval-1',
    projectId: 'project-a',
    action: 'deploy',
    target: 'service-a',
    environment: 'staging',
    artifact: 'build-42',
    constraints: { region: 'eu-central-1' },
    issuedAt: '2026-09-30T00:00:00Z',
    expiresAt: '2099-09-30T23:59:59Z',
    maxUses: 1,
    sourceEvidenceId: 'e-approval',
  });

  const protocol = createMemoryProtocol({ memory: engine });
  const payload = {
    project_id: 'project-a',
    action: 'deploy',
    target: 'service-a',
    environment: 'staging',
    artifact: 'build-42',
    constraints: { region: 'eu-central-1' },
  };

  const first = await protocol.handle(request('authorize', payload, 'auth-1'));
  assert.equal(first.ok, true);
  assert.equal(first.result.authorized, true);

  const second = await protocol.handle(request('authorize', payload, 'auth-2'));
  assert.equal(second.ok, true);
  assert.equal(second.result.authorized, false);
});

test('export and import round-trip standalone evidence through the protocol', async (t) => {
  const source = await createEngine('export-source');
  const target = await createEngine('export-target');
  t.after(() => source.close());
  t.after(() => target.close());

  source.registerProject({
    projectId: 'project-a',
    repoIdentity: 'project-a',
    createdAt: '2026-09-30T00:00:00Z',
  });

  const sourceProtocol = createMemoryProtocol({
    memory: source,
    classifyAuthority: () => 'tool_observation',
  });
  await capture(sourceProtocol, capturePayload({
    id: 'e-portable',
    source_kind: 'tool',
    source_ref: 'tool:observer',
    content: 'Portable standalone observation.',
  }));

  const exported = await sourceProtocol.handle(
    request('export', {}, 'export-1'),
  );
  assert.equal(exported.ok, true);
  assert.equal(exported.result.memory.evidence.length, 1);
  assert.equal(exported.result.memory.claims.length, 0);

  const targetProtocol = createMemoryProtocol({ memory: target });
  const imported = await targetProtocol.handle(request('import', {
    memory: exported.result.memory,
  }, 'import-1'));
  assert.equal(imported.ok, true);
  assert.equal(imported.result.indexed_claims, 0);
  assert.deepEqual(target.exportCanonical(), source.exportCanonical());
});

test('status reports counts and protocol version without remembered content', async (t) => {
  const engine = await createEngine('status');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  const protocol = createMemoryProtocol({
    memory: engine,
    classifyAuthority: () => 'tool_observation',
  });
  await capture(protocol, capturePayload({
    content: 'Sensitive project narrative that status must not expose.',
    source_kind: 'tool',
    source_ref: 'tool:observer',
  }));

  const response = await protocol.handle(request('status', {}, 'status-1'));
  assert.equal(response.ok, true);
  assert.deepEqual(response.result, {
    protocol: MEMORY_PROTOCOL_V1,
    projects: 1,
    evidence: 1,
    claims: 0,
    lifecycle_events: 0,
    open_conflicts: 0,
    approvals: 0,
  });
  assert.equal(
    JSON.stringify(response).includes('Sensitive project narrative'),
    false,
  );
});

test('operation errors return fixed messages and never echo secret payload values', async (t) => {
  const engine = await createEngine('safe-errors');
  t.after(() => engine.close());

  const protocol = createMemoryProtocol({
    memory: engine,
    classifyAuthority: () => 'user_direct',
  });
  const secret = 'sk-test-PROTOCOLERROR-0123456789abcdef';

  const response = await protocol.handle(request('capture_evidence', capturePayload({
    project_id: 'missing-project',
    content: `Do not echo ${secret}`,
  }), 'safe-error'));

  assert.equal(response.ok, false);
  assert.deepEqual(response.error, {
    code: 'memory_operation_failed',
    message: 'Memory operation failed.',
  });
  assert.equal(JSON.stringify(response).includes(secret), false);
});
