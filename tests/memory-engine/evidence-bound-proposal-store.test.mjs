import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  EVIDENCE_PROPOSAL_SCHEMA_SQL,
  ensureEvidenceProposalSchema,
  findEvidenceBoundProposalByFingerprint,
  getEvidenceBoundProposal,
  listEvidenceBoundProposals,
  recordEvidenceBoundProposal,
} from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  EVIDENCE_EXTRACTION_POLICY_VERSION,
  evidenceExtractionFingerprint,
} from '../../memory-engine/evidence-bound-extraction.mjs';

async function createDb() {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-evidence-proposal-'));
  const db = new DatabaseSync(join(root, 'memory.sqlite3'), {
    timeout: 5_000,
    enableForeignKeyConstraints: true,
  });
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE project_registry (
      project_id TEXT PRIMARY KEY,
      repo_identity TEXT
    ) STRICT;
    CREATE TABLE evidence (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      branch TEXT,
      sensitivity TEXT NOT NULL,
      authority_class TEXT NOT NULL,
      content_redacted TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare(
    'INSERT INTO project_registry (project_id, repo_identity) VALUES (?, ?)',
  ).run('project-a', 'project-a');
  db.prepare(
    'INSERT INTO project_registry (project_id, repo_identity) VALUES (?, ?)',
  ).run('project-b', 'project-b');
  ensureEvidenceProposalSchema(db);
  return db;
}

function insertEvidence(db, overrides = {}) {
  const row = {
    id: 'e-user',
    project_id: 'project-a',
    branch: 'main',
    sensitivity: 'normal',
    authority_class: 'user_direct',
    content_redacted: 'Use Postgres for concurrent writers.',
    ...overrides,
  };
  db.prepare(`
    INSERT INTO evidence (
      id, project_id, branch, sensitivity, authority_class, content_redacted
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.project_id,
    row.branch,
    row.sensitivity,
    row.authority_class,
    row.content_redacted,
  );
  return row;
}

function proposalInput(overrides = {}) {
  const canonicalFact = overrides.canonicalFact
    ?? 'Use Postgres for concurrent writers.';
  const kind = overrides.kind ?? 'procedure';
  return {
    id: overrides.id ?? 'proposal-1',
    projectId: overrides.projectId ?? 'project-a',
    branch: overrides.branch ?? 'main',
    kind,
    canonicalFact,
    evidenceIds: overrides.evidenceIds ?? ['e-user'],
    fingerprint: overrides.fingerprint ?? evidenceExtractionFingerprint({
      kind,
      canonicalFact,
    }),
    policyVersion: overrides.policyVersion ?? EVIDENCE_EXTRACTION_POLICY_VERSION,
    evaluatorId: overrides.evaluatorId ?? 'memory-extractor:test',
    createdAt: overrides.createdAt ?? '2026-10-11T12:00:00.000Z',
  };
}

function safeSensitivity(value) {
  return {
    containsSecret: /SECRET|sk-[A-Za-z0-9_-]{8,}/u.test(String(value)),
  };
}

test('proposal schema keeps authority on evidence rather than flattening it onto proposal rows', async (t) => {
  const db = await createDb();
  t.after(() => db.close());

  assert.match(EVIDENCE_PROPOSAL_SCHEMA_SQL, /memory_evidence_proposals/u);
  assert.match(EVIDENCE_PROPOSAL_SCHEMA_SQL, /memory_evidence_proposal_evidence/u);

  const columns = db.prepare(
    'PRAGMA table_info(memory_evidence_proposals)',
  ).all().map((row) => row.name);
  assert.equal(columns.includes('source_authority'), false);
});

test('recordEvidenceBoundProposal persists one proposal with multiple evidence links and creates no claim or legacy candidate', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  insertEvidence(db);
  insertEvidence(db, {
    id: 'e-tool',
    authority_class: 'tool_observation',
    content_redacted: 'Observed concurrent writes succeeding with Postgres.',
  });

  const result = recordEvidenceBoundProposal(db, {
    ...proposalInput({ evidenceIds: ['e-user', 'e-tool'] }),
    inspectTextSensitivity: safeSensitivity,
  });

  assert.equal(result.id, 'proposal-1');
  assert.equal(result.project_id, 'project-a');
  assert.equal(result.branch, 'main');
  assert.equal(result.kind, 'procedure');
  assert.equal(result.canonical_fact, 'Use Postgres for concurrent writers.');
  assert.equal(result.status, 'pending');
  assert.deepEqual(result.evidence_ids, ['e-tool', 'e-user']);
  assert.deepEqual(result.authorities, ['tool_observation', 'user_direct']);

  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM memory_evidence_proposals').get().count,
    1,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM memory_evidence_proposal_evidence').get().count,
    2,
  );

  const tables = new Set(db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'",
  ).all().map((row) => row.name));
  assert.equal(tables.has('claims'), false);
  assert.equal(tables.has('memory_candidates'), false);
});

test('recordEvidenceBoundProposal rejects unknown, cross-scope, secret and ineligible cited evidence atomically', async (t) => {
  const cases = [
    {
      name: 'unknown',
      evidence: [],
      evidenceIds: ['missing'],
      error: /unknown cited evidence/i,
    },
    {
      name: 'cross-project',
      evidence: [{ id: 'e-b', project_id: 'project-b' }],
      evidenceIds: ['e-b'],
      error: /outside proposal scope/i,
    },
    {
      name: 'cross-branch',
      evidence: [{ id: 'e-other', branch: 'dev' }],
      evidenceIds: ['e-other'],
      error: /outside proposal scope/i,
    },
    {
      name: 'secret',
      evidence: [{ id: 'e-secret', sensitivity: 'secret_redacted' }],
      evidenceIds: ['e-secret'],
      error: /secret-redacted/i,
    },
    {
      name: 'agent',
      evidence: [{ id: 'e-agent', authority_class: 'agent_inference' }],
      evidenceIds: ['e-agent'],
      error: /authority is not eligible/i,
    },
  ];

  for (const item of cases) {
    const db = await createDb();
    for (const row of item.evidence) insertEvidence(db, row);
    assert.throws(
      () => recordEvidenceBoundProposal(db, {
        ...proposalInput({
          id: 'proposal-' + item.name,
          evidenceIds: item.evidenceIds,
        }),
        inspectTextSensitivity: safeSensitivity,
      }),
      item.error,
      item.name,
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM memory_evidence_proposals').get().count,
      0,
      item.name,
    );
    db.close();
  }
});

test('preference proposals require only user_direct evidence', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  insertEvidence(db, {
    content_redacted: 'I prefer dark editorial UI.',
  });
  insertEvidence(db, {
    id: 'e-tool',
    authority_class: 'tool_observation',
    content_redacted: 'Observed a dark interface.',
  });

  assert.throws(
    () => recordEvidenceBoundProposal(db, {
      ...proposalInput({
        kind: 'preference',
        canonicalFact: 'Prefers dark editorial UI.',
        evidenceIds: ['e-user', 'e-tool'],
      }),
      inspectTextSensitivity: safeSensitivity,
    }),
    /preference.*user_direct/i,
  );
});

test('proposal persistence verifies fingerprint and scans canonical model output for secrets', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  insertEvidence(db);

  assert.throws(
    () => recordEvidenceBoundProposal(db, {
      ...proposalInput({ fingerprint: 'a'.repeat(64) }),
      inspectTextSensitivity: safeSensitivity,
    }),
    /fingerprint.*mismatch/i,
  );

  const canonicalFact = 'Use SECRET value for deployment.';
  assert.throws(
    () => recordEvidenceBoundProposal(db, {
      ...proposalInput({
        canonicalFact,
        fingerprint: evidenceExtractionFingerprint({
          kind: 'procedure',
          canonicalFact,
        }),
      }),
      inspectTextSensitivity: safeSensitivity,
    }),
    /canonical fact.*secret/i,
  );
});

test('same proposal fingerprint deduplicates the proposal and merges later supporting evidence', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  insertEvidence(db);
  insertEvidence(db, {
    id: 'e-tool',
    authority_class: 'tool_observation',
    content_redacted: 'Observed concurrent writes succeeding with Postgres.',
  });

  const first = recordEvidenceBoundProposal(db, {
    ...proposalInput({ id: 'proposal-first', evidenceIds: ['e-user'] }),
    inspectTextSensitivity: safeSensitivity,
  });
  const duplicate = recordEvidenceBoundProposal(db, {
    ...proposalInput({ id: 'proposal-second', evidenceIds: ['e-tool'] }),
    inspectTextSensitivity: safeSensitivity,
  });

  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.id, 'proposal-first');
  assert.deepEqual(duplicate.evidence_ids, ['e-tool', 'e-user']);
  assert.deepEqual(duplicate.authorities, ['tool_observation', 'user_direct']);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM memory_evidence_proposals').get().count,
    1,
  );
});

test('proposal lookup and listing stay project, branch and status scoped', async (t) => {
  const db = await createDb();
  t.after(() => db.close());
  insertEvidence(db);

  const input = proposalInput();
  const stored = recordEvidenceBoundProposal(db, {
    ...input,
    inspectTextSensitivity: safeSensitivity,
  });

  assert.deepEqual(getEvidenceBoundProposal(db, stored.id), stored);
  assert.equal(
    findEvidenceBoundProposalByFingerprint(db, {
      projectId: 'project-a',
      branch: 'main',
      fingerprint: input.fingerprint,
    })?.id,
    stored.id,
  );
  assert.equal(
    findEvidenceBoundProposalByFingerprint(db, {
      projectId: 'project-a',
      branch: 'dev',
      fingerprint: input.fingerprint,
    }),
    null,
  );

  assert.deepEqual(
    listEvidenceBoundProposals(db, {
      projectId: 'project-a',
      branch: 'main',
      status: 'pending',
    }).map((item) => item.id),
    [stored.id],
  );
  assert.deepEqual(
    listEvidenceBoundProposals(db, {
      projectId: 'project-a',
      branch: 'main',
      status: 'ignored',
    }),
    [],
  );
});
