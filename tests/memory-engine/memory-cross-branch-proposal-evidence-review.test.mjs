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
  inspectCrossBranchProposalEvidence, parseCrossBranchProposalReviewArgs,
} from '../../scripts/inspect-memory-cross-branch-proposal-evidence.mjs';

const PROJECT = 'github.com/example/streamer-content';
const FOREIGN = 'github.com/example/other';
const SOURCE = 'main';
const FEATURE = 'feature/private-gallery';
const PRIVATE_FACT = 'PRIVATE_SYNTHETIC_GALLERY_PROPOSAL_CONTENT';
const PRIVATE_EVIDENCE = 'PRIVATE_SYNTHETIC_TOOL_AND_USER_EVIDENCE';
const SCRIPT = fileURLToPath(new URL(
  '../../scripts/inspect-memory-cross-branch-proposal-evidence.mjs', import.meta.url,
));
const ref = id => '~p' + createHash('sha256').update(id, 'utf8')
  .digest('hex').slice(0, 12);

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'cross-branch-proposal-'));
  const dbPath = join(dir, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  let db;
  try {
    memory.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
    memory.registerProject({ projectId: FOREIGN, repoIdentity: FOREIGN });
    for (const [id, project, branch, authority] of [
      ['source-feature', PROJECT, FEATURE, 'user_direct'],
      ['source-main', PROJECT, SOURCE, 'tool_observation'],
      ['source-foreign', FOREIGN, FEATURE, 'user_direct'],
    ]) {
      memory.recordEvidence({
        id, projectId: project, branch, harness: 'codex',
        sessionId: 'private-session', sourceKind: 'session',
        sourceRef: PRIVATE_EVIDENCE, capturedAt: '2026-11-05T00:00:00.000Z',
        content: PRIVATE_EVIDENCE, authorityClass: authority,
        metadata: { event_type: 'user_prompt' },
      });
    }
    db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
    db.exec(EVIDENCE_PROPOSAL_SCHEMA_SQL);
    const add = (id, project, branch, status, evidence) => {
      db.prepare('INSERT INTO memory_evidence_proposals ' +
        '(id,project_id,branch,kind,canonical_fact,status,policy_version,' +
        'evaluator_id,fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(id, project, branch, 'procedure', PRIVATE_FACT + id, status,
          'v1', 'fixture', id, '2026-11-05T00:00:00.000Z');
      if (evidence) {
        db.prepare('INSERT INTO memory_evidence_proposal_evidence ' +
          '(proposal_id,evidence_id,linked_at) VALUES (?,?,?)')
          .run(id, evidence, '2026-11-05T00:00:00.000Z');
      }
    };
    add('proposal-feature', PROJECT, FEATURE, 'pending', 'source-feature');
    add('proposal-main', PROJECT, SOURCE, 'needs_confirmation', 'source-main');
    add('proposal-closed', PROJECT, FEATURE, 'ignored', 'source-feature');
    add('proposal-foreign', FOREIGN, FEATURE, 'pending', 'source-foreign');
    return await fn({ db, dbPath });
  } finally {
    db?.close();
    memory.close();
    await rm(dir, { recursive: true, force: true });
  }
}
const inspect = (dbPath, selectedRef = ref('proposal-feature'), options = {}) =>
  inspectCrossBranchProposalEvidence({
    dbPath, projectId: PROJECT, sourceBranch: SOURCE, selectedRef, ...options,
  });

test('default cross-branch review resolves opaque ref without text, source path or branch name', async () => {
  await fixture(async ({ db, dbPath }) => {
    const prior = db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_proposals').get().n;
    const report = inspect(dbPath);
    assert.equal(report.status, 'manual_proposal_review_required');
    assert.equal(report.proposal.kind, 'procedure');
    assert.equal(report.proposal.status, 'pending');
    assert.equal(report.proposal.sameAsSourceBranch, false);
    assert.equal(report.proposal.sourcesStructurallyReviewable, true);
    assert.equal(report.proposal.nonUserDirectEvidencePresent, false);
    assert.equal(report.sources[0].authorityClass, 'user_direct');
    assert.equal(report.sources[0].sameProjectAndProposalBranch, true);
    assert.equal(report.sources[0].hostOriginAuthenticatedByThisAudit, false);
    assert.equal(report.readOnly, true);
    assert.equal(report.writesToSource, false);
    assert.equal(report.claimsCreated, 0);
    assert.equal(report.decisionsApplied, 0);
    assert.equal(report.promotionAllowed, false);
    assert.equal(report.hostConsentAuthenticated, false);
    assert.equal(report.evidenceBodyIntegrityVerified, false);
    assert.equal(report.semanticConflictChecked, false);
    assert.equal(report.contentIncluded, false);
    assert.equal(report.projectWidePropagationImplemented, false);
    const output = JSON.stringify(report);
    for (const forbidden of [
      PRIVATE_FACT, PRIVATE_EVIDENCE, 'proposal-feature', 'source-feature',
      FEATURE, FOREIGN, dbPath, 'private-session',
    ]) assert.equal(output.includes(forbidden), false, forbidden);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_proposals').get().n, prior);
  });
});

