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
  judgeShadowSupport,
  parseShadowSupportArgs,
  runShadowSupportCommand,
} from '../../scripts/judge-memory-shadow-support.mjs';

const projectId = 'github.com/example/test-scope';
const facts = ['The team runs an explicit release checklist.', 'Deployment requires a reviewed release note.'];
const importancePromote = {
  decision: 'promote', durability: 'long', future_utility: 'high',
  confidence: 'high', meaning_preserved: true, reason: 'Reusable workflow.',
  risk_flags: [],
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agenthub-shadow-support-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'AgentHub-Evidence-Shadow-' + 'c'.repeat(32));
  mkdirSync(folder);
  const dbPath = join(folder, 'memory-shadow.sqlite3');
  const engine = new MemoryEngine({ dbPath });
  try {
    engine.registerProject({ projectId, repoIdentity: projectId });
    facts.forEach((fact, i) => {
      engine.recordEvidence({
        id: 'evidence-' + i, projectId, branch: 'main', harness: 'codex',
        sessionId: 'actual-input-session', sourceKind: 'session',
        sourceRef: 'session:actual-input-session',
        capturedAt: '2026-11-15T20:00:00.000Z', content: fact,
        authorityClass: 'user_direct', metadata: { event_type: 'user_prompt' },
      });
    });
  } finally { engine.close(); }
  const store = new EvidenceBoundProposalStore({
    dbPath, inspectTextSensitivity: () => ({ containsSecret: false }),
  });
  try {
    facts.forEach((fact, i) => {
      store.record({
        id: 'proposal-' + i, projectId, branch: 'main', kind: 'procedure',
        canonicalFact: fact, evidenceIds: ['evidence-' + i],
        fingerprint: evidenceExtractionFingerprint({ kind: 'procedure', canonicalFact: fact }),
        policyVersion: 'evidence-extraction-v1', evaluatorId: 'synthetic-fixture:extract',
        createdAt: '2026-11-15T20:00:00.000Z',
      });
    });
    store.evaluateImportance({
      proposalId: 'proposal-0', evaluatorId: 'synthetic-fixture:importance',
      policyVersion: 'evidence-importance-v1', judgment: importancePromote,
      evaluatedAt: '2026-11-15T20:05:00.000Z',
    });
  } finally { store.close(); }
  return { root, dbPath };
}

function counts(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return {
      claims: db.prepare('SELECT COUNT(*) AS n FROM claims').get().n,
      supported: db.prepare(
        'SELECT COUNT(*) AS n FROM memory_evidence_proposals WHERE support_json IS NOT NULL',
      ).get().n,
      relations: db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_proposal_relations').get().n,
      promotions: db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_proposal_promotions').get().n,
      statuses: db.prepare('SELECT status FROM memory_evidence_proposals ORDER BY id').all().map(x => x.status),
    };
  } finally { db.close(); }
}

test('default is model-free and write-free; only Importance-promote is support eligible', async t => {
  const f = fixture(t);
  const before = counts(f.dbPath);
  let createdJudge = false;
  const report = await judgeShadowSupport({
    dbPath: f.dbPath, projectId, branch: 'main',
    localAppData: f.root,
    createJudge: () => { createdJudge = true; throw Error('unexpected'); },
  });
  assert.equal(report.status, 'shadow_support_inspected');
  assert.equal(report.supportRemainingBefore, 1);
  assert.equal(report.modelCallAttempted, false);
  assert.equal(createdJudge, false);
  assert.deepEqual(counts(f.dbPath), before);
});

