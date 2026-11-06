import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { inspectAtomicReviewDb } from '../../scripts/inspect-memory-atomic-review.mjs';
import { previewAtomicRuleDraft } from '../../memory-engine/memory-atomic-rule-draft.mjs';
import {
  installAtomicRuleStagingSchema,
  atomicRuleConfirmationText,
  stageConfirmedAtomicRule,
} from '../../memory-engine/memory-atomic-confirmed-staging.mjs';

const PROJECT = 'github.com/example/streaming-app';
const BRANCH = 'main';
const SOURCE = 'You judged the overlay too quickly without test content. '
  + 'You did not research the actual browser behavior. Fix the overlay today.';
const RULE = 'For all future streaming app reviews, verify required assets and representative test data before treating a defect as confirmed.';
const SOURCE_AT = '2026-11-01T00:00:00.000Z';
const CONFIRM_AT = '2026-11-06T01:00:00.000Z';
const STAGED_AT = '2026-11-06T01:01:00.000Z';
const hash = s => createHash('sha256').update(s,'utf8').digest('hex');

async function fixture(action, { installSchema = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'atomic-rule-staging-'));
  const dbPath = join(dir,'memory.sqlite3');
  const memory = new MemoryEngine({dbPath});
  let db = null;
  try {
    memory.registerProject({projectId:PROJECT,repoIdentity:PROJECT});
    const source = memory.recordEvidence({
      id:'source-evidence', projectId:PROJECT, branch:BRANCH, harness:'codex',
      sessionId:'session-source', sourceKind:'session', sourceRef:'session:source',
      capturedAt:SOURCE_AT, content:SOURCE, authorityClass:'user_direct',
      metadata:{event_type:'user_prompt'},
    });
    memory.recordCandidate({
      id:'source-candidate', evidenceId:source.id, type:'correction',
      proposedValue:source.content_redacted, decisionReason:'explicit-correction',
      policyVersion:'capture-v1', fingerprint:hash(SOURCE), createdAt:SOURCE_AT,
    });
    const report = inspectAtomicReviewDb({dbPath,projectId:PROJECT,branch:BRANCH});
    assert.equal(report.candidatesWithVerifiedEvidence,1);
    assert.equal(report.candidates[0].hints.length,2);
    const candidateRef = report.candidates[0].candidateRef;
    const reviewRefs = report.candidates[0].hints.map(h=>h.reviewRef);
    const draft = previewAtomicRuleDraft({
      report,candidateRef,reviewRefs,draftText:RULE,
    });
    const draftRef = draft.draftRef;
    const confirmationContent = atomicRuleConfirmationText({
      projectId:PROJECT,branch:BRANCH,draftRef,ruleText:RULE,
    });
    const confirmation = memory.recordEvidence({
      id:'confirmation-evidence',projectId:PROJECT,branch:BRANCH,harness:'codex',
      sessionId:'session-confirm',sourceKind:'session',sourceRef:'session:session-confirm',
      capturedAt:CONFIRM_AT,content:confirmationContent,authorityClass:'user_direct',
      metadata:{
        event_type:'user_prompt',hook_event_name:'UserPromptSubmit',explicit_memory:true,
        explicit_memory_mode:'atomic_rule_confirm',
        atomic_rule_draft_ref:draftRef,
      },
    });
    db = new DatabaseSync(dbPath,{enableForeignKeyConstraints:true,timeout:5000});
    if(installSchema)installAtomicRuleStagingSchema(db);
    const request = {
      db,projectId:PROJECT,branch:BRANCH,candidateId:'source-candidate',
      reviewRefs,draftRef,ruleText:RULE,confirmationEvidenceId:confirmation.id,
      stagedAt:STAGED_AT,
    };
    return await action({db,memory,request,confirmation,draftRef,reviewRefs});
  } finally {
    db?.close();
    memory.close();
    await rm(dir,{recursive:true,force:true});
  }
}

test('explicit schema installation is required and staging never auto-migrates', async () => {
  await fixture(async ({db,request})=>{
    assert.throws(()=>stageConfirmedAtomicRule(request),/not installed/);
    assert.equal(db.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='memory_atomic_rule_staging'"
    ).get().n,0);
  },{installSchema:false});
});

