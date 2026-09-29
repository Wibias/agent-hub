import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MemoryEngine,
  REDACTED_SECRET,
} from '../../memory-engine/index.mjs';

async function createEngine() {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-foundation-'));
  const dbPath = join(root, 'memory.sqlite3');
  const engine = new MemoryEngine({ dbPath });
  return { engine, dbPath };
}

function evidence(overrides = {}) {
  return {
    id: 'e-1',
    projectId: 'project-a',
    harness: 'codex',
    sessionId: 'session-1',
    sourceKind: 'user_direct',
    sourceRef: 'session:session-1',
    capturedAt: '2026-01-02T09:00:00Z',
    branch: 'main',
    commitSha: 'a'.repeat(40),
    path: null,
    blobOid: null,
    content: 'Use Postgres.',
    authorityClass: 'user_direct',
    metadata: { fixture: true },
    ...overrides,
  };
}

function claim(overrides = {}) {
  return {
    id: 'c-1',
    kind: 'decision',
    subject: 'database',
    predicate: 'uses',
    value: 'Postgres',
    branchScope: 'main',
    createdAt: '2026-01-02T09:00:00Z',
    ...overrides,
  };
}

test('opens canonical SQLite in WAL mode and registers stable projects', async (t) => {
  const { engine } = await createEngine();
  t.after(() => engine.close());

  engine.registerProject({
    projectId: 'project-a',
    canonicalRemote: 'https://example.invalid/project-a.git',
    repoIdentity: 'project-a',
  });

  assert.equal(engine.journalMode(), 'wal');
  assert.deepEqual(engine.getProject('project-a'), {
    project_id: 'project-a',
    canonical_remote: 'https://example.invalid/project-a.git',
    repo_identity: 'project-a',
  });
});

test('ingest persists immutable evidence plus an active claim with provenance', async (t) => {
  const { engine } = await createEngine();
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  engine.ingest({
    evidence: evidence({
      sourceKind: 'repo_trusted',
      sourceRef: 'docs/adr/0001-database.md',
      path: 'docs/adr/0001-database.md',
      blobOid: 'b'.repeat(40),
      authorityClass: 'repo_trusted',
    }),
    claim: claim(),
  });

  assert.deepEqual(engine.getEvidence('e-1'), {
    id: 'e-1',
    project_id: 'project-a',
    harness: 'codex',
    session_id: 'session-1',
    source_kind: 'repo_trusted',
    source_ref: 'docs/adr/0001-database.md',
    captured_at: '2026-01-02T09:00:00Z',
    branch: 'main',
    commit_sha: 'a'.repeat(40),
    path: 'docs/adr/0001-database.md',
    blob_oid: 'b'.repeat(40),
    content_redacted: 'Use Postgres.',
    sensitivity: 'normal',
    authority_class: 'repo_trusted',
    metadata: { fixture: true },
  });

  assert.equal(engine.getClaim('c-1').state, 'active');
  assert.equal(engine.getClaim('c-1').created_from_evidence_id, 'e-1');
});

test('current recall hard-filters project and branch before lexical ranking', async (t) => {
  const { engine } = await createEngine();
  t.after(() => engine.close());

  for (const projectId of ['project-a', 'project-b']) {
    engine.registerProject({ projectId, repoIdentity: projectId });
  }

  engine.ingest({
    evidence: evidence({ id: 'e-main', content: 'Main uses server-side sessions.' }),
    claim: claim({
      id: 'c-main',
      subject: 'authentication',
      value: 'server-side sessions',
      branchScope: 'main',
    }),
  });
  engine.ingest({
    evidence: evidence({
      id: 'e-feature',
      branch: 'feature/oauth',
      content: 'Feature uses OAuth exchange.',
    }),
    claim: claim({
      id: 'c-feature',
      subject: 'authentication',
      value: 'OAuth exchange',
      branchScope: 'feature/oauth',
    }),
  });
  engine.ingest({
    evidence: evidence({
      id: 'e-other',
      projectId: 'project-b',
      content: 'Project B uses OAuth.',
    }),
    claim: claim({
      id: 'c-other',
      subject: 'authentication',
      value: 'OAuth',
      branchScope: 'main',
    }),
  });

  const result = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'authentication server sessions OAuth',
    mode: 'current',
    limit: 10,
  });

  assert.deepEqual(result.items.map((item) => item.claim.id), ['c-main']);
});

