import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { EVIDENCE_PROPOSAL_SCHEMA_SQL } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import { inspectAtomicReviewDb } from '../../scripts/inspect-memory-atomic-review.mjs';
import { previewAtomicRuleDraft } from '../../memory-engine/memory-atomic-rule-draft.mjs';
import {
  atomicRuleConfirmationText, installAtomicRuleStagingSchema,
  stageConfirmedAtomicRule,
} from '../../memory-engine/memory-atomic-confirmed-staging.mjs';
import {
  installAtomicClaimPromotionSchema,
} from '../../memory-engine/memory-atomic-claim-promotion-ledger.mjs';

const PROJECT='github.com/example/streamer-app';
const BRANCH='main';
const SOURCE='You judged the overlay too quickly without fixture content. '
  + 'You did not research the real browser behavior. Fix the UI today.';
const RULE='For all future overlay checks, verify representative test data and required assets before confirming a defect.';
const SHA=value=>createHash('sha256').update(value,'utf8').digest('hex');
const PROMOTED_AT='2026-11-06T12:03:00.000Z';

async function fixture(run,{promotionLedger=true}={}) {
  const root=await mkdtemp(join(tmpdir(),'atomic-claim-finalizer-'));
  const dbPath=join(root,'memory.sqlite3');
  const memory=new MemoryEngine({dbPath});
  let sidecar;
  try {
    memory.registerProject({projectId:PROJECT,repoIdentity:PROJECT});
    memory.recordEvidence({
      id:'source-evidence',projectId:PROJECT,branch:BRANCH,harness:'codex',
      sessionId:'original-session',sourceKind:'session',sourceRef:'session:original',
      capturedAt:'2026-11-01T00:00:00.000Z',authorityClass:'user_direct',
      content:SOURCE,metadata:{event_type:'user_prompt'},
    });
    memory.recordCandidate({
      id:'original-candidate',evidenceId:'source-evidence',
      type:'correction',proposedValue:SOURCE,decisionReason:'correction',
      policyVersion:'capture-v1',fingerprint:SHA(SOURCE),
      createdAt:'2026-11-01T00:00:00.000Z',
    });
    const inspection=inspectAtomicReviewDb({dbPath,projectId:PROJECT,branch:BRANCH});
    assert.equal(inspection.candidatesWithVerifiedEvidence,1);
    assert.equal(inspection.candidates[0].reviewHintCount,2);
    const reviewRefs=inspection.candidates[0].hints.map(x=>x.reviewRef);
    const draft=previewAtomicRuleDraft({
      report:inspection,
      candidateRef:inspection.candidates[0].candidateRef,
      reviewRefs,draftText:RULE,
    });
    memory.recordEvidence({
      id:'confirmation-evidence',projectId:PROJECT,branch:BRANCH,harness:'codex',
      sessionId:'new-session',sourceKind:'session',sourceRef:'session:new',
      capturedAt:'2026-11-06T12:00:00.000Z',authorityClass:'user_direct',
      content:atomicRuleConfirmationText({
        projectId:PROJECT,branch:BRANCH,draftRef:draft.draftRef,ruleText:RULE,
      }),
      metadata:{
        event_type:'user_prompt',hook_event_name:'UserPromptSubmit',
        explicit_memory:true,explicit_memory_mode:'atomic_rule_confirm',
        atomic_rule_draft_ref:draft.draftRef,
      },
    });
    sidecar=new DatabaseSync(dbPath,{enableForeignKeyConstraints:true,timeout:5000});
    sidecar.exec(EVIDENCE_PROPOSAL_SCHEMA_SQL);
    installAtomicRuleStagingSchema(sidecar);
    if(promotionLedger)installAtomicClaimPromotionSchema(sidecar);
    const staging=stageConfirmedAtomicRule({
      db:sidecar,projectId:PROJECT,branch:BRANCH,candidateId:'original-candidate',
      reviewRefs,draftRef:draft.draftRef,ruleText:RULE,
      confirmationEvidenceId:'confirmation-evidence',
      stagedAt:'2026-11-06T12:01:00.000Z',
    });
    assert.equal(staging.status,'staged_for_promotion_review');
    return await run({memory,sidecar,dbPath,root,stageId:staging.stageId});
  } finally {
    sidecar?.close();
    memory.close();
    await rm(root,{recursive:true,force:true});
  }
}
const approval=stageId=>({
  projectId:PROJECT,branch:BRANCH,stageId,operatorReviewed:true,
  promotedAt:PROMOTED_AT,
});

