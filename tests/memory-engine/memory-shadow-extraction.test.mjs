import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { ensureEvidenceProposalSchema } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  extractShadowEvidence,
  parseShadowExtractionArgs,
  requireIsolatedShadow,
  runShadowExtractionCommand,
  sanitizeShadowExtractionFailure,
} from '../../scripts/extract-memory-shadow-evidence.mjs';

const projectId = 'github.com/example/isolated-source';
const fact = 'The team uses a reviewed release checklist on every stable release.';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agenthub-extraction-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const container = join(root, 'AgentHub-Evidence-Shadow-' + 'a'.repeat(32));
  mkdirSync(container);
  const dbPath = join(container, 'memory-shadow.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  try {
    memory.registerProject({ projectId, repoIdentity: projectId });
    memory.recordEvidence({
      id: 'genuine-user-source-1',
      projectId, branch: 'main',
      harness: 'codex',
      sessionId: 'source-session',
      sourceKind: 'session',
      sourceRef: 'session:source-session',
      capturedAt: '2026-11-14T10:00:00.000Z',
      content: fact,
      authorityClass: 'user_direct',
      metadata: { event_type: 'user_prompt' },
    });
  } finally { memory.close(); }
  const db = new DatabaseSync(dbPath);
  try { ensureEvidenceProposalSchema(db); } finally { db.close(); }
  return { root, dbPath, container };
}

test('dry-run only inventories real evidence, no judge creation or writes', async t => {
  const f = fixture(t);
  let invoked = false;
  requireIsolatedShadow(f.dbPath, { localAppData: f.root });
  const result = await extractShadowEvidence({
    dbPath: f.dbPath, projectId, branch: 'main',
    localAppData: f.root,
    createJudge: () => { invoked = true; throw new Error('must not call'); },
  });
  assert.equal(invoked, false);
  assert.equal(result.status, 'shadow_evidence_inspected');
  assert.equal(result.evidenceTotal, 1);
  assert.equal(result.evidenceEligible, 1);
  assert.equal(result.proposalsBefore, 0);
  assert.equal(result.modelCallAttempted, false);
  assert.equal(result.claimsCreated, 0);
  assert.doesNotMatch(JSON.stringify(result), /reviewed release checklist/);
  const db = new DatabaseSync(f.dbPath, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_proposals').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claims').get().n, 0);
  } finally { db.close(); }
});

test('explicit model pathway extracts into pending shadow proposals, never Claim or approval', async t => {
  const f = fixture(t);
  let calls = 0;
  let closed = 0;
  const result = await extractShadowEvidence({
    dbPath: f.dbPath, projectId, branch: 'main', runModel: true,
    localAppData: f.root,
    createJudge: async () => ({
      evaluatorId: 'synthetic-test-evaluator-not-production',
      async judge(prompt) {
        calls += 1;
        assert.match(prompt, /genuine-user-source-1/);
        return JSON.stringify({
          memories: [{ kind: 'knowledge', canonical_fact: fact,
            evidence_ids: ['genuine-user-source-1'] }],
        });
      },
      async close() { closed += 1; },
    }),
  });
  assert.equal(calls, 1);
  assert.equal(closed, 1);
  assert.equal(result.status, 'shadow_extraction_completed_unreviewed');
  assert.equal(result.modelCallAttempted, true);
  assert.equal(result.proposed, 1);
  assert.equal(result.claimsCreated, 0);
  assert.equal(result.decisionsApplied, 0);
  assert.equal(result.protectedApproval, false);
  const db = new DatabaseSync(f.dbPath, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claims').get().n, 0);
    const proposal = db.prepare(
      'SELECT status, evaluator_id, canonical_fact FROM memory_evidence_proposals',
    ).get();
    assert.equal(proposal.status, 'pending');
    assert.equal(proposal.evaluator_id, 'synthetic-test-evaluator-not-production');
    assert.equal(proposal.canonical_fact, fact);
    assert.equal(db.prepare(
      "SELECT COUNT(*) AS n FROM memory_evidence_proposals WHERE status='needs_confirmation'",
    ).get().n, 0);
  } finally { db.close(); }
});

