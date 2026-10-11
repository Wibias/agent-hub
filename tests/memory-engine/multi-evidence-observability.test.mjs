import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { inspectMemoryDatabase } from '../../memory-engine/memory-doctor.mjs';

function evidence(id, authorityClass) {
  return {
    id,
    projectId: 'project-a',
    harness: 'codex',
    sessionId: 'session-r10d',
    sourceKind: authorityClass === 'repo_trusted' ? 'repository' : 'session',
    sourceRef: authorityClass === 'repo_trusted' ? 'repo:procedure' : 'session:r10d',
    capturedAt: '2026-10-11T19:00:00.000Z',
    branch: 'main',
    commitSha: null,
    path: null,
    blobOid: null,
    content: `Evidence ${id}`,
    authorityClass,
    metadata: {},
  };
}

async function createMultiEvidenceDb(name) {
  const root = await mkdtemp(join(tmpdir(), `agent-hub-r10d-${name}-`));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  memory.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  memory.recordEvidence(evidence('e-user', 'user_direct'));
  memory.recordEvidence(evidence('e-repo', 'repo_trusted'));
  memory.assertClaim({
    evidenceId: 'e-user',
    evidenceIds: ['e-user', 'e-repo'],
    claim: {
      id: 'claim-r10d',
      kind: 'procedure',
      subject: 'memory runtime',
      predicate: 'requires',
      value: 'Run Doctor before integration is complete.',
      state: 'active',
      branchScope: 'main',
      createdAt: '2026-10-11T19:00:01.000Z',
    },
  });
  return { root, dbPath, memory };
}

test('claim observability exposes complete multi-evidence provenance', async () => {
  const fixture = await createMultiEvidenceDb('observability');
  try {
    const inspected = fixture.memory.inspectClaimObservability({
      projectId: 'project-a',
      branch: 'main',
      claimId: 'claim-r10d',
    });

    assert.equal(inspected.evidence.id, 'e-user');
    assert.deepEqual(
      inspected.provenance.map((row) => [row.role, row.evidence.id]),
      [
        ['primary', 'e-user'],
        ['supporting', 'e-repo'],
      ],
    );
  } finally {
    fixture.memory.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('Doctor reports complete claim provenance coverage for multi-evidence claims', async () => {
  const fixture = await createMultiEvidenceDb('doctor-coverage');
  try {
    const result = inspectMemoryDatabase({
      dbPath: fixture.dbPath,
      projectId: 'project-a',
      branch: 'main',
    });

    assert.notEqual(result.status, 'broken');
    assert.equal(result.claimEvidenceRows, 2);
    assert.equal(result.provenanceIntegrityViolations, 0);
    assert.equal(result.provenanceCoverageComplete, true);
  } finally {
    fixture.memory.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('Doctor fails closed on logically corrupt claim provenance', async () => {
  const fixture = await createMultiEvidenceDb('doctor-corruption');
  fixture.memory.close();

  const db = new DatabaseSync(fixture.dbPath, {
    timeout: 5_000,
    enableForeignKeyConstraints: true,
  });
  try {
    db.prepare(
      "UPDATE claim_evidence SET role = 'supporting' "
      + "WHERE claim_id = ? AND role = 'primary'",
    ).run('claim-r10d');
  } finally {
    db.close();
  }

  try {
    const result = inspectMemoryDatabase({
      dbPath: fixture.dbPath,
      projectId: 'project-a',
      branch: 'main',
    });

    assert.equal(result.status, 'broken');
    assert.equal(result.provenanceCoverageComplete, false);
    assert.equal(result.provenanceIntegrityViolations, 1);
    assert.equal(result.error, 'claim_provenance_integrity_failed');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