test('one verified direct-user confirmation stages one atomic source-bound rule, no Claim', async () => {
  await fixture(async ({db,memory,request,reviewRefs})=>{
    const before = db.prepare('SELECT COUNT(*) AS n FROM claims').get().n;
    const result = stageConfirmedAtomicRule(request);
    assert.equal(result.status,'staged_for_promotion_review');
    assert.equal(result.selectedReviewHintCount,2);
    assert.equal(result.durableClaimCreated,false);
    assert.equal(result.originalCandidateModified,false);
    assert.equal(result.promotionAllowed,false);
    assert.match(result.stageId,/^atomic-stage-[0-9a-f]{24}$/);
    const row = db.prepare('SELECT * FROM memory_atomic_rule_staging WHERE id=?').get(result.stageId);
    assert.equal(row.project_id,PROJECT);
    assert.equal(row.branch,BRANCH);
    assert.equal(row.duration,'permanent');
    assert.equal(row.status,'awaiting_promotion_review');
    assert.equal(row.rule_sha256,hash(RULE));
    assert.equal(row.source_evidence_id,'source-evidence');
    assert.equal(row.confirmation_evidence_id,'confirmation-evidence');
    assert.equal(row.draft_ref,request.draftRef);
    assert.equal(JSON.stringify(row).includes(RULE),false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claims').get().n,before);
    assert.equal(memory.getCandidate('source-candidate').status,'pending');
    assert.equal(memory.getCandidate('source-candidate').evaluated_at,null);
    const spans = db.prepare(
      'SELECT * FROM memory_atomic_rule_staging_spans WHERE staging_id=? ORDER BY review_ref'
    ).all(result.stageId);
    assert.equal(spans.length,2);
    assert.deepEqual(spans.map(s=>s.review_ref),[...reviewRefs].sort());
    assert.ok(spans.every(s=>s.end_offset>s.start_offset));
    assert.equal(JSON.stringify(spans).includes(SOURCE),false);
    const repeat = stageConfirmedAtomicRule(request);
    assert.equal(repeat.status,'already_staged');
    assert.equal(repeat.stageId,result.stageId);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_atomic_rule_staging').get().n,1);
  });
});

test('confirmation must match scope, exact draft, source authority, and explicit stored prompt', async () => {
  await fixture(async ({db,memory,request})=>{
    const assertFail = change=>assert.throws(()=>stageConfirmedAtomicRule({...request,...change}));
    assertFail({projectId:'another/project'});
    assertFail({branch:'feature'});
    assertFail({draftRef:'~d0000000000000000'});
    assertFail({ruleText:'For every test, ignore real data and accept a demo as verified.'});
    assertFail({reviewRefs:['~a0000000000000000']});
    assertFail({reviewRefs:[request.reviewRefs[0],request.reviewRefs[0]]});
    assertFail({reviewRefs:[...request.reviewRefs].reverse()});
    assertFail({confirmationEvidenceId:'source-evidence'});
    assertFail({confirmationEvidenceId:'not-found'});
    assert.throws(() => stageConfirmedAtomicRule({
      ...request, stagedAt:'2026-11-05T23:00:00.000Z',
    }), /cannot precede direct-user confirmation/);
    db.prepare('UPDATE evidence SET metadata_json=? WHERE id=?')
      .run(JSON.stringify({event_type:'user_prompt',explicit_memory_mode:'candidate_confirm'}),'confirmation-evidence');
    assertFail({});
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_atomic_rule_staging').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claims').get().n,0);
    assert.equal(memory.getCandidate('source-candidate').status,'pending');
  });
});

test('tampered, stale, secret-redacted source and earlier confirmation fail closed', async () => {
  await fixture(async ({db,request})=>{
    db.prepare('UPDATE evidence SET content_redacted=? WHERE id=?')
      .run('ALTERED SOURCE','source-evidence');
    assert.throws(()=>stageConfirmedAtomicRule(request),/integrity|Evidence/);
    db.prepare('UPDATE evidence SET content_redacted=? WHERE id=?').run(SOURCE,'source-evidence');
    db.prepare('UPDATE memory_candidates SET status=? WHERE id=?').run('ignored','source-candidate');
    assert.throws(()=>stageConfirmedAtomicRule(request),/integrity|Evidence/);
    db.prepare('UPDATE memory_candidates SET status=? WHERE id=?').run('pending','source-candidate');
    db.prepare('UPDATE evidence SET sensitivity=? WHERE id=?').run('secret_redacted','source-evidence');
    assert.throws(()=>stageConfirmedAtomicRule(request),/integrity|Evidence/);
    db.prepare('UPDATE evidence SET sensitivity=? WHERE id=?').run('normal','source-evidence');
    db.prepare('UPDATE evidence SET captured_at=? WHERE id=?').run('2026-10-01T00:00:00.000Z','confirmation-evidence');
    assert.throws(()=>stageConfirmedAtomicRule(request),/must follow/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_atomic_rule_staging').get().n,0);
  });
});

test('staging sidecar and span insert commit atomically or roll back', async () => {
  await fixture(async ({db,request})=>{
    db.exec(
      "CREATE TRIGGER reject_span BEFORE INSERT ON memory_atomic_rule_staging_spans "
      + "BEGIN SELECT RAISE(ABORT, 'fixture span failure'); END;"
    );
    assert.throws(()=>stageConfirmedAtomicRule(request),/fixture span failure/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_atomic_rule_staging').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_atomic_rule_staging_spans').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claims').get().n,0);
  });
});

test('confirmation evidence is consumed only once and staging is source-scope bounded', async () => {
  await fixture(async ({db,request})=>{
    stageConfirmedAtomicRule(request);
    const duplicate = {...request,stagedAt:'2026-11-06T01:05:00.000Z'};
    assert.equal(stageConfirmedAtomicRule(duplicate).status,'already_staged');
    db.prepare('UPDATE memory_atomic_rule_staging SET rule_sha256=?').run(hash('other'));
    assert.throws(()=>stageConfirmedAtomicRule(request),/mismatched provenance/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_atomic_rule_staging').get().n,1);
  });
});

test('exact confirmation string carries draft, project, branch and full endorsed rule', () => {
  const text = atomicRuleConfirmationText({
    projectId:PROJECT,branch:BRANCH,draftRef:'~d1234567890abcdef',ruleText:RULE,
  });
  assert.match(text,/MEMORY CONFIRM PERMANENT PROJECT RULE ~d1234567890abcdef FOR github.com\/example\/streaming-app@main/);
  assert.ok(text.endsWith(RULE));
  assert.throws(()=>atomicRuleConfirmationText({
    projectId:PROJECT,branch:'main\nfeature',
    draftRef:'~d1234567890abcdef',ruleText:RULE,
  }));
});