test('invalid paths, canonical DB names, unsupported args and missing scope fail closed', async t => {
  const f = fixture(t);
  const opts = [
    '--shadow-db', f.dbPath, '--project-id', projectId, '--branch', 'main',
  ];
  assert.deepEqual(parseShadowExtractionArgs(opts), {
    dbPath: f.dbPath, projectId, branch: 'main', runModel: false,
  });
  assert.equal(parseShadowExtractionArgs([...opts, '--run-model']).runModel, true);
  assert.throws(() => parseShadowExtractionArgs([...opts, '--run-model', '--run-model']));
  assert.throws(() => parseShadowExtractionArgs([...opts, '--apply']));
  assert.throws(() => parseShadowExtractionArgs([...opts, '--branch', 'evil']));
  assert.throws(() => requireIsolatedShadow(f.dbPath, { localAppData: f.container }),
    /shadow|LOCALAPPDATA/u);
  assert.throws(() => requireIsolatedShadow(
    join(f.container, 'memory.sqlite3'), { localAppData: f.root },
  ));
  await assert.rejects(extractShadowEvidence({
    dbPath: f.dbPath, projectId: 'github.com/wrong', branch: 'main',
    localAppData: f.root,
  }), /not registered/);
});

test('failure classifier reports only fixed quota/CLI/validation codes, never personal output', () => {
  const sensitive = 'PRIVATE_EVIDENCE_AND_SECRET_ACCOUNT_DETAIL';
  const limit = sanitizeShadowExtractionFailure(new Error(
    "codex isolated memory judge failed with exit 1: You've hit your usage limit " + sensitive,
  ), { modelCallAttempted: true });
  assert.equal(limit.status, 'shadow_extraction_failed');
  assert.equal(limit.failure_code, 'usage_limit_reached_possible');
  assert.equal(limit.process_exit_code, 1);
  assert.equal(limit.model_call_attempted, true);
  assert.equal(limit.shadow_proposals_may_have_changed, true);
  assert.equal(limit.claims_created, 0);
  assert.equal(limit.protected_approval, false);
  assert.doesNotMatch(JSON.stringify(limit), /PRIVATE_EVIDENCE|SECRET_ACCOUNT_DETAIL/);

  const unavailable = sanitizeShadowExtractionFailure(new Error(
    'codex isolated memory judge failed with exit 7: ' + sensitive,
  ), { modelCallAttempted: true });
  assert.equal(unavailable.failure_code, 'codex_exec_nonzero_unclassified');
  assert.equal(unavailable.process_exit_code, 7);
  assert.doesNotMatch(JSON.stringify(unavailable), /PRIVATE_EVIDENCE|SECRET_ACCOUNT_DETAIL/);

  const noAuth = sanitizeShadowExtractionFailure(new Error(
    'isolated memory judge requires an authenticated Codex home containing auth.json',
  ));
  assert.equal(noAuth.failure_code, 'auth_file_missing_or_invalid');
  assert.equal(noAuth.model_call_attempted, false);
  assert.equal(noAuth.shadow_proposals_may_have_changed, false);

  assert.equal(sanitizeShadowExtractionFailure(
    new Error('evidence extraction response must be JSON: ' + sensitive),
    { modelCallAttempted: true },
  ).failure_code, 'extraction_validation_failed');

  assert.equal(sanitizeShadowExtractionFailure(
    new Error('shadow file missing from LOCALAPPDATA'),
  ).failure_code, 'shadow_preflight_or_storage_failure');
});

test('CLI reports sanitized attempted status with injected judge failure and zero real calls', async () => {
  const argumentsList = [
    '--shadow-db', '/tmp/AgentHub-Evidence-Shadow-' + 'a'.repeat(32) + '/memory-shadow.sqlite3',
    '--project-id', projectId, '--branch', 'main', '--run-model',
  ];
  let attempted = false;
  let output = '';
  const rc = await runShadowExtractionCommand({
    argv: argumentsList,
    run: async ({ runModel, onModelCallAttempt }) => {
      assert.equal(runModel, true);
      onModelCallAttempt();
      attempted = true;
      throw new Error('codex isolated memory judge failed with exit 1: usage_limit_reached ' + fact);
    },
    write: text => { output += text; },
  });
  assert.equal(attempted, true);
  assert.equal(rc, 2);
  const parsed = JSON.parse(output);
  assert.equal(parsed.status, 'shadow_extraction_failed');
  assert.equal(parsed.failure_code, 'usage_limit_reached_possible');
  assert.equal(parsed.model_call_attempted, true);
  assert.equal(parsed.process_exit_code, 1);
  assert.doesNotMatch(output, /reviewed release checklist/);
});
