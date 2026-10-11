import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { RunObservationBuffer } from '../../memory-engine/run-observation-buffer.mjs';
import {
  canonicalEvidenceIdForRunObservation,
  runEvidenceBoundExtractionFromBufferedTurn,
} from '../../memory-engine/evidence-bound-buffered-run-pipeline.mjs';
import { EvidenceBoundProposalStore } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import * as bufferedPipeline from '../../memory-engine/evidence-bound-buffered-run-pipeline.mjs';

function safeSensitivity(value) {
  return { containsSecret: false, redacted: String(value) };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'buffered-run-pipeline-'));
  const dbPath = join(root, 'memory.sqlite3');
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec(`
    CREATE TABLE project_registry (project_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE evidence (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      branch TEXT,
      sensitivity TEXT NOT NULL,
      authority_class TEXT NOT NULL,
      source_kind TEXT,
      source_ref TEXT,
      captured_at TEXT,
      commit_sha TEXT,
      content_redacted TEXT NOT NULL,
      metadata_json TEXT
    ) STRICT;
  `);
  db.prepare('INSERT INTO project_registry VALUES (?)').run('project-a');
  db.close();

  const buffer = new RunObservationBuffer({ dbPath });
  buffer.record({
    id: 'obs-user', projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T1',
    sourceKind: 'session', sourceRef: 'session:S1', observedAt: '2026-10-11T12:00:00.000Z',
    authorityClass: 'user_direct', sensitivity: 'normal',
    contentRedacted: 'We use Postgres for concurrent writes.',
    metadata: { event_type: 'user_prompt', revision_sha: 'a'.repeat(40) },
  });
  buffer.record({
    id: 'obs-tool', projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T1',
    sourceKind: 'tool', sourceRef: 'tool:Bash:tool-1', observedAt: '2026-10-11T12:01:00.000Z',
    authorityClass: 'tool_observation', sensitivity: 'normal',
    contentRedacted: 'Postgres accepted concurrent writes in the test.',
    metadata: {
      event_type: 'post_tool_use',
      tool_name: 'Bash',
      tool_outcome: 'success',
      revision_sha: 'a'.repeat(40),
    },
  });
  buffer.record({
    id: 'obs-unused', projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T1',
    sourceKind: 'tool', sourceRef: 'tool:Bash:tool-2', observedAt: '2026-10-11T12:02:00.000Z',
    authorityClass: 'tool_observation', sensitivity: 'normal',
    contentRedacted: 'Unrelated UI test passed.',
    metadata: { event_type: 'post_tool_use', tool_name: 'Bash', revision_sha: 'a'.repeat(40) },
  });
  buffer.close();
  return dbPath;
}

