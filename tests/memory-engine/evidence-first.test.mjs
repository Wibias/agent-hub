import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MemoryEngine,
  REDACTED_SECRET,
} from '../../memory-engine/index.mjs';

async function createEngine(name) {
  const root = await mkdtemp(join(tmpdir(), `memory-engine-evidence-first-${name}-`));
  return new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
}

function evidence(overrides = {}) {
  return {
    id: 'e-1',
    projectId: 'project-a',
    harness: 'codex',
    sessionId: 'session-1',
    sourceKind: 'session',
    sourceRef: 'session:session-1',
    capturedAt: '2026-09-30T00:00:00Z',
    branch: 'main',
    commitSha: null,
    path: null,
    blobOid: null,
    content: 'Use Postgres for concurrent writers.',
    authorityClass: 'user_direct',
    metadata: { event_type: 'decision' },
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
    createdAt: '2026-09-30T00:00:00Z',
    ...overrides,
  };
}

test('recordEvidence persists redacted standalone evidence without making it recallable', async (t) => {
  const engine = await createEngine('standalone');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  const secret = 'sk-test-EVIDENCEFIRST-0123456789abcdef';
  const stored = engine.recordEvidence(evidence({
    id: 'e-standalone',
    sourceKind: 'tool',
    sourceRef: 'tool:database',
    content: `Observed credential ${secret} while checking the database.`,
    authorityClass: 'tool_observation',
    metadata: {
      password: 'evidence-first-password',
      detail: 'database observation',
    },
  }));

  assert.equal(stored.id, 'e-standalone');
  assert.equal(
    stored.content_redacted,
    `Observed credential ${REDACTED_SECRET} while checking the database.`,
  );
  assert.equal(stored.metadata.password, REDACTED_SECRET);
  assert.equal(stored.sensitivity, 'secret_redacted');
  assert.equal(engine.getClaim('c-1'), null);

  const exported = engine.exportCanonical();
  assert.equal(exported.evidence.length, 1);
  assert.equal(exported.claims.length, 0);

  const recalled = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'database credential observation',
    mode: 'current',
  });
  assert.deepEqual(recalled.items, []);
  assert.deepEqual(recalled.conflicts, []);
  assert.equal(JSON.stringify(exported).includes(secret), false);
});

test('standalone evidence survives canonical export and import without creating derived recall state', async (t) => {
  const source = await createEngine('export-source');
  const target = await createEngine('export-target');
  t.after(() => source.close());
  t.after(() => target.close());

  source.registerProject({
    projectId: 'project-a',
    repoIdentity: 'project-a',
    createdAt: '2026-09-30T00:00:00Z',
  });
  source.recordEvidence(evidence({
    id: 'e-only',
    content: 'Observed a candidate storage decision but did not assert it.',
    authorityClass: 'tool_observation',
    sourceKind: 'tool',
    sourceRef: 'tool:observer',
  }));

  const exported = source.exportCanonical();
  assert.equal(exported.evidence.length, 1);
  assert.equal(exported.claims.length, 0);

  assert.deepEqual(target.importCanonical(exported), {
    indexed_claims: 0,
    repository_path_snapshots: 0,
  });
  assert.deepEqual(target.exportCanonical(), exported);

  const recalled = target.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'candidate storage decision',
    mode: 'current',
  });
  assert.deepEqual(recalled.items, []);
});

test('assertClaim attaches a claim to existing evidence without rewriting its provenance', async (t) => {
  const engine = await createEngine('assert');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  const before = engine.recordEvidence(evidence({
    id: 'e-existing',
    sessionId: 'session-direct',
    sourceRef: 'session:session-direct',
    content: 'Use Postgres for concurrent writers.',
  }));

  const result = engine.assertClaim({
    evidenceId: 'e-existing',
    claim: claim({
      id: 'c-postgres',
      value: 'Postgres for concurrent writers',
    }),
  });

  assert.deepEqual(result.evidence, before);
  assert.equal(result.claim.id, 'c-postgres');
  assert.equal(result.claim.project_id, 'project-a');
  assert.equal(result.claim.created_from_evidence_id, 'e-existing');

  const after = engine.getEvidence('e-existing');
  assert.deepEqual(after, before);

  const recalled = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'Postgres concurrent writers',
    mode: 'current',
  });
  assert.deepEqual(recalled.items.map((item) => item.claim.id), ['c-postgres']);
  assert.equal(recalled.items[0].evidence.id, 'e-existing');
});

test('assertClaim keeps lifecycle mutation atomic and cannot cross project boundaries', async (t) => {
  const engine = await createEngine('lifecycle');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  engine.registerProject({ projectId: 'project-b', repoIdentity: 'project-b' });

  engine.ingest({
    evidence: evidence({
      id: 'e-project-b',
      projectId: 'project-b',
      sourceRef: 'session:project-b',
      content: 'Project B uses SQLite.',
    }),
    claim: claim({
      id: 'c-project-b',
      value: 'SQLite',
    }),
  });

  engine.recordEvidence(evidence({
    id: 'e-project-a',
    content: 'Project A uses Postgres.',
  }));

  assert.throws(
    () => engine.assertClaim({
      evidenceId: 'e-project-a',
      claim: claim({
        id: 'c-project-a',
        value: 'Postgres',
      }),
      lifecycle: {
        supersedes: ['c-project-b'],
      },
    }),
    /project boundar/i,
  );

  assert.equal(engine.getClaim('c-project-a'), null);
  assert.equal(engine.getClaim('c-project-b').state, 'active');
  assert.ok(engine.getEvidence('e-project-a'));
});

test('assertClaim supports normal same-project supersession from pre-recorded evidence', async (t) => {
  const engine = await createEngine('supersede');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  engine.ingest({
    evidence: evidence({
      id: 'e-sqlite',
      capturedAt: '2026-09-29T00:00:00Z',
      content: 'Use SQLite first.',
    }),
    claim: claim({
      id: 'c-sqlite',
      value: 'SQLite',
      createdAt: '2026-09-29T00:00:00Z',
    }),
  });

  engine.recordEvidence(evidence({
    id: 'e-postgres',
    content: 'Use Postgres instead.',
  }));

  engine.assertClaim({
    evidenceId: 'e-postgres',
    claim: claim({
      id: 'c-postgres',
      value: 'Postgres',
    }),
    lifecycle: {
      supersedes: ['c-sqlite'],
    },
  });

  assert.equal(engine.getClaim('c-sqlite').state, 'superseded');
  assert.equal(engine.getClaim('c-sqlite').superseded_by_claim_id, 'c-postgres');

  const current = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'SQLite Postgres database',
    mode: 'current',
  });
  assert.deepEqual(current.items.map((item) => item.claim.id), ['c-postgres']);
});

test('legacy ingest still rolls back evidence when claim lifecycle validation fails', async (t) => {
  const engine = await createEngine('legacy-atomicity');
  t.after(() => engine.close());
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  assert.throws(
    () => engine.ingest({
      evidence: evidence({
        id: 'e-atomic-failure',
        content: 'This must not survive a failed ingest transaction.',
      }),
      claim: claim({
        id: 'c-atomic-failure',
        value: 'failed transaction',
      }),
      lifecycle: {
        supersedes: ['c-missing'],
      },
    }),
    /unknown claim|cannot supersede/i,
  );

  assert.equal(engine.getEvidence('e-atomic-failure'), null);
  assert.equal(engine.getClaim('c-atomic-failure'), null);
  assert.equal(engine.exportCanonical().evidence.length, 0);
  assert.equal(engine.exportCanonical().claims.length, 0);
});
