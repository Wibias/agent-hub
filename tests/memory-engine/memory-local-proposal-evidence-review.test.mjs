import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { EVIDENCE_PROPOSAL_SCHEMA_SQL } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import { inspectUnresolvedMemoryProposals } from '../../scripts/inspect-memory-unresolved-proposals.mjs';
import {
  parseLocalProposalReviewArgs, inspectLocalMemoryProposalEvidence,
} from '../../scripts/inspect-memory-proposal-evidence.mjs';

const PROJECT = 'github.com/example/streamer-content';
const OTHER = 'github.com/example/other';
const BRANCH = 'main';
const SECRET_PROPOSAL = 'PRIVATE_SYNTHETIC_PROPOSAL';
const SECRET_EVIDENCE = 'PRIVATE_SYNTHETIC_EVIDENCE';
const SECRET_CLAIM = 'PRIVATE_SYNTHETIC_CLAIM';
const SCRIPT = fileURLToPath(new URL('../../scripts/inspect-memory-proposal-evidence.mjs', import.meta.url));

async function fixture(fn, { ledger = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'local-proposal-evidence-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  let db;
  try {
    memory.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
    memory.registerProject({ projectId: OTHER, repoIdentity: OTHER });
    const evidence = (id, project = PROJECT, branch = BRANCH, authority = 'user_direct') => {
      memory.recordEvidence({
        id, projectId: project, branch, harness: 'codex',
        sessionId: 'synthetic-session-' + id,
        sourceKind: 'session', sourceRef: 'synthetic:' + id,
        capturedAt: '2026-11-05T00:00:00.000Z',
        content: SECRET_EVIDENCE,
        authorityClass: authority,
        metadata: { event_type: 'user_prompt' },
      });
    };
    evidence('source-user');
    evidence('source-other', PROJECT, BRANCH, 'agent_inference');
    evidence('source-foreign-branch', PROJECT, 'feature');
    evidence('source-foreign-project', OTHER);
    evidence('source-sensitive');
    db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
    db.prepare("UPDATE evidence SET sensitivity='secret_redacted' WHERE id=?")
      .run('source-sensitive');
    if (ledger) {
      db.exec(EVIDENCE_PROPOSAL_SCHEMA_SQL);
      const insert = db.prepare(
        'INSERT INTO memory_evidence_proposals ' +
        '(id,project_id,branch,kind,canonical_fact,status,policy_version,' +
        'evaluator_id,fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      );
      const link = db.prepare(
        'INSERT INTO memory_evidence_proposal_evidence ' +
        '(proposal_id,evidence_id,linked_at) VALUES (?,?,?)',
      );
      const add = (id, status, source = null, project = PROJECT, branch = BRANCH) => {
        insert.run(id, project, branch, 'procedure', SECRET_PROPOSAL + '-' + id,
          status, 'v1', 'test-fixture', 'fp-' + id, '2026-11-05T00:00:00.000Z');
        if (source) link.run(id, source, '2026-11-05T00:00:00.000Z');
      };
      add('proposal-1', 'needs_confirmation', 'source-user');
      add('proposal-2', 'pending', 'source-other');
      add('proposal-3', 'failed', 'source-foreign-branch');
      add('proposal-4', 'pending', 'source-foreign-project');
      add('proposal-5', 'pending');
      add('proposal-6', 'pending', 'source-sensitive');
      add('proposal-ignored', 'ignored', 'source-user');
      add('proposal-other-branch', 'pending', 'source-foreign-branch', PROJECT, 'feature');
      add('proposal-other-project', 'pending', 'source-foreign-project', OTHER);
      const addClaim = db.prepare(
        'INSERT INTO claims ' +
        '(id,project_id,kind,subject,predicate,value_text,state,branch_scope,' +
        'created_from_evidence_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      );
      addClaim.run('claim-main', PROJECT, 'procedure', SECRET_CLAIM + '-subject',
        'requires', SECRET_CLAIM + '-value', 'active', BRANCH,
        'source-user', '2026-11-05T00:00:00.000Z');
      addClaim.run('claim-branch', PROJECT, 'procedure', 'Foreign branch private',
        'requires', 'Foreign branch private value', 'active', 'feature',
        'source-foreign-branch', '2026-11-05T00:00:00.000Z');
      addClaim.run('claim-other', OTHER, 'procedure', 'Foreign project private',
        'requires', 'Foreign project private value', 'active', BRANCH,
        'source-foreign-project', '2026-11-05T00:00:00.000Z');
    }
    return await fn({ db, dbPath });
  } finally {
    db?.close();
    memory.close();
    await rm(root, { recursive: true, force: true });
  }
}

function refAt(dbPath, index) {
  const inventory = inspectUnresolvedMemoryProposals({
    dbPath, projectId: PROJECT, branch: BRANCH,
  });
  return inventory.items[index].proposalRef;
}

function inspect(dbPath, selectedRef, rest = {}) {
  return inspectLocalMemoryProposalEvidence({
    dbPath, projectId: PROJECT, branch: BRANCH, selectedRef, ...rest,
  });
}

test('the inventory opaque ref selects exactly one scoped open proposal, no text by default', async () => {
  await fixture(async ({ db, dbPath }) => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_proposals').get().n;
    const report = inspect(dbPath, refAt(dbPath, 0));
    assert.equal(report.status, 'ok');
    assert.equal(report.readOnly, true);
    assert.equal(report.writesToSource, false);
    assert.equal(report.modelInvocations, 0);
    assert.equal(report.decisionsApplied, 0);
    assert.equal(report.claimsCreated, 0);
    assert.equal(report.promotionAllowed, false);
    assert.equal(report.contentIncluded, false);
    assert.equal(report.proposal.sourcesStructurallyReviewable, true);
    assert.equal(report.proposal.sourceAuthorityNeedsHumanReview, true);
    assert.equal(report.proposal.nonUserDirectEvidencePresent, false);
    assert.equal(report.sources[0].authorityClass, 'user_direct');
    assert.equal(report.sources[0].hostOriginAuthenticatedByThisAudit, false);
    assert.equal(report.claimComparison.total, 1);
    assert.equal(report.claimComparison.items.length, 1);
    assert.equal(report.claimComparison.semanticConflictDetected, null);
    assert.equal(report.recordedRelation, null);
    assert.equal(report.relationLedgerPresent, true);
    const output = JSON.stringify(report);
    for (const forbidden of [
      SECRET_PROPOSAL, SECRET_EVIDENCE, SECRET_CLAIM,
      'source-user', 'claim-main', 'proposal-1', 'memory.sqlite3',
      'Foreign branch private', 'Foreign project private',
    ]) assert.equal(output.includes(forbidden), false, forbidden);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_proposals').get().n, before);
  });
});

test('explicit local review displays only in-scope, normal redacted Evidence and Claims', async () => {
  await fixture(async ({ dbPath }) => {
    const report = inspect(dbPath, refAt(dbPath, 0), { showLocalContent: true });
    assert.equal(report.status, 'ok');
    assert.equal(report.contentIncluded, true);
    assert.match(report.proposal.localCanonicalFact.text, /PRIVATE_SYNTHETIC_PROPOSAL/u);
    assert.match(report.sources[0].localRedactedEvidenceExcerpt, /PRIVATE_SYNTHETIC_EVIDENCE/u);
    assert.match(report.claimComparison.items[0].localValue.text, /PRIVATE_SYNTHETIC_CLAIM/u);
    const json = JSON.stringify(report);
    assert.equal(json.includes('Foreign branch private'), false);
    assert.equal(json.includes('Foreign project private'), false);
    assert.equal(json.includes('source-user'), false);
  });
});

test('other authority, cross-scope Evidence, missing Evidence and secret sensitivity never auto-clear', async () => {
  await fixture(async ({ dbPath }) => {
    const other = inspect(dbPath, refAt(dbPath, 1));
    assert.equal(other.sources[0].authorityClass, 'agent_inference');
    assert.equal(other.proposal.sourceAuthorityNeedsHumanReview, true);
    assert.equal(other.proposal.nonUserDirectEvidencePresent, true);
    for (const index of [2, 3, 4, 5]) {
      const item = inspect(dbPath, refAt(dbPath, index), { showLocalContent: true });
      assert.equal(item.status, 'ok');
      assert.equal(item.contentIncluded, false);
      assert.equal(item.proposal.sourcesStructurallyReviewable, false);
      assert.equal(JSON.stringify(item).includes(SECRET_PROPOSAL), false);
      assert.equal(JSON.stringify(item).includes(SECRET_EVIDENCE), false);
    }
    assert.equal(inspect(dbPath, refAt(dbPath, 2)).sources[0].inScope, false);
    assert.equal(inspect(dbPath, refAt(dbPath, 5)).sources[0].normalSensitivity, false);
  });
});

test('unknown or closed refs and foreign scope cannot be selected', async () => {
  await fixture(async ({ dbPath }) => {
    const valid = refAt(dbPath, 0);
    assert.equal(inspect(dbPath, '~p000000000000').status, 'not_found');
    assert.equal(inspect(dbPath, valid, { branch: 'feature' }).status, 'not_found');
    assert.equal(inspect(dbPath, valid, { projectId: OTHER }).status, 'not_found');
    assert.equal(inspect(dbPath, '~p' + 'abcdefabcdef').status, 'not_found');
  });
});

test('missing proposal schema is an explicit blocker and not a successful empty review', async () => {
  await fixture(async ({ dbPath }) => {
    assert.equal(inspect(dbPath, '~p000000000000').status, 'required_ledger_missing');
  }, { ledger: false });
});

test('CLI rejects non-interactive content export, write flags and ambiguous inputs', async () => {
  await fixture(async ({ dbPath }) => {
    const selectedRef = refAt(dbPath, 0);
    const args = [
      '--db-path', dbPath, '--project-id', PROJECT,
      '--branch', BRANCH, '--proposal-ref', selectedRef,
    ];
    assert.equal(parseLocalProposalReviewArgs(args).selectedRef, selectedRef);
    assert.throws(() => parseLocalProposalReviewArgs([...args, '--apply']), /unsupported/u);
    assert.throws(() => parseLocalProposalReviewArgs([...args, '--branch', 'feature']), /duplicate/u);
    assert.throws(() => parseLocalProposalReviewArgs([...args, '--proposal-ref', 'raw-id']), /duplicate/u);
    assert.throws(() => parseLocalProposalReviewArgs(args.slice(0, -2)), /required/u);
    const cli = spawnSync(process.execPath, [SCRIPT, ...args, '--show-local-content'], {
      encoding: 'utf8',
    });
    assert.equal(cli.status, 1);
    assert.equal(cli.stdout.includes(SECRET_EVIDENCE), false);
    assert.equal(cli.stdout.includes(SECRET_PROPOSAL), false);
    assert.equal(cli.stderr.includes(dbPath), false);
  });
});