function fakeProtocol(dbPath) {
  const calls = [];
  return {
    calls,
    async handle(request) {
      calls.push(request);
      assert.equal(request.operation, 'capture_evidence');
      const p = request.payload;
      const authority = p.source_kind === 'session' ? 'user_direct' : 'tool_observation';
      const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
      try {
        db.prepare(`INSERT INTO evidence (
          id, project_id, branch, sensitivity, authority_class,
          source_kind, source_ref, captured_at, commit_sha, content_redacted,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(p.id, p.project_id, p.branch, 'normal', authority, p.source_kind,
            p.source_ref, p.captured_at, p.commit_sha, p.content,
            JSON.stringify(p.metadata ?? {}));
      } finally { db.close(); }
      return {
        ok: true,
        result: { evidence: {
          id: p.id, project_id: p.project_id, branch: p.branch, sensitivity: 'normal',
          authority_class: authority, source_kind: p.source_kind, source_ref: p.source_ref,
          captured_at: p.captured_at, commit_sha: p.commit_sha, content_redacted: p.content,
          metadata: p.metadata ?? {},
        } },
      };
    },
  };
}

function readEvidence(dbPath, id) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT * FROM evidence WHERE id = ?').get(id);
    if (!row) return null;
    return {
      ...row,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
    };
  } finally { db.close(); }
}

function fakeMemory(dbPath) {
  return {
    getEvidence(id) { return readEvidence(dbPath, id); },
  };
}

test('buffered run extraction materializes only cited observations before proposal persistence', async () => {
  const dbPath = await setup();
  const protocol = fakeProtocol(dbPath);
  const memory = fakeMemory(dbPath);

  const result = await runEvidenceBoundExtractionFromBufferedTurn({
    dbPath,
    protocol,
    memory,
    projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T1',
    extractionJudge: async () => ({ memories: [{
      kind: 'knowledge',
      canonical_fact: 'Postgres is used for concurrent writes.',
      evidence_ids: ['obs-user', 'obs-tool'],
    }] }),
    evaluatorId: 'extractor:test',
    inspectTextSensitivity: safeSensitivity,
    clock: () => '2026-10-11T12:03:00.000Z',
  });

  assert.equal(protocol.calls.length, 2);
  assert.deepEqual(
    new Set(protocol.calls.map((call) => call.payload.metadata.run_observation_id)),
    new Set(['obs-user', 'obs-tool']),
  );
  assert.equal(result.proposals.length, 1);
  assert.equal(result.failed, 0);

  const expectedIds = ['obs-user', 'obs-tool']
    .map((id) => canonicalEvidenceIdForRunObservation(id))
    .sort();
  assert.deepEqual(result.proposals[0].evidence_ids, expectedIds);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM evidence').get().count, 2);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM evidence WHERE id = ?')
        .get(canonicalEvidenceIdForRunObservation('obs-unused')).count,
      0,
    );
  } finally { db.close(); }
});

test('buffered run extraction retry reuses deterministic canonical evidence and proposal ids', async () => {
  const dbPath = await setup();
  const protocol = fakeProtocol(dbPath);
  const memory = fakeMemory(dbPath);
  const args = {
    dbPath, protocol, memory,
    projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T1',
    extractionJudge: async () => ({ memories: [{
      kind: 'procedure', canonical_fact: 'Use Postgres for concurrent writers.', evidence_ids: ['obs-user'],
    }] }),
    evaluatorId: 'extractor:test', inspectTextSensitivity: safeSensitivity,
    clock: () => '2026-10-11T12:03:00.000Z',
  };

  const first = await runEvidenceBoundExtractionFromBufferedTurn(args);
  const second = await runEvidenceBoundExtractionFromBufferedTurn(args);
  assert.equal(protocol.calls.length, 1);
  assert.equal(first.proposals[0].id, second.proposals[0].id);

  const store = new EvidenceBoundProposalStore({ dbPath, readOnly: true, inspectTextSensitivity: safeSensitivity });
  try {
    assert.equal(store.list({ projectId: 'project-a', branch: 'main', status: 'pending' }).length, 1);
  } finally { store.close(); }
});

test('buffered run extraction skips model and canonical materialization when turn buffer is empty', async () => {
  const dbPath = await setup();
  const protocol = fakeProtocol(dbPath);
  const memory = fakeMemory(dbPath);
  let judgeCalls = 0;

  const result = await runEvidenceBoundExtractionFromBufferedTurn({
    dbPath, protocol, memory,
    projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'missing',
    extractionJudge: async () => { judgeCalls += 1; return { memories: [] }; },
    evaluatorId: 'extractor:test', inspectTextSensitivity: safeSensitivity,
  });

  assert.equal(judgeCalls, 0);
  assert.equal(protocol.calls.length, 0);
  assert.deepEqual(result.proposals, []);
});

test('buffered run extraction requires a normal user-prompt observation before judging tool outputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'buffered-run-tool-only-'));
  const dbPath = join(root, 'memory.sqlite3');
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec(`
    CREATE TABLE project_registry (project_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE evidence (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      branch TEXT, sensitivity TEXT NOT NULL, authority_class TEXT NOT NULL,
      source_kind TEXT, source_ref TEXT, captured_at TEXT, commit_sha TEXT,
      content_redacted TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare('INSERT INTO project_registry VALUES (?)').run('project-a');
  db.close();
  const buffer = new RunObservationBuffer({ dbPath });
  buffer.record({
    id: 'tool-only', projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T1',
    sourceKind: 'tool', sourceRef: 'tool:Bash:x', observedAt: '2026-10-11T12:00:00.000Z',
    authorityClass: 'tool_observation', sensitivity: 'normal', contentRedacted: 'Observed Postgres.',
    metadata: { event_type: 'post_tool_use' },
  });
  buffer.close();
  let judgeCalls = 0;
  const result = await runEvidenceBoundExtractionFromBufferedTurn({
    dbPath, protocol: fakeProtocol(dbPath), memory: fakeMemory(dbPath),
    projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T1',
    extractionJudge: async () => { judgeCalls += 1; return { memories: [] }; },
    evaluatorId: 'extractor:test', inspectTextSensitivity: safeSensitivity,
  });
  assert.equal(judgeCalls, 0);
  assert.deepEqual(result.proposals, []);
  assert.equal(result.skipped_reason, 'missing_user_prompt_observation');
});


test('buffered pipeline exposes a full memory-pipeline orchestrator', () => {
  assert.equal(typeof bufferedPipeline.runEvidenceBoundBufferedMemoryPipeline, 'function');
});

function claimMemory(dbPath) {
  let assertCalls = 0;
  const provenance = new Map();
  return {
    getEvidence(id) { return readEvidence(dbPath, id); },
    getClaim(id) {
      const db = new DatabaseSync(dbPath, { readOnly: true, enableForeignKeyConstraints: true });
      try {
        const row = db.prepare('SELECT * FROM claims WHERE id = ?').get(id);
        if (!row) return null;
        return {
          id: row.id,
          project_id: row.project_id,
          kind: row.kind,
          subject: row.subject,
          predicate: row.predicate,
          value: row.value_text,
          state: row.state,
          branch_scope: row.branch_scope,
          created_from_evidence_id: row.created_from_evidence_id,
        };
      } finally { db.close(); }
    },
    getClaimEvidence(id) {
      const stored = provenance.get(id);
      if (stored) return stored;
      const claim = this.getClaim(id);
      if (!claim) return [];
      const evidence = this.getEvidence(claim.created_from_evidence_id);
      return evidence ? [{ evidence, role: 'primary', linked_at: null }] : [];
    },
    assertClaim({ evidenceId, evidenceIds = [evidenceId], claim, lifecycle }) {
      assert.deepEqual(lifecycle, {});
      assertCalls += 1;
      const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
      try {
        db.prepare(`INSERT INTO claims (
          id, project_id, kind, subject, predicate, value_text, state,
          branch_scope, created_from_evidence_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            claim.id, 'project-a', claim.kind, claim.subject, claim.predicate,
            claim.value, claim.state, claim.branchScope, evidenceId,
          );
      } finally { db.close(); }
      provenance.set(claim.id, evidenceIds.map((id) => ({
        evidence: this.getEvidence(id),
        role: id === evidenceId ? 'primary' : 'supporting',
        linked_at: claim.createdAt,
      })));
      return { evidence: this.getEvidence(evidenceId), claim: this.getClaim(claim.id) };
    },
    assertCalls() { return assertCalls; },
  };
}

test('buffered memory pipeline runs cited user evidence through all gates to one claim', async () => {
  const dbPath = await setup();
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  try {
    db.exec(`CREATE TABLE claims (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      value_text TEXT NOT NULL,
      state TEXT NOT NULL,
      branch_scope TEXT NOT NULL,
      created_from_evidence_id TEXT NOT NULL REFERENCES evidence(id)
    ) STRICT;`);
  } finally { db.close(); }

  const protocol = fakeProtocol(dbPath);
  const memory = claimMemory(dbPath);
  let relationJudgeCalls = 0;
  const result = await bufferedPipeline.runEvidenceBoundBufferedMemoryPipeline({
    dbPath,
    protocol,
    memory,
    projectId: 'project-a',
    branch: 'main',
    sessionId: 'S1',
    turnId: 'T1',
    inspectTextSensitivity: safeSensitivity,
    evaluatorIds: {
      extraction: 'extractor:test',
      importance: 'importance:test',
      support: 'support:test',
      relation: 'relation:test',
    },
    clock: () => '2026-10-11T12:10:00.000Z',
    extractionJudge: async () => ({ memories: [{
      kind: 'procedure',
      canonical_fact: 'Use Postgres for concurrent writers.',
      evidence_ids: ['obs-user'],
    }] }),
    importanceJudge: async () => ({
      decision: 'promote', durability: 'long', future_utility: 'high', confidence: 'high',
      meaning_preserved: true, reason: 'Durable and reusable.', risk_flags: [],
    }),
    supportJudge: async () => ({
      decision: 'supported', confidence: 'high', meaning_preserved: true,
      reason: 'Directly stated by the user.', risk_flags: [],
    }),
    relationJudge: async () => {
      relationJudgeCalls += 1;
      throw new Error('no comparison claim exists');
    },
  });

  assert.equal(result.extraction.proposals.length, 1);
  assert.equal(result.importance.evaluated, 1);
  assert.equal(result.support.evaluated, 1);
  assert.equal(result.relation.evaluated, 1);
  assert.equal(result.promotion.promoted, 1);
  assert.equal(relationJudgeCalls, 0);
  assert.equal(memory.assertCalls(), 1);
  assert.equal(protocol.calls.length, 1);

  const stored = new DatabaseSync(dbPath, { readOnly: true, enableForeignKeyConstraints: true });
  try {
    const claim = stored.prepare('SELECT * FROM claims').get();
    assert.equal(claim.value_text, 'Use Postgres for concurrent writers.');
    assert.equal(claim.created_from_evidence_id, canonicalEvidenceIdForRunObservation('obs-user'));
  } finally { stored.close(); }
});

test('buffered memory pipeline promotes supported multi-evidence proposal', async () => {
  const dbPath = await setup();
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  try {
    db.exec(`CREATE TABLE claims (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      value_text TEXT NOT NULL,
      state TEXT NOT NULL,
      branch_scope TEXT NOT NULL,
      created_from_evidence_id TEXT NOT NULL REFERENCES evidence(id)
    ) STRICT;`);
  } finally { db.close(); }

  const protocol = fakeProtocol(dbPath);
  const memory = claimMemory(dbPath);
  let relationJudgeCalls = 0;
  const result = await bufferedPipeline.runEvidenceBoundBufferedMemoryPipeline({
    dbPath, protocol, memory,
    projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T1',
    inspectTextSensitivity: safeSensitivity,
    evaluatorIds: {
      extraction: 'extractor:test', importance: 'importance:test',
      support: 'support:test', relation: 'relation:test',
    },
    clock: () => '2026-10-11T12:10:00.000Z',
    extractionJudge: async () => ({ memories: [{
      kind: 'knowledge',
      canonical_fact: 'Postgres is used and observed handling concurrent writers.',
      evidence_ids: ['obs-user', 'obs-tool'],
    }] }),
    importanceJudge: async () => ({
      decision: 'promote', durability: 'long', future_utility: 'high', confidence: 'high',
      meaning_preserved: true, reason: 'Durable and reusable.', risk_flags: [],
    }),
    supportJudge: async () => ({
      decision: 'supported', confidence: 'high', meaning_preserved: true,
      reason: 'Supported by both observations.', risk_flags: [],
    }),
    relationJudge: async () => { relationJudgeCalls += 1; return null; },
  });

  assert.equal(result.extraction.proposals.length, 1);
  assert.equal(result.support.evaluated, 1);
  assert.equal(result.relation.evaluated, 1);
  assert.equal(result.promotion.promoted, 1);
  assert.equal(relationJudgeCalls, 0);
  assert.equal(memory.assertCalls(), 1);

  const store = new EvidenceBoundProposalStore({
    dbPath, readOnly: true, inspectTextSensitivity: safeSensitivity,
  });
  try {
    assert.equal(store.list({ projectId: 'project-a', branch: 'main', status: 'pending' }).length, 0);
    const promoted = store.list({ projectId: 'project-a', branch: 'main', status: 'promoted' });
    assert.equal(promoted.length, 1);
    assert.equal(promoted[0].evidence_ids.length, 2);
  } finally { store.close(); }
});

test('buffered memory pipeline retry does not duplicate canonical evidence or promoted claim', async () => {
  const dbPath = await setup();
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  try {
    db.exec(`CREATE TABLE claims (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      value_text TEXT NOT NULL,
      state TEXT NOT NULL,
      branch_scope TEXT NOT NULL,
      created_from_evidence_id TEXT NOT NULL REFERENCES evidence(id)
    ) STRICT;`);
  } finally { db.close(); }

  const protocol = fakeProtocol(dbPath);
  const memory = claimMemory(dbPath);
  const args = {
    dbPath, protocol, memory,
    projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T1',
    inspectTextSensitivity: safeSensitivity,
    evaluatorIds: {
      extraction: 'extractor:test', importance: 'importance:test',
      support: 'support:test', relation: 'relation:test',
    },
    clock: () => '2026-10-11T12:10:00.000Z',
    extractionJudge: async () => ({ memories: [{
      kind: 'procedure', canonical_fact: 'Use Postgres for concurrent writers.', evidence_ids: ['obs-user'],
    }] }),
    importanceJudge: async () => ({
      decision: 'promote', durability: 'long', future_utility: 'high', confidence: 'high',
      meaning_preserved: true, reason: 'Durable and reusable.', risk_flags: [],
    }),
    supportJudge: async () => ({
      decision: 'supported', confidence: 'high', meaning_preserved: true,
      reason: 'Directly stated by the user.', risk_flags: [],
    }),
    relationJudge: async () => { throw new Error('no comparison claim exists on first run'); },
  };

  const first = await bufferedPipeline.runEvidenceBoundBufferedMemoryPipeline(args);
  const second = await bufferedPipeline.runEvidenceBoundBufferedMemoryPipeline(args);

  assert.equal(first.promotion.promoted, 1);
  assert.equal(second.promotion.promoted, 0);
  assert.equal(memory.assertCalls(), 1);
  assert.equal(protocol.calls.length, 1);

  const stored = new DatabaseSync(dbPath, { readOnly: true, enableForeignKeyConstraints: true });
  try {
    assert.equal(stored.prepare('SELECT COUNT(*) AS count FROM evidence').get().count, 1);
    assert.equal(stored.prepare('SELECT COUNT(*) AS count FROM claims').get().count, 1);
  } finally { stored.close(); }
});

test('buffered pipeline exposes a cheap eligibility check before judge creation', () => {
  assert.equal(typeof bufferedPipeline.inspectBufferedTurnEligibility, 'function');
});
