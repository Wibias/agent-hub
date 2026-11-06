import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectAtomicReviewDb } from '../../scripts/inspect-memory-atomic-review.mjs';
import {
  parseAtomicRuleDraftArgs, inspectAtomicRuleDraftFile,
} from '../../scripts/preview-memory-atomic-rule-draft.mjs';
import { previewAtomicRuleDraft } from '../../memory-engine/memory-atomic-rule-draft.mjs';

const SOURCE = 'You judged the overlay too quickly without test content. '
  + 'You did not research the actual browser behavior. Fix the overlay today.';
const DRAFT = 'For project quality checks, verify real assets and representative test data before reporting a feature as broken.';

async function withFixture(action) {
  const root = await mkdtemp(join(tmpdir(), 'atomic-rule-draft-test-'));
  const dbPath = join(root, 'source.sqlite3');
  const draftFile = join(root, 'draft.txt');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(
      'CREATE TABLE memory_candidates ('
      + 'id TEXT, project_id TEXT, branch TEXT, source_authority TEXT, '
      + 'proposed_type TEXT, proposed_value TEXT, status TEXT, evaluated_at TEXT, '
      + 'source_evidence_id TEXT, created_at TEXT);'
      + 'CREATE TABLE evidence ('
      + 'id TEXT, project_id TEXT, branch TEXT, authority_class TEXT, '
      + 'sensitivity TEXT, content_redacted TEXT);',
    );
    db.prepare('INSERT INTO evidence VALUES (?,?,?,?,?,?)')
      .run('source-1','example/repo','main','user_direct','normal',SOURCE);
    db.prepare('INSERT INTO memory_candidates VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('candidate-1','example/repo','main','user_direct','correction',
        SOURCE,'pending',null,'source-1','2026-11-01');
    await writeFile(draftFile, DRAFT, 'utf8');
    const report = inspectAtomicReviewDb({ dbPath, projectId:'example/repo', branch:'main' });
    assert.equal(report.candidatesWithVerifiedEvidence, 1);
    assert.equal(report.candidates[0].hints.length, 2);
    const candidateRef = report.candidates[0].candidateRef;
    const reviewRefs = report.candidates[0].hints.map(h=>h.reviewRef);
    return await action({ db, dbPath, draftFile, report, candidateRef, reviewRefs });
  } finally {
    db.close();
    await rm(root, { recursive:true, force:true });
  }
}

test('CLI only permits explicit scoped read-only inputs and complete refs', () => {
  const base = [
    '--db-path','source.sqlite3','--project-id','example/repo','--branch','main',
    '--candidate-ref','~1234567890',
    '--review-refs','~a1234567890abcdef,~a0000000000000000',
    '--draft-file','draft.txt',
  ];
  const parsed = parseAtomicRuleDraftArgs(base);
  assert.equal(parsed.candidateRef, '~1234567890');
  assert.equal(parsed.reviewRefs.length, 2);
  assert.throws(()=>parseAtomicRuleDraftArgs([...base, '--apply']), /unsupported/);
  assert.throws(()=>parseAtomicRuleDraftArgs([...base, '--intent','retain_for_confirmation']),/unsupported/);
  assert.throws(()=>parseAtomicRuleDraftArgs([...base, '--show-local-content']),/unsupported/);
  assert.throws(()=>parseAtomicRuleDraftArgs([...base, '--draft-file','other.txt']),/duplicate/);
  assert.throws(()=>parseAtomicRuleDraftArgs(base.slice(0,-2)), /required/);
  assert.throws(()=>parseAtomicRuleDraftArgs(base.slice(0,6).concat(base.slice(10))), /candidate and review references/);
});

