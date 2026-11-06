import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { memoryCandidateJudgeRef } from '../../memory-engine/memory-candidate-judge.mjs';
import {
  atomicReviewRef, inspectAtomicReviewRows, previewAtomicReviewIntent,
} from '../../memory-engine/memory-atomic-review-provenance.mjs';
import {
  inspectAtomicReviewDb, parseAtomicReviewArgs,
} from '../../scripts/inspect-memory-atomic-review.mjs';

const TEXT = 'You judged the overlay too quickly without test content. '
  + 'You did not research the actual browser behavior. Fix the overlay today.';
const AUDIT = 'For this audit, do not modify the project. Always use read-only checks.';

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'atomic-review-evidence-'));
  const path = join(dir, 'memory.sqlite3');
  const db = new DatabaseSync(path);
  try {
    db.exec(
      'CREATE TABLE memory_candidates ('
      + 'id TEXT, project_id TEXT, branch TEXT, source_authority TEXT,'
      + 'proposed_type TEXT, proposed_value TEXT, status TEXT,'
      + 'evaluated_at TEXT, source_evidence_id TEXT, created_at TEXT);'
      + 'CREATE TABLE evidence ('
      + 'id TEXT, project_id TEXT, branch TEXT, authority_class TEXT, '
      + 'sensitivity TEXT, content_redacted TEXT);',
    );
    const evidence = db.prepare('INSERT INTO evidence VALUES (?,?,?,?,?,?)');
    const candidate = db.prepare('INSERT INTO memory_candidates VALUES (?,?,?,?,?,?,?,?,?,?)');
    evidence.run('e1','repo/project','main','user_direct','public',TEXT);
    candidate.run('c1','repo/project','main','user_direct','correction',TEXT,'pending',null,'e1','2026-11-01');
    evidence.run('e2','repo/project','main','user_direct','public',AUDIT);
    candidate.run('c2','repo/project','main','user_direct','constraint',AUDIT,'pending',null,'e2','2026-11-02');
    // Same branch candidate, but evidence belongs to another branch.
    evidence.run('e3','repo/project','feature','user_direct','public','In future always use a test fixture.');
    candidate.run('c3','repo/project','main','user_direct','constraint','In future always use a test fixture.','pending',null,'e3','2026-11-03');
    // Tampered source evidence, which must be rejected.
    evidence.run('e4','repo/project','main','user_direct','public','A different original source text.');
    candidate.run('c4','repo/project','main','user_direct','correction',TEXT,'pending',null,'e4','2026-11-04');
    // Secret redacted source must not be eligible.
    evidence.run('e5','repo/project','main','user_direct','secret_redacted','In future always use the provided credential.');
    candidate.run('c5','repo/project','main','user_direct','constraint','In future always use the provided credential.','pending',null,'e5','2026-11-05');
    evidence.run('e6','repo/project','feature','user_direct','public','In future always use PostgreSQL.');
    candidate.run('c6','repo/project','feature','user_direct','constraint','In future always use PostgreSQL.','pending',null,'e6','2026-11-06');
    evidence.run('e7','other/repo','main','user_direct','public','In future always use MySQL.');
    candidate.run('c7','other/repo','main','user_direct','constraint','In future always use MySQL.','pending',null,'e7','2026-11-07');
    evidence.run('e8','repo/project','main','agent_inference','public','In future always use agent guesses.');
    candidate.run('c8','repo/project','main','agent_inference','constraint','In future always use agent guesses.','pending',null,'e8','2026-11-08');
    return await run(db, path);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('CLI rejects mutation options, duplicate and incomplete review intent', () => {
  const base = ['--db-path','fixture.sqlite3','--project-id','repo/project','--branch','main'];
  assert.equal(parseAtomicReviewArgs(base).limit,20);
  assert.equal(parseAtomicReviewArgs([...base,'--show-local-content']).showLocalContent,true);
  assert.throws(() => parseAtomicReviewArgs([...base,'--apply']),/unsupported argument/);
  assert.throws(() => parseAtomicReviewArgs([...base,'--branch','other']),/duplicate argument/);
  assert.throws(() => parseAtomicReviewArgs([...base,'--intent','retain_for_confirmation']),/complete selection/);
  assert.throws(() => parseAtomicReviewArgs([...base,'--limit','21']),/limit/);
  assert.throws(() => parseAtomicReviewArgs([...base,'--review-refs','~a123']),/complete selection/);
});

test('read-only review rejects mismatched evidence, secret and unrelated scope', async () => {
  await fixture(async (db,path) => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM memory_candidates').get().n;
    const report = inspectAtomicReviewDb({dbPath:path,projectId:'repo/project',branch:'main'});
    assert.equal(report.readOnly,true);
    assert.equal(report.writesToSource,false);
    assert.equal(report.modelInvocations,0);
    assert.equal(report.canPromote,false);
    assert.equal(report.candidatesInspected,5);
    assert.equal(report.candidatesWithVerifiedEvidence,2);
    assert.equal(report.excludedIntegrity,3);
    assert.equal(report.excludedScopedAudit,1);
    assert.equal(report.candidatesRequiringReview,1);
    assert.equal(report.reviewHintCount,2);
    assert.equal(report.candidates.length,2);
    assert.equal(report.candidates[0].candidateRef,memoryCandidateJudgeRef('c1'));
    assert.equal(report.candidates[0].hints.length,2);
    assert.ok(report.candidates[0].hints.every(x=>/^~a[0-9a-f]{16}$/u.test(x.reviewRef)));
    assert.ok(report.candidates[0].hints.every(x=>!Object.hasOwn(x,'localVerbatimFragment')));
    assert.equal(report.candidates[1].shadowReason,'scoped_audit_protocol');
    assert.equal(report.candidates[1].reviewHintCount,0);
    const output = JSON.stringify(report);
    for (const forbidden of [TEXT,AUDIT,'PostgreSQL','MySQL','provided credential','source_evidence_id','memory.sqlite3']) {
      assert.equal(output.includes(forbidden),false);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_candidates').get().n,n);
  });
});

test('review identity derives from exact candidate, evidence and spans', async () => {
  await fixture(async (db,path) => {
    const report = inspectAtomicReviewDb({dbPath:path,projectId:'repo/project',branch:'main',showLocalContent:true});
    assert.equal(report.contentIncluded,true);
    const first = report.candidates[0];
    assert.equal(first.hints.length,2);
    for(const hint of first.hints){
      assert.ok(TEXT.includes(hint.localVerbatimFragment));
      assert.ok(!hint.localVerbatimFragment.includes('Fix the overlay today'));
    }
    assert.notEqual(first.hints[0].reviewRef,first.hints[1].reviewRef);
    assert.equal(atomicReviewRef({
      candidateId:'candidate',evidenceId:'evidence',sourceHash:'hash',
      start:0,end:10,fragmentHash:'fragment',
    }),atomicReviewRef({
      candidateId:'candidate',evidenceId:'evidence',sourceHash:'hash',
      start:0,end:10,fragmentHash:'fragment',
    }));
    const firstRefs = first.hints.map(x=>x.reviewRef);
    const confirm = previewAtomicReviewIntent({
      report,candidateRef:first.candidateRef,
      reviewRefs:firstRefs,
      intent:'retain_for_confirmation',
    });
    assert.equal(confirm.status,'explicit_direct_user_confirmation_required');
    assert.equal(confirm.claimCreated,false);
    assert.equal(confirm.confirmedDurableRules,0);
    assert.equal(confirm.userConfirmationEvidencePresent,false);
    assert.equal(confirm.selectedHintCount,2);
    assert.equal(JSON.stringify(confirm).includes(TEXT),false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_candidates WHERE status = ?').get('pending').n,8);
  });
});

test('review intent cannot select an unrelated, altered or duplicate reference', async () => {
  await fixture(async (db,path) => {
    const report = inspectAtomicReviewDb({dbPath:path,projectId:'repo/project',branch:'main'});
    const candidateRef = report.candidates[0].candidateRef;
    const ref = report.candidates[0].hints[0].reviewRef;
    assert.throws(()=>previewAtomicReviewIntent({
      report,candidateRef,reviewRefs:[ref,ref],intent:'retain_for_confirmation',
    }),/invalid explicit review intent/);
    assert.throws(()=>previewAtomicReviewIntent({
      report,candidateRef,reviewRefs:['~a0000000000000000'],intent:'retain_for_confirmation',
    }),/not grounded/);
    assert.throws(()=>previewAtomicReviewIntent({
      report,candidateRef:report.candidates[1].candidateRef,
      reviewRefs:[ref],intent:'retain_for_confirmation',
    }),/not grounded/);
    assert.throws(()=>previewAtomicReviewIntent({
      report,candidateRef,reviewRefs:[ref],intent:'promote',
    }),/invalid explicit review intent/);
    const dismissal = previewAtomicReviewIntent({
      report,candidateRef,reviewRefs:[ref],intent:'dismiss_preview',
    });
    assert.equal(dismissal.status,'dismissal_not_applied');
    assert.equal(dismissal.claimCreated,false);
  });
});
