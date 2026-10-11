import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  runEvidenceBoundMemoryPipeline,
} from '../../memory-engine/evidence-bound-memory-pipeline.mjs';
import * as memoryPipeline from '../../memory-engine/evidence-bound-memory-pipeline.mjs';
import { EvidenceBoundProposalStore } from '../../memory-engine/evidence-bound-proposal-store.mjs';

function safeSensitivity() { return { containsSecret: false }; }

async function seedDb() {
  const root = await mkdtemp(join(tmpdir(), 'evidence-memory-pipeline-'));
  const dbPath = join(root, 'memory.sqlite3');
  const db = new DatabaseSync(dbPath, { timeout: 5_000, enableForeignKeyConstraints: true });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE project_registry (project_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE evidence (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      branch TEXT,
      sensitivity TEXT NOT NULL,
      authority_class TEXT NOT NULL,
      source_kind TEXT,
      content_redacted TEXT NOT NULL
    ) STRICT;
    CREATE TABLE claims (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      value_text TEXT NOT NULL,
      state TEXT NOT NULL,
      branch_scope TEXT NOT NULL,
      created_from_evidence_id TEXT NOT NULL REFERENCES evidence(id)
    ) STRICT;
  `);
  db.prepare('INSERT INTO project_registry (project_id) VALUES (?)').run('project-a');
  const insert = db.prepare(`INSERT INTO evidence (
    id, project_id, branch, sensitivity, authority_class, source_kind, content_redacted
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insert.run('e-user', 'project-a', 'main', 'normal', 'user_direct', 'session', 'We use Postgres because several processes write at once.');
  insert.run('e-tool', 'project-a', 'main', 'normal', 'tool_observation', 'tool', 'Observed Postgres handling concurrent writers.');
  db.close();
  return dbPath;
}

function fakeMemory() {
  const evidence = new Map([
    ['e-user', {
      id: 'e-user', project_id: 'project-a', branch: 'main', sensitivity: 'normal',
      authority_class: 'user_direct', content_redacted: 'We use Postgres because several processes write at once.',
      metadata: {},
    }],
    ['e-tool', {
      id: 'e-tool', project_id: 'project-a', branch: 'main', sensitivity: 'normal',
      authority_class: 'tool_observation', content_redacted: 'Observed Postgres handling concurrent writers.',
      metadata: { tool_outcome: 'success' },
    }],
  ]);
  const claims = new Map();
  const provenance = new Map();
  return {
    getEvidence(id) { return evidence.get(id) ?? null; },
    getClaim(id) { return claims.get(id) ?? null; },
    getClaimEvidence(id) { return provenance.get(id) ?? []; },
    assertClaim({ evidenceId, evidenceIds = [evidenceId], claim, lifecycle }) {
      assert.deepEqual(lifecycle, {});
      const stored = {
        id: claim.id, project_id: 'project-a', branch_scope: claim.branchScope,
        kind: claim.kind, subject: claim.subject, predicate: claim.predicate,
        value: claim.value, state: claim.state, created_from_evidence_id: evidenceId,
        created_at: claim.createdAt,
      };
      claims.set(stored.id, stored);
      provenance.set(stored.id, evidenceIds.map((id) => ({
        evidence: evidence.get(id),
        role: id === evidenceId ? 'primary' : 'supporting',
        linked_at: claim.createdAt,
      })));
      return { evidence: evidence.get(evidenceId), claim: stored };
    },
    claims,
  };
}

const importancePromote = {
  decision: 'promote', durability: 'long', future_utility: 'high', confidence: 'high',
  meaning_preserved: true, reason: 'Durable and reusable.', risk_flags: [],
};
const supported = {
  decision: 'supported', confidence: 'high', meaning_preserved: true,
  reason: 'Directly supported.', risk_flags: [],
};

test('full evidence-bound pipeline promotes a supported multi-source fact', async () => {
  assert.equal(typeof runEvidenceBoundMemoryPipeline, 'function');
  const dbPath = await seedDb();
  const memory = fakeMemory();
  let relationCalls = 0;

  const result = await runEvidenceBoundMemoryPipeline({
    dbPath,
    memory,
    projectId: 'project-a',
    branch: 'main',
    evidence: [memory.getEvidence('e-user'), memory.getEvidence('e-tool')],
    inspectTextSensitivity: safeSensitivity,
    evaluatorIds: {
      extraction: 'extractor:test',
      importance: 'importance:test',
      support: 'support:test',
      relation: 'relation:test',
    },
    clock: () => '2026-10-11T12:10:00.000Z',
    extractionJudge: async () => ({
      memories: [{
        kind: 'knowledge',
        canonical_fact: 'Postgres handles concurrent writers in this project.',
        evidence_ids: ['e-user', 'e-tool'],
      }],
    }),
    importanceJudge: async () => importancePromote,
    supportJudge: async () => supported,
    relationJudge: async () => {
      relationCalls += 1;
      throw new Error('no active comparison claims should exist before promotion');
    },
  });

  assert.equal(result.extraction.proposals.length, 1);
  assert.equal(result.importance.evaluated, 1);
  assert.equal(result.support.evaluated, 1);
  assert.equal(result.relation.evaluated, 1);
  assert.equal(relationCalls, 0);
  assert.equal(result.promotion.promoted, 1);
  assert.equal(memory.claims.size, 1);

  const promotedClaim = [...memory.claims.values()][0];
  assert.equal(promotedClaim.created_from_evidence_id, 'e-tool');
  assert.equal(promotedClaim.kind, 'knowledge');

  const store = new EvidenceBoundProposalStore({ dbPath, readOnly: true, inspectTextSensitivity: safeSensitivity });
  try {
    assert.equal(store.list({ projectId: 'project-a', branch: 'main', status: 'pending' }).length, 0);
    const promoted = store.list({ projectId: 'project-a', branch: 'main', status: 'promoted' });
    assert.equal(promoted.length, 1);
    assert.deepEqual(promoted[0].evidence_ids, ['e-tool', 'e-user']);
  } finally { store.close(); }
});

function dbBackedMemory(dbPath) {
  let assertCalls = 0;
  const provenance = new Map();
  return {
    getEvidence(id) {
      const db = new DatabaseSync(dbPath, { readOnly: true, enableForeignKeyConstraints: true });
      try { return db.prepare('SELECT * FROM evidence WHERE id = ?').get(id) ?? null; }
      finally { db.close(); }
    },
    getClaim(id) {
      const db = new DatabaseSync(dbPath, { readOnly: true, enableForeignKeyConstraints: true });
      try {
        const row = db.prepare('SELECT * FROM claims WHERE id = ?').get(id);
        if (!row) return null;
        return {
          id: row.id, project_id: row.project_id, kind: row.kind,
          subject: row.subject, predicate: row.predicate, value: row.value_text,
          state: row.state, branch_scope: row.branch_scope,
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

test('orchestrator interleaves relation and promotion so later paraphrases see earlier claims', async () => {
  const dbPath = await seedDb();
  const memory = dbBackedMemory(dbPath);
  let relationCalls = 0;
  let firstTargetRef = null;

  const result = await runEvidenceBoundMemoryPipeline({
    dbPath,
    memory,
    projectId: 'project-a',
    branch: 'main',
    evidence: [memory.getEvidence('e-user')],
    inspectTextSensitivity: safeSensitivity,
    evaluatorIds: {
      extraction: 'extractor:test', importance: 'importance:test',
      support: 'support:test', relation: 'relation:test',
    },
    clock: () => '2026-10-11T12:20:00.000Z',
    extractionJudge: async () => ({
      memories: [
        { kind: 'procedure', canonical_fact: 'Use Postgres for concurrent writers.', evidence_ids: ['e-user'] },
        { kind: 'procedure', canonical_fact: 'Postgres is the database to use when several processes write concurrently.', evidence_ids: ['e-user'] },
      ],
    }),
    importanceJudge: async () => importancePromote,
    supportJudge: async () => supported,
    relationJudge: async ({ memories }) => {
      relationCalls += 1;
      assert.equal(memories.length, 1);
      firstTargetRef = memories[0].ref;
      return {
        relation: 'same', target_ref: memories[0].ref, confidence: 'high',
        meaning_preserved: true, reason: 'Same database choice.',
      };
    },
  });

  assert.equal(relationCalls, 1);
  assert.match(firstTargetRef, /^@[0-9a-f]{10}$/u);
  assert.equal(result.promotion.promoted, 1);
  assert.equal(result.promotion.superseded, 1);
  assert.equal(memory.assertCalls(), 1);

  const db = new DatabaseSync(dbPath, { readOnly: true, enableForeignKeyConstraints: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM claims').get().count, 1); }
  finally { db.close(); }
});


test('evidence-bound pipeline exposes an isolated judge bundle factory', () => {
  assert.equal(typeof memoryPipeline.createEvidenceBoundJudgeBundle, 'function');
});

test('judge bundle reuses one isolated runner and exposes stage-specific evaluator ids', async () => {
  const factoryCalls = [];
  const prompts = [];
  let closed = 0;
  const bundle = await memoryPipeline.createEvidenceBoundJudgeBundle({
    model: 'gpt-test',
    reasoningEffort: 'high',
    timeoutMs: 90_000,
    env: { TEST_ENV: '1' },
    createJsonJudge: async (options) => {
      factoryCalls.push(options);
      return {
        judge: async (prompt) => {
          prompts.push(prompt);
          return '{"ok":true}';
        },
        async close() { closed += 1; },
      };
    },
  });

  assert.equal(factoryCalls.length, 1);
  assert.equal(factoryCalls[0].workspaceLabel, 'evidence-bound-memory');
  assert.equal(factoryCalls[0].policyVersion, 'evidence-bound-pipeline-v1');
  assert.equal(factoryCalls[0].model, 'gpt-test');
  assert.equal(factoryCalls[0].reasoningEffort, 'high');

  await bundle.extractionJudge({ prompt: 'extract prompt' });
  await bundle.importanceJudge({ prompt: 'importance prompt' });
  await bundle.supportJudge({ prompt: 'support prompt' });
  await bundle.relationJudge({ prompt: 'relation prompt' });
  assert.deepEqual(prompts, [
    'extract prompt', 'importance prompt', 'support prompt', 'relation prompt',
  ]);
  assert.deepEqual(bundle.evaluatorIds, {
    extraction: 'codex:gpt-test:evidence-extraction-v1',
    importance: 'codex:gpt-test:evidence-importance-v1',
    support: 'codex:gpt-test:evidence-support-v1',
    relation: 'codex:gpt-test:evidence-relation-v1',
  });
  await bundle.close();
  assert.equal(closed, 1);
});

test('judge bundle emits per-stage content-free token telemetry when runner exposes usage', async () => {
  const usageEvents = [];
  let lastUsage = null;
  const ticks = [100, 112, 200, 225];
  const bundle = await memoryPipeline.createEvidenceBoundJudgeBundle({
    createJsonJudge: async () => ({
      judge: async (prompt) => {
        lastUsage = prompt.includes('extract')
          ? {
              input_tokens: 100,
              cached_input_tokens: 50,
              cache_write_input_tokens: null,
              output_tokens: 10,
              reasoning_output_tokens: 4,
            }
          : {
              input_tokens: 200,
              cached_input_tokens: 120,
              cache_write_input_tokens: 3,
              output_tokens: 20,
              reasoning_output_tokens: 8,
            };
        return '{}';
      },
      lastUsage: () => lastUsage,
      close: async () => {},
    }),
    onUsage: (event) => usageEvents.push(event),
    clockMs: () => ticks.shift(),
  });

  await bundle.extractionJudge({ prompt: 'extract private content' });
  await bundle.importanceJudge({ prompt: 'importance private content' });

  assert.equal(usageEvents.length, 2);
  assert.equal(usageEvents[0].stage, 'evidence_extraction');
  assert.equal(usageEvents[0].duration_ms, 12);
  assert.equal(usageEvents[0].input_tokens, 100);
  assert.equal(usageEvents[1].stage, 'evidence_importance');
  assert.equal(usageEvents[1].duration_ms, 25);
  assert.equal(usageEvents[1].reasoning_output_tokens, 8);
  assert.equal(JSON.stringify(usageEvents).includes('private content'), false);
  await bundle.close();
});