test('explicit local content reveals only selected scoped proposal and bounded redacted Evidence', async () => {
  await fixture(async ({ dbPath }) => {
    const report = inspect(dbPath, ref('proposal-feature'), { showLocalContent: true });
    assert.equal(report.status, 'manual_proposal_review_required');
    assert.equal(report.contentIncluded, true);
    assert.equal(report.proposal.localCanonicalFact.text, PRIVATE_FACT + 'proposal-feature');
    assert.equal(report.proposal.localCanonicalFact.truncated, false);
    assert.equal(report.sources[0].localRedactedEvidenceExcerpt.text, PRIVATE_EVIDENCE);
    assert.equal(report.sources[0].normalSensitivity, true);
    assert.equal(JSON.stringify(report).includes('proposal-main'), false);
    assert.equal(JSON.stringify(report).includes('source-main'), false);
  });
});

test('tool observation is disclosed as non-user-direct, never auto-authorized', async () => {
  await fixture(async ({ dbPath }) => {
    const report = inspect(dbPath, ref('proposal-main'));
    assert.equal(report.proposal.sameAsSourceBranch, true);
    assert.equal(report.proposal.nonUserDirectEvidencePresent, true);
    assert.equal(report.sources[0].authorityClass, 'tool_observation');
    assert.equal(report.hostConsentAuthenticated, false);
    assert.equal(report.promotionAllowed, false);
  });
});

test('sensitivity and wrong-branch source suppress content even if locally requested', async () => {
  await fixture(async ({ db, dbPath }) => {
    db.prepare("UPDATE evidence SET sensitivity='secret_redacted' WHERE id='source-feature'").run();
    let report = inspect(dbPath, ref('proposal-feature'), { showLocalContent: true });
    assert.equal(report.status, 'blocked');
    assert.equal(report.contentIncluded, false);
    assert.equal(JSON.stringify(report).includes(PRIVATE_FACT), false);
    db.prepare("UPDATE evidence SET sensitivity='normal', branch='main' WHERE id='source-feature'").run();
    report = inspect(dbPath, ref('proposal-feature'), { showLocalContent: true });
    assert.equal(report.status, 'blocked');
    assert.equal(report.contentIncluded, false);
  });
});

test('no Evidence, closed ref, cross-project ref and unknown ref fail closed', async () => {
  await fixture(async ({ db, dbPath }) => {
    for (const selectedRef of [ref('proposal-closed'), ref('proposal-foreign'), '~p000000000000']) {
      assert.deepEqual(inspect(dbPath, selectedRef).blockers, ['proposal_not_open_in_project']);
    }
    db.prepare("DELETE FROM memory_evidence_proposal_evidence WHERE proposal_id='proposal-feature'").run();
    const report = inspect(dbPath, ref('proposal-feature'), { showLocalContent: true });
    assert.equal(report.status, 'blocked');
    assert.deepEqual(report.blockers, ['linked_evidence_not_safe_or_missing']);
    assert.equal(report.contentIncluded, false);
  });
});

test('absent mandatory table and project registration block rather than returning false success', async () => {
  await fixture(async ({ db, dbPath }) => {
    assert.deepEqual(inspect(dbPath, ref('proposal-feature'), {
      projectId: 'github.com/absent/project',
    }).blockers, ['project_not_registered']);
    db.exec('DROP TABLE memory_evidence_proposal_evidence');
    assert.deepEqual(inspect(dbPath).blockers, ['required_ledger_missing']);
  });
});

test('CLI requires interactive TTY for content, refuses write and ambiguous parameters', async () => {
  await fixture(async ({ dbPath }) => {
    const args = ['--db-path', dbPath, '--project-id', PROJECT, '--source-branch', SOURCE,
      '--proposal-ref', ref('proposal-feature')];
    assert.equal(parseCrossBranchProposalReviewArgs(args).selectedRef, ref('proposal-feature'));
    assert.throws(() => parseCrossBranchProposalReviewArgs([...args, '--apply']));
    assert.throws(() => parseCrossBranchProposalReviewArgs([...args, '--show-raw-content']));
    assert.throws(() => parseCrossBranchProposalReviewArgs([
      ...args, '--proposal-ref', ref('proposal-main'),
    ]));
    const metadata = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    assert.equal(metadata.status, 0, metadata.stderr);
    assert.equal(JSON.parse(metadata.stdout).contentIncluded, false);
    const blocked = spawnSync(process.execPath, [SCRIPT, ...args, '--show-local-content'],
      { encoding: 'utf8' });
    assert.equal(blocked.status, 1);
    assert.equal(blocked.stdout, '');
    assert.equal(blocked.stderr.includes(dbPath), false);
    const illegal = spawnSync(process.execPath, [SCRIPT, ...args, '--apply'],
      { encoding: 'utf8' });
    assert.equal(illegal.status, 1);
    assert.equal(illegal.stdout, '');
  });
});
