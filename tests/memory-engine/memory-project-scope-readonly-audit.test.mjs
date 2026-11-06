import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { EVIDENCE_PROPOSAL_SCHEMA_SQL } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  inspectProjectRuleScope, parseProjectScopeAuditArgs,
} from '../../scripts/inspect-memory-project-rule-scope.mjs';

const PROJECT = 'github.com/example/app';
const OTHER = 'github.com/example/other';
const BRANCH = 'main';
const PRIVATE = 'SYNTHETIC_PRIVATE_QA_RULE';
const SCRIPT = fileURLToPath(new URL('../../scripts/inspect-memory-project-rule-scope.mjs', import.meta.url));
const pref = id => '~p' + createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 12);

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'memory-project-scope-'));
  const dbPath = join(dir, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  let db;
  try {
    memory.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
    memory.registerProject({ projectId: OTHER, repoIdentity: OTHER });
    for (const [id, projectId, branch, authority] of [
      ['source-main', PROJECT, BRANCH, 'user_direct'],
      ['source-feature', PROJECT, 'feature/wip', 'tool_observation'],
      ['source-other', OTHER, 'main', 'user_direct'],
    ]) {
      memory.recordEvidence({
        id, projectId, branch, sourceKind: 'session', harness: 'codex',
        sessionId: 'synthetic', sourceRef: 'synthetic',
        capturedAt: '2026-11-05T00:00:00.000Z',
        content: PRIVATE + id, authorityClass: authority,
        metadata: { event_type: 'user_prompt' },
      });
    }
    db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
    db.exec(EVIDENCE_PROPOSAL_SCHEMA_SQL);
    const addProposal = (id, projectId, branch, status, evidenceId) => {
      db.prepare(
        'INSERT INTO memory_evidence_proposals ' +
        '(id,project_id,branch,kind,canonical_fact,status,policy_version,' +
        'evaluator_id,fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      ).run(id, projectId, branch, 'procedure', PRIVATE, status, 'v1',
        'synthetic', id, '2026-11-05T00:00:00.000Z');
      db.prepare(
        'INSERT INTO memory_evidence_proposal_evidence (proposal_id,evidence_id,linked_at) ' +
        'VALUES (?,?,?)',
      ).run(id, evidenceId, '2026-11-05T00:00:00.000Z');
    };
    addProposal('proposal-main', PROJECT, BRANCH, 'needs_confirmation', 'source-main');
    addProposal('proposal-feature', PROJECT, 'feature/wip', 'pending', 'source-feature');
    addProposal('proposal-other', OTHER, BRANCH, 'pending', 'source-other');
    db.prepare(
      'INSERT INTO claims (id,project_id,kind,subject,predicate,value_text,state,branch_scope,' +
      'created_from_evidence_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run('feature-claim', PROJECT, 'procedure', PRIVATE, 'requires', PRIVATE,
      'candidate', 'feature/wip', 'source-feature', '2026-11-05T00:00:00.000Z');
    db.prepare(
      'INSERT INTO memory_candidates (id,project_id,branch,source_evidence_id,proposed_type,' +
      'proposed_value,source_authority,status,decision_reason,created_at,policy_version,fingerprint) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run('feature-candidate', PROJECT, 'feature/wip', 'source-feature',
      'decision', PRIVATE, 'tool_observation', 'failed', 'synthetic',
      '2026-11-05T00:00:00.000Z', 'v1', 'fp-feature');
    return await fn({ memory, db, dbPath });
  } finally {
    db?.close();
    memory.close();
    await rm(dir, { recursive: true, force: true });
  }
}
function inspect(dbPath, more = {}) {
  return inspectProjectRuleScope({
    dbPath, projectId: PROJECT, sourceBranch: BRANCH,
    selectedRef: pref('proposal-main'), ...more,
  });
}
test('project-level audit reveals other-branch blockers by count, never raw text', async () => {
  await fixture(async ({ db, dbPath }) => {
    const previous = db.prepare('SELECT COUNT(*) AS n FROM claims').get().n;
    const report = inspect(dbPath);
    assert.equal(report.status, 'manual_project_scope_review_required');
    assert.equal(report.selectedProposal.allSourcesUserDirect, true);
    assert.equal(report.scopedLedgerCounts.branchesWithEntries, 2);
    assert.equal(report.scopedLedgerCounts.claims.projectTotal, 1);
    assert.equal(report.scopedLedgerCounts.claims.sourceBranch, 0);
    assert.equal(report.scopedLedgerCounts.claims.otherBranches, 1);
    assert.equal(report.scopedLedgerCounts.claims.byState.candidate, 1);
    assert.deepEqual(report.scopedLedgerCounts.candidateIntents.byStatus,
      { pending: 0, needs_confirmation: 0, failed: 1 });
    assert.equal(report.scopedLedgerCounts.candidateIntents.otherBranches, 1);
    assert.deepEqual(report.scopedLedgerCounts.evidenceBoundProposals.byStatus,
      { pending: 1, needs_confirmation: 1, failed: 0 });
    assert.equal(report.scopedLedgerCounts.evidenceBoundProposals.otherBranches, 1);
    assert.equal(report.writesToSource, false);
    assert.equal(report.promotionAllowed, false);
    assert.equal(report.hostConsentAuthenticated, false);
    assert.equal(report.semanticConflictChecked, false);
    assert.equal(report.projectWidePropagationImplemented, false);
    assert.equal(report.contentIncluded, false);
    const output = JSON.stringify(report);
    for (const forbidden of [PRIVATE, 'feature/wip', 'source-feature',
      'feature-claim', 'proposal-main', dbPath]) {
      assert.equal(output.includes(forbidden), false, forbidden);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claims').get().n, previous);
  });
});
test('cross-project rows do not leak or count towards project-wide audit', async () => {
  await fixture(async ({ db, dbPath }) => {
    db.prepare('INSERT INTO claims (id,project_id,kind,subject,predicate,value_text,' +
      'state,branch_scope,created_from_evidence_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('other-claim', OTHER, 'knowledge', PRIVATE, 'is', PRIVATE,
        'active', 'main', 'source-other', '2026-11-05T00:00:00.000Z');
    const report = inspect(dbPath);
    assert.equal(report.scopedLedgerCounts.claims.projectTotal, 1);
    assert.equal(report.scopedLedgerCounts.evidenceBoundProposals.byStatus.pending, 1);
  });
});
test('changed evidence scope, secret sensitivity and missing evidence block audit', async () => {
  await fixture(async ({ db, dbPath }) => {
    db.prepare("UPDATE evidence SET sensitivity='secret_redacted' WHERE id='source-main'").run();
    assert.deepEqual(inspect(dbPath).blockers, ['source_evidence_not_safe']);
    db.prepare("UPDATE evidence SET sensitivity='normal', branch='feature/wip' WHERE id='source-main'").run();
    assert.deepEqual(inspect(dbPath).blockers, ['source_evidence_not_safe']);
    db.prepare("UPDATE evidence SET branch='main' WHERE id='source-main'").run();
    db.prepare("DELETE FROM memory_evidence_proposal_evidence WHERE proposal_id='proposal-main'").run();
    assert.deepEqual(inspect(dbPath).blockers, ['source_evidence_not_safe']);
  });
});
test('source branch, opaque reference, and project registration fail closed', async () => {
  await fixture(async ({ dbPath }) => {
    assert.deepEqual(inspect(dbPath, { sourceBranch: 'feature/wip' }).blockers,
      ['source_proposal_not_open']);
    assert.deepEqual(inspect(dbPath, { selectedRef: '~p000000000000' }).blockers,
      ['source_proposal_not_open']);
    assert.deepEqual(inspect(dbPath, { projectId: 'github.com/missing/app' }).blockers,
      ['project_not_registered']);
    assert.throws(() => inspect(dbPath, { selectedRef: 'proposal-main' }), /scope/u);
  });
});
test('missing ledgers block instead of producing zero-count false clearance', async () => {
  await fixture(async ({ db, dbPath }) => {
    db.exec('DROP TABLE memory_evidence_proposal_relations');
    // Relation ledger is intentionally not required for this counting audit.
    assert.equal(inspect(dbPath).status, 'manual_project_scope_review_required');
    db.exec('DROP TABLE memory_candidates');
    assert.deepEqual(inspect(dbPath).blockers, ['required_ledger_missing']);
  });
});
test('CLI stays metadata-only and rejects write flags', async () => {
  await fixture(async ({ dbPath }) => {
    const args = ['--db-path', dbPath, '--project-id', PROJECT,
      '--source-branch', BRANCH, '--proposal-ref', pref('proposal-main')];
    assert.equal(parseProjectScopeAuditArgs(args).sourceBranch, BRANCH);
    assert.throws(() => parseProjectScopeAuditArgs([...args, '--apply']), /option/u);
    assert.throws(() => parseProjectScopeAuditArgs([...args, '--project-id', OTHER]), /option/u);
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'manual_project_scope_review_required');
    assert.equal(result.stdout.includes(PRIVATE), false);
    const fail = spawnSync(process.execPath, [SCRIPT, ...args, '--apply'], { encoding: 'utf8' });
    assert.equal(fail.status, 1);
    assert.equal(fail.stdout, '');
    assert.equal(fail.stderr.includes(dbPath), false);
  });
});
