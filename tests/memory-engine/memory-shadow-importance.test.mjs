import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { EvidenceBoundProposalStore } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import { evidenceExtractionFingerprint } from '../../memory-engine/evidence-bound-extraction.mjs';
import {
  judgeShadowImportance,
  parseShadowImportanceArgs,
  runShadowImportanceCommand,
} from '../../scripts/judge-memory-shadow-importance.mjs';

const projectId = 'github.com/example/real-project-fixture';
const fact1 = 'The team uses a reviewed release checklist before publishing.';
const fact2 = 'All release notes are signed off by the host.';
const judgment = {
  decision: 'promote',
  durability: 'long',
  future_utility: 'high',
  confidence: 'high',
  meaning_preserved: true,
  reason: 'A reusable workflow agreed by the user.',
  risk_flags: [],
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'memory-importance-only-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'AgentHub-Evidence-Shadow-' + 'b'.repeat(32));
  mkdirSync(folder);
  const dbPath = join(folder, 'memory-shadow.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  try {
    memory.registerProject({ projectId, repoIdentity: projectId });
    for (const [i, fact] of [fact1, fact2].entries()) {
      memory.recordEvidence({
        id: 'source-' + i, projectId, branch: 'main',
        harness: 'codex', sessionId: 'original-session',
        sourceKind: 'session', sourceRef: 'session:original-session',
        capturedAt: '2026-11-15T10:00:00.000Z',
        content: fact, authorityClass: 'user_direct',
        metadata: { event_type: 'user_prompt' },
      });
    }
  } finally { memory.close(); }
  const store = new EvidenceBoundProposalStore({
    dbPath, inspectTextSensitivity: () => ({ containsSecret: false }),
  });
  try {
    for (const [i, fact] of [fact1, fact2].entries()) {
      store.record({
        id: 'pending-proposal-' + i, projectId, branch: 'main', kind: 'procedure',
        canonicalFact: fact, evidenceIds: ['source-' + i],
        fingerprint: evidenceExtractionFingerprint({ kind: 'procedure', canonicalFact: fact }),
        policyVersion: 'evidence-extraction-v1', evaluatorId: 'fixture:extraction',
        createdAt: '2026-11-15T10:00:00.000Z',
      });
    }
  } finally { store.close(); }
  return { root, dbPath };
}

function counts(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return {
      claims: db.prepare('SELECT COUNT(*) AS n FROM claims').get().n,
      evaluated: db.prepare(
        'SELECT COUNT(*) AS n FROM memory_evidence_proposals WHERE importance_json IS NOT NULL',
      ).get().n,
      support: db.prepare(
        'SELECT COUNT(*) AS n FROM memory_evidence_proposals WHERE support_json IS NOT NULL',
      ).get().n,
      relation: db.prepare(
        'SELECT COUNT(*) AS n FROM memory_evidence_proposal_relations',
      ).get().n,
      promotions: db.prepare(
        'SELECT COUNT(*) AS n FROM memory_evidence_proposal_promotions',
      ).get().n,
      statuses: db.prepare('SELECT status FROM memory_evidence_proposals ORDER BY id').all()
        .map(row => row.status),
    };
  } finally { db.close(); }
}

test('default inventory is model-free, read-only and reports two pending importance candidates', async t => {
  const f = fixture(t);
  let touched = false;
  const before = counts(f.dbPath);
  const result = await judgeShadowImportance({
    dbPath: f.dbPath, projectId, branch: 'main', localAppData: f.root,
    createJudge: () => { touched = true; throw Error('unreachable'); },
  });
  assert.equal(result.status, 'shadow_importance_inspected');
  assert.equal(result.importanceRemainingBefore, 2);
  assert.equal(result.modelCallAttempted, false);
  assert.equal(touched, false);
  assert.deepEqual(counts(f.dbPath), before);
});