test('only explicit reviewed write in canonical transaction creates one correct Claim',async()=>{
  await fixture(async({memory,sidecar,stageId})=>{
    const before=memory.exportCanonical();
    assert.equal(before.claims.length,0);
    const result=await memory.finalizeStagedAtomicRuleClaim(approval(stageId));
    assert.equal(result.status,'promoted');
    assert.equal(result.claimCreated,true);
    assert.equal(result.sourceCandidateConsumed,true);
    assert.equal(result.sourceEvidenceLinks,2);
    assert.match(result.claimId,/^memory-atomic-[0-9a-f]{24}$/u);
    const claim=memory.getClaim(result.claimId);
    assert.ok(claim);
    assert.equal(claim.kind,'user_direct');
    assert.equal(claim.subject,'user memory');
    assert.equal(claim.predicate,'states');
    assert.equal(claim.value_text,RULE);
    assert.equal(claim.branch_scope,BRANCH);
    assert.equal(claim.project_id,PROJECT);
    assert.equal(claim.state,'active');
    assert.equal(claim.created_from_evidence_id,'confirmation-evidence');
    const links=memory.getClaimEvidence(result.claimId);
    assert.deepEqual(links.map(x=>[x.evidence.id,x.role]),[
      ['confirmation-evidence','primary'],['source-evidence','supporting'],
    ]);
    assert.equal(memory.getCandidate('original-candidate').status,'ignored');
    assert.equal(memory.getCandidate('original-candidate').decision_reason,
      'atomic_rule_consumed_by_confirmed_claim');
    assert.equal(sidecar.prepare('SELECT COUNT(*) AS n FROM memory_atomic_rule_claim_promotions').get().n,1);
    assert.equal(sidecar.prepare('SELECT COUNT(*) AS n FROM claims').get().n,1);
    assert.equal(sidecar.prepare('SELECT COUNT(*) AS n FROM claim_fts').get().n,1);
    const replay=await memory.finalizeStagedAtomicRuleClaim(approval(stageId));
    assert.equal(replay.status,'already_promoted');
    assert.equal(replay.claimCreated,false);
    assert.equal(replay.claimId,result.claimId);
    assert.equal(sidecar.prepare('SELECT COUNT(*) AS n FROM claims').get().n,1);
  });
});

test('canonical export/import retains primary user approval and original supporting Evidence',async()=>{
  await fixture(async({memory,stageId,root})=>{
    const result=await memory.finalizeStagedAtomicRuleClaim(approval(stageId));
    const exported=memory.exportCanonical();
    assert.equal(exported.claims.length,1);
    assert.equal(exported.claim_evidence.length,2);
    const restoredPath=join(root,'restored.sqlite3');
    const restored=new MemoryEngine({dbPath:restoredPath});
    try{
      restored.importCanonical(exported);
      const claim=restored.getClaim(result.claimId);
      assert.equal(claim?.value_text,RULE);
      assert.equal(claim?.state,'active');
      const evidence=restored.getClaimEvidence(result.claimId);
      assert.deepEqual(evidence.map(x=>x.role),['primary','supporting']);
      assert.ok(evidence.every(x=>x.evidence.authority_class==='user_direct'));
      assert.equal(evidence[0].evidence.content_redacted.includes(RULE),true);
      assert.equal(evidence[1].evidence.content_redacted,SOURCE);
      assert.equal(restored.exportCanonical().claims.length,1);
    }finally{restored.close();}
  });
});