test('one combined draft is only an evidence-bound preview, with no raw content output', async () => {
  await withFixture(async ({ db, report, candidateRef, reviewRefs }) => {
    const preview = previewAtomicRuleDraft({ report, candidateRef, reviewRefs, draftText:DRAFT });
    assert.equal(preview.status, 'awaiting_explicit_user_direct_confirmation');
    assert.equal(preview.proposedRuleCount, 1);
    assert.equal(preview.selectedHintCount, 2);
    assert.equal(preview.evidenceVerified, true);
    assert.equal(preview.semanticEquivalenceVerified, false);
    assert.equal(preview.durationConfirmed, false);
    assert.equal(preview.confirmationEvidencePresent, false);
    assert.equal(preview.claimCreated, false);
    assert.equal(preview.promotionAllowed, false);
    assert.equal(preview.originalCandidateConfirmable, false);
    assert.equal(preview.writesToSource, false);
    assert.equal(preview.scope.projectId, 'example/repo');
    assert.match(preview.draftRef, /^~d[0-9a-f]{16}$/);
    assert.equal(preview.draftRef,
      previewAtomicRuleDraft({ report, candidateRef, reviewRefs, draftText:DRAFT }).draftRef);
    assert.notEqual(preview.draftRef,
      previewAtomicRuleDraft({ report, candidateRef, reviewRefs, draftText:DRAFT+' Again.' }).draftRef);
    const output = JSON.stringify(preview);
    assert.equal(output.includes(DRAFT), false);
    assert.equal(output.includes(SOURCE), false);
    assert.equal(output.includes('source-1'), false);
    assert.equal(output.includes('candidate-1'), false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_candidates WHERE status=?')
      .get('pending').n,1);
  });
});

test('draft must not be a secret, one-off command list, or unsupported length', async () => {
  await withFixture(async ({ report,candidateRef,reviewRefs }) => {
    const propose = (draftText) => previewAtomicRuleDraft({
      report,candidateRef,reviewRefs,draftText,
    });
    for (const text of [
      'short',
      'A'.repeat(501),
      'First rule.\nSecond separate instruction for later.',
      'For all future tests, use password: supersecretpassword.',
      'Set api_key=abcdefghijklmnop for future deployments.',
    ]) assert.throws(()=>propose(text));
    assert.throws(()=>propose(undefined));
    assert.throws(()=>propose(DRAFT,undefined));
  });
});

test('rejects altered, duplicate and cross-candidate review refs', async () => {
  await withFixture(async ({ report,candidateRef,reviewRefs }) => {
    for (const refs of [
      [...reviewRefs, reviewRefs[0]],
      ['~a0000000000000000'],
    ]) assert.throws(()=>previewAtomicRuleDraft({
      report,candidateRef,reviewRefs:refs,draftText:DRAFT,
    }));
    assert.throws(()=>previewAtomicRuleDraft({
      report,candidateRef:'~0000000000',reviewRefs,draftText:DRAFT,
    }), /not grounded/);
  });
});

test('real local file preview revalidates source evidence each time, never mutates SQLite', async () => {
  await withFixture(async ({ db,dbPath,draftFile,candidateRef,reviewRefs }) => {
    const options = {
      dbPath,projectId:'example/repo',branch:'main',
      candidateRef,reviewRefs,draftFile,
    };
    const result = await inspectAtomicRuleDraftFile(options);
    assert.equal(result.status,'awaiting_explicit_user_direct_confirmation');
    assert.equal(result.selectedHintCount,2);
    assert.equal(result.proposedRuleCount,1);
    assert.equal(JSON.stringify(result).includes(DRAFT),false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_candidates WHERE status=?').get('pending').n,1);
    db.prepare('UPDATE evidence SET content_redacted = ? WHERE id = ?')
      .run('tampered original evidence','source-1');
    await assert.rejects(()=>inspectAtomicRuleDraftFile(options), /not grounded/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_candidates WHERE status=?').get('pending').n,1);
  });
});

test('oversized or invalid draft file is rejected before any model or DB read', async () => {
  let readDb = 0;
  const oversized = await inspectAtomicRuleDraftFile({
    draftFile:'synthetic.txt',
    statLocalFile: async ()=>({ isFile:()=>true,size:4096 }),
    inspectDb: ()=>{readDb++;return {};},
  }).then(()=>null, e=>e);
  assert.ok(oversized instanceof Error);
  assert.equal(readDb,0);
});