test('one deliberate model call evaluates exactly one proposal and never starts support or promotion', async t => {
  const f = fixture(t);
  let calls = 0;
  let callbacks = 0;
  let closed = 0;
  const mkJudge = async () => ({
    evaluatorId: 'synthetic-fixture:importance',
    async judge(prompt) {
      calls++;
      assert.match(prompt, /reviewed release checklist/);
      return JSON.stringify(judgment);
    },
    async close() { closed++; },
  });
  const result = await judgeShadowImportance({
    dbPath: f.dbPath, projectId, branch: 'main',
    runModel: true, localAppData: f.root,
    createJudge: mkJudge,
    onModelCallAttempt: () => callbacks++,
  });
  assert.equal(calls, 1);
  assert.equal(callbacks, 1);
  assert.equal(closed, 1);
  assert.equal(result.status, 'shadow_importance_evaluated_unapproved');
  assert.equal(result.importanceRemainingBefore, 2);
  assert.equal(result.importanceRemainingAfter, 1);
  assert.match(result.proposalRef, /^~p[0-9a-f]{12}$/u);
  assert.equal(result.importanceDecision, 'promote');
  assert.equal(result.proposalStatus, 'pending');
  assert.deepEqual(counts(f.dbPath), {
    claims: 0, evaluated: 1, support: 0,
    relation: 0, promotions: 0, statuses: ['pending','pending'],
  });
  assert.doesNotMatch(JSON.stringify(result), /reviewed release checklist|signed off by the host/u);
});

test('needs_confirmation status is review backlog but not authorization, still no Claim', async t => {
  const f = fixture(t);
  const result = await judgeShadowImportance({
    dbPath: f.dbPath, projectId, branch: 'main',
    runModel: true, localAppData: f.root,
    createJudge: async () => ({
      evaluatorId: 'synthetic-fixture:needs_confirmation',
      async judge() {
        return JSON.stringify({
          decision: 'needs_confirmation', durability: 'medium', future_utility: 'high',
          confidence: 'medium', meaning_preserved: true,
          reason: 'Scope requires human check.', risk_flags: ['scope_unclear'],
        });
      },
      async close() {},
    }),
  });
  assert.equal(result.proposalStatus, 'needs_confirmation');
  assert.deepEqual(counts(f.dbPath), {
    claims: 0, evaluated: 1, support: 0,
    relation: 0, promotions: 0, statuses: ['needs_confirmation','pending'],
  });
});

test('a failed judge is not retried and produces content-free CLI status', async t => {
  const f = fixture(t);
  let calls = 0;
  let report = '';
  const exit = await runShadowImportanceCommand({
    argv: [
      '--shadow-db', f.dbPath, '--project-id', projectId,
      '--branch', 'main', '--run-model',
    ],
    run: args => judgeShadowImportance({
      ...args,
      localAppData: f.root,
      createJudge: async () => ({
        evaluatorId: 'synthetic-fixture:quota',
        async judge() { calls++; throw Error("codex isolated memory judge failed with exit 1: You've hit your usage limit " + fact1); },
        async close() {},
      }),
    }),
    write: str => { report += str; },
  });
  assert.equal(exit, 2);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(report).status, 'shadow_importance_failed');
  assert.equal(JSON.parse(report).failure_code, 'usage_limit_reached_possible');
  assert.equal(JSON.parse(report).model_call_attempted, true);
  assert.doesNotMatch(report, /reviewed release checklist|signed off by the host/u);
  assert.deepEqual(counts(f.dbPath), {
    claims: 0, evaluated: 0, support: 0,
    relation: 0, promotions: 0, statuses: ['pending','pending'],
  });
});

test('malformed flags or canonical DB filename fail closed', async t => {
  const f = fixture(t);
  const argv = ['--shadow-db',f.dbPath,'--project-id',projectId,'--branch','main'];
  assert.equal(parseShadowImportanceArgs(argv).runModel, false);
  assert.equal(parseShadowImportanceArgs([...argv,'--run-model']).runModel, true);
  assert.throws(() => parseShadowImportanceArgs([...argv,'--run-model','--run-model']));
  assert.throws(() => parseShadowImportanceArgs([...argv,'--apply']));
  await assert.rejects(judgeShadowImportance({
    dbPath: join(f.root, 'memory.sqlite3'), projectId, branch: 'main',
    localAppData: f.root, runModel: true,
  }));
});