test('one explicit support assessment succeeds without Claim, relation or promotion writes', async t => {
  const f = fixture(t);
  let judged = 0;
  let closed = 0;
  let modelAttempted = 0;
  const report = await judgeShadowSupport({
    dbPath: f.dbPath, projectId, branch: 'main',
    localAppData: f.root, runModel: true,
    createJudge: async () => ({
      evaluatorId: 'synthetic-fixture:support',
      async judge(prompt) {
        judged++;
        assert.match(prompt, /runs an explicit release checklist/);
        assert.match(prompt, /evidence-0/);
        assert.doesNotMatch(prompt, /Deployment requires a reviewed release note/u);
        return JSON.stringify({
          decision: 'supported', confidence: 'high',
          meaning_preserved: true, reason: 'Cited source explicitly says the same.',
          risk_flags: [],
        });
      },
      async close() { closed++; },
    }),
    onModelCallAttempt: () => { modelAttempted++; },
  });
  assert.equal(judged, 1);
  assert.equal(closed, 1);
  assert.equal(modelAttempted, 1);
  assert.equal(report.status, 'shadow_support_evaluated_unapproved');
  assert.equal(report.supportDecision, 'supported');
  assert.equal(report.proposalStatus, 'pending');
  assert.equal(report.supportRemainingAfter, 0);
  assert.equal(report.claimsCreated, 0);
  assert.equal(report.protectedApproval, false);
  assert.deepEqual(counts(f.dbPath), {
    claims: 0, supported: 1, relations: 0, promotions: 0, statuses: ['pending', 'pending'],
  });
  assert.doesNotMatch(JSON.stringify(report), /runs an explicit release checklist/u);
});

test('ambiguous evidence support moves proposal to unapproved review state', async t => {
  const f = fixture(t);
  const report = await judgeShadowSupport({
    dbPath: f.dbPath, projectId, branch: 'main', localAppData: f.root,
    runModel: true,
    createJudge: async () => ({
      evaluatorId: 'synthetic-fixture:support-unclear',
      async judge() {
        return JSON.stringify({
          decision: 'needs_confirmation', confidence: 'medium',
          meaning_preserved: false, reason: 'One scope detail is missing.',
          risk_flags: ['ambiguous_support'],
        });
      },
      async close() {},
    }),
  });
  assert.equal(report.supportDecision, 'needs_confirmation');
  assert.equal(report.proposalStatus, 'needs_confirmation');
  assert.deepEqual(counts(f.dbPath), {
    claims: 0, supported: 1, relations: 0, promotions: 0,
    statuses: ['needs_confirmation', 'pending'],
  });
});

test('quota failure is not retried, does not reveal source text and does not create Claims', async t => {
  const f = fixture(t);
  let calls = 0;
  let output = '';
  const code = await runShadowSupportCommand({
    argv: [
      '--shadow-db',f.dbPath,'--project-id',projectId,
      '--branch','main','--run-model',
    ],
    run: args => judgeShadowSupport({
      ...args, localAppData: f.root,
      createJudge: async () => ({
        evaluatorId: 'synthetic-fixture:quota',
        async judge() {
          calls++;
          throw Error('codex isolated memory judge failed with exit 1: usage_limit_reached ' + facts[0]);
        },
        async close() {},
      }),
    }),
    write: line => { output += line; },
  });
  assert.equal(code, 2);
  assert.equal(calls, 1);
  const result = JSON.parse(output);
  assert.equal(result.status, 'shadow_support_failed');
  assert.equal(result.failure_code, 'usage_limit_reached_possible');
  assert.equal(result.model_call_attempted, true);
  assert.doesNotMatch(output, /release checklist|reviewed release note/u);
  assert.deepEqual(counts(f.dbPath), {
    claims: 0, supported: 0, relations: 0, promotions: 0, statuses: ['pending','pending'],
  });
});

test('invalid flags and non-Shadow database names are rejected', async t => {
  const f = fixture(t);
  const args = ['--shadow-db',f.dbPath,'--project-id',projectId,'--branch','main'];
  assert.equal(parseShadowSupportArgs(args).runModel, false);
  assert.equal(parseShadowSupportArgs([...args,'--run-model']).runModel, true);
  assert.throws(() => parseShadowSupportArgs([...args,'--run-model','--run-model']));
  assert.throws(() => parseShadowSupportArgs([...args,'--apply']));
  await assert.rejects(judgeShadowSupport({
    dbPath: join(f.root,'memory.sqlite3'), projectId, branch: 'main',
    localAppData: f.root, runModel: true,
  }));
});