test('missing schema and missing operator acknowledgement fail without writes',async()=>{
  await fixture(async({memory,sidecar,stageId})=>{
    await assert.rejects(
      ()=>memory.finalizeStagedAtomicRuleClaim({
        ...approval(stageId),operatorReviewed:false,
      }),/explicit reviewed/);
    await assert.rejects(
      ()=>memory.finalizeStagedAtomicRuleClaim({
        ...approval(stageId),promotedAt:'2026-11-06T11:59:00.000Z',
      }),/cannot precede/);
    assert.equal(memory.exportCanonical().claims.length,0);
    assert.equal(memory.getCandidate('original-candidate').status,'pending');
    assert.equal(sidecar.prepare('SELECT COUNT(*) AS n FROM memory_atomic_rule_claim_promotions').get().n,0);
  });
  await fixture(async({memory,stageId})=>{
    await assert.rejects(
      ()=>memory.finalizeStagedAtomicRuleClaim(approval(stageId)),/not installed/);
    assert.equal(memory.exportCanonical().claims.length,0);
  },{promotionLedger:false});
});

test('unresolved memory work and other active Claims remain hard promotion blockers',async()=>{
  await fixture(async({memory,sidecar,stageId})=>{
    sidecar.prepare(
      'INSERT INTO memory_evidence_proposals '
      + '(id,project_id,branch,kind,canonical_fact,status,'
      + 'policy_version,evaluator_id,fingerprint,created_at) '
      + 'VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(
      'proposal-1',PROJECT,BRANCH,'procedure','Another synthetic memory',
      'needs_confirmation','fixture','fixture',SHA('proposal'),
      '2026-11-06T00:00:00.000Z',
    );
    await assert.rejects(
      ()=>memory.finalizeStagedAtomicRuleClaim(approval(stageId)),/unresolved safety gates/);
    assert.equal(memory.exportCanonical().claims.length,0);
    assert.equal(memory.getCandidate('original-candidate').status,'pending');
    sidecar.prepare('DELETE FROM memory_evidence_proposals WHERE id=?').run('proposal-1');
    memory.assertClaim({
      evidenceId:'source-evidence',
      claim:{
        id:'another-active-claim',kind:'user_direct',subject:'user memory',
        predicate:'states',value:'A separate active claim.',
        state:'active',branchScope:BRANCH,createdAt:'2026-11-02T00:00:00.000Z',
      },
    });
    await assert.rejects(
      ()=>memory.finalizeStagedAtomicRuleClaim(approval(stageId)),/unresolved safety gates/);
    assert.equal(memory.exportCanonical().claims.length,1);
    assert.equal(memory.getCandidate('original-candidate').status,'pending');
  });
});

test('all atomic inserts roll back if final promotion ledger write fails',async()=>{
  await fixture(async({memory,sidecar,stageId})=>{
    sidecar.exec(
      'CREATE TRIGGER fail_promotion BEFORE INSERT '
      + 'ON memory_atomic_rule_claim_promotions '
      + "BEGIN SELECT RAISE(ABORT,'synthetic promotion failure'); END;"
    );
    await assert.rejects(
      ()=>memory.finalizeStagedAtomicRuleClaim(approval(stageId)),/synthetic promotion failure/);
    assert.equal(sidecar.prepare('SELECT COUNT(*) AS n FROM claims').get().n,0);
    assert.equal(sidecar.prepare('SELECT COUNT(*) AS n FROM claim_evidence').get().n,0);
    assert.equal(sidecar.prepare('SELECT COUNT(*) AS n FROM claim_fts').get().n,0);
    assert.equal(sidecar.prepare('SELECT COUNT(*) AS n FROM memory_atomic_rule_claim_promotions').get().n,0);
    assert.equal(memory.getCandidate('original-candidate').status,'pending');
  });
});

test('a tampered staging source or confirmation is never promoted',async()=>{
  await fixture(async({memory,sidecar,stageId})=>{
    sidecar.prepare('UPDATE evidence SET content_redacted=? WHERE id=?')
      .run('Different original content','source-evidence');
    await assert.rejects(
      ()=>memory.finalizeStagedAtomicRuleClaim(approval(stageId)),/unresolved safety gates/);
    assert.equal(sidecar.prepare('SELECT COUNT(*) AS n FROM claims').get().n,0);
    assert.equal(memory.getCandidate('original-candidate').status,'pending');
  });
});

test('atomic finalization remains branch-scoped and cannot create a global rule',async()=>{
  await fixture(async({memory,stageId})=>{
    await assert.rejects(
      ()=>memory.finalizeStagedAtomicRuleClaim({
        ...approval(stageId),branch:'feature',
      }),/unavailable in scope/);
    assert.equal(memory.exportCanonical().claims.length,0);
  });
});