test('explicit supersession removes old truth from current recall but preserves history', async (t) => {
  const { engine } = await createEngine();
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  engine.ingest({
    evidence: evidence({ id: 'e-sqlite', content: 'Use SQLite.' }),
    claim: claim({ id: 'c-sqlite', value: 'SQLite', createdAt: '2026-01-01T09:00:00Z' }),
  });
  engine.ingest({
    evidence: evidence({ id: 'e-postgres', content: 'Use Postgres.' }),
    claim: claim({ id: 'c-postgres', value: 'Postgres' }),
    lifecycle: { supersedes: ['c-sqlite'] },
  });

  const current = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'SQLite Postgres database',
    mode: 'current',
  });
  assert.deepEqual(current.items.map((item) => item.claim.id), ['c-postgres']);

  const history = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'SQLite Postgres database',
    mode: 'historical',
  });
  assert.deepEqual(
    new Map(history.items.map((item) => [item.claim.id, item.claim.state])),
    new Map([
      ['c-postgres', 'active'],
      ['c-sqlite', 'superseded'],
    ]),
  );
  assert.equal(engine.getClaim('c-sqlite').superseded_by_claim_id, 'c-postgres');
});

test('explicit rejection keeps proposal only as rejected historical context', async (t) => {
  const { engine } = await createEngine();
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  engine.ingest({
    evidence: evidence({ id: 'e-proposal', content: 'We could use SQLite.' }),
    claim: claim({ id: 'c-proposal', kind: 'proposal', value: 'SQLite proposal' }),
  });
  engine.ingest({
    evidence: evidence({ id: 'e-reject', content: 'Reject SQLite for this service.' }),
    claim: claim({ id: 'c-reject', kind: 'rejection', value: 'Reject SQLite' }),
    lifecycle: { rejects: ['c-proposal'] },
  });

  const current = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'SQLite proposal reject',
    mode: 'current',
  });
  assert.deepEqual(current.items.map((item) => item.claim.id), ['c-reject']);

  assert.equal(engine.getClaim('c-proposal').state, 'rejected');
  assert.equal(engine.getClaim('c-proposal').rejected_by_evidence_id, 'e-reject');
});

test('secret filtering happens before canonical SQLite persistence', async (t) => {
  const { engine, dbPath } = await createEngine();
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  const secret = 'sk-test-MEMORYRATCHET-0123456789abcdef';
  engine.ingest({
    evidence: evidence({
      id: 'e-secret',
      sourceKind: 'tool_observation',
      sourceRef: 'tool:test-service',
      content: `Test service returned credential ${secret} while debugging.`,
      authorityClass: 'tool_observation',
    }),
    claim: claim({
      id: 'c-secret',
      kind: 'fact',
      subject: 'debug credential',
      predicate: 'returned',
      value: `credential ${secret}`,
    }),
  });

  const stored = engine.getEvidence('e-secret');
  assert.equal(
    stored.content_redacted,
    `Test service returned credential ${REDACTED_SECRET} while debugging.`,
  );
  assert.equal(stored.sensitivity, 'secret_redacted');

  const recall = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'credential debugging',
    mode: 'current',
  });
  assert.equal(JSON.stringify(recall).includes(secret), false);
  assert.equal(JSON.stringify(recall).includes(REDACTED_SECRET), true);

  engine.checkpoint();

  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (!existsSync(path)) continue;
    const bytes = await readFile(path);
    assert.equal(bytes.includes(Buffer.from(secret)), false, `secret leaked into ${path}`);
  }
});


test('structured sensitive metadata fields are redacted before persistence', async (t) => {
  const { engine } = await createEngine();
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  engine.ingest({
    evidence: evidence({
      id: 'e-structured-secret',
      content: 'Structured metadata secret test.',
      metadata: {
        password: 'structured-password-value',
        nested: {
          api_key: 'structured-api-key-value',
        },
      },
    }),
    claim: claim({
      id: 'c-structured-secret',
      kind: 'fact',
      subject: 'structured metadata',
      value: 'secret fields are redacted',
    }),
  });

  const stored = engine.getEvidence('e-structured-secret');
  assert.equal(stored.metadata.password, REDACTED_SECRET);
  assert.equal(stored.metadata.nested.api_key, REDACTED_SECRET);
  assert.equal(stored.sensitivity, 'secret_redacted');
});

test('lexical recall normalizes camelCase code symbols and simple plurals', async (t) => {
  const { engine } = await createEngine();
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  engine.ingest({
    evidence: evidence({
      id: 'e-auth',
      sourceKind: 'tool_observation',
      sourceRef: 'src/auth.ts',
      content: 'src/auth.ts authenticates by calling sessionStore.get(sessionId).',
      authorityClass: 'tool_observation',
    }),
    claim: claim({
      id: 'c-auth',
      kind: 'code_observation',
      subject: 'authentication',
      value: 'src/auth.ts authenticates by calling sessionStore.get(sessionId).',
    }),
  });

  const result = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'Does authentication use server-side sessions?',
    mode: 'current',
  });

  assert.deepEqual(result.items.map((item) => item.claim.id), ['c-auth']);
});
