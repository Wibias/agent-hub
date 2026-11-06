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
  atomicRuleConfirmationText, installAtomicRuleStagingSchema,
  stageConfirmedAtomicRule,
} from '../../memory-engine/memory-atomic-confirmed-staging.mjs';
import {
  inspectAtomicPromotionPreflight,
} from '../../memory-engine/memory-atomic-promotion-preflight.mjs';

const PROJECT='github.com/example/demo-repo';
const BRANCH='main';
const SOURCE='You judged the UI too quickly without fixture data. '
  +'You did not research actual browser behavior. Fix the dashboard today.';
const RULE='In all future demo UI reviews, verify realistic fixtures and required assets before reporting defects.';
const SHA=value=>createHash('sha256').update(value,'utf8').digest('hex');

async function fixture(run, {stage=true}={}) {
  const dir=await mkdtemp(join(tmpdir(),'atomic-promotion-preflight-'));
  const dbPath=join(dir,'memory.sqlite3');
  const memory=new MemoryEngine({dbPath});
  let writable=null;
  try{
    memory.registerProject({projectId:PROJECT,repoIdentity:PROJECT});
    memory.recordEvidence({
      id:'source',projectId:PROJECT,branch:BRANCH,harness:'codex',
      sessionId:'source-session',sourceKind:'session',sourceRef:'session:source',
      capturedAt:'2026-11-01T00:00:00.000Z',
      authorityClass:'user_direct',content:SOURCE,metadata:{event_type:'user_prompt'},
    });
    memory.recordCandidate({
      id:'candidate',evidenceId:'source',type:'correction',proposedValue:SOURCE,
      decisionReason:'explicit correction',policyVersion:'capture-v1',
      fingerprint:SHA(SOURCE),createdAt:'2026-11-01T00:00:00.000Z',
    });
    const review=inspectAtomicReviewDb({dbPath,projectId:PROJECT,branch:BRANCH});
    assert.equal(review.candidates[0].hints.length,2);
    const reviewRefs=review.candidates[0].hints.map(x=>x.reviewRef);
    const draft=previewAtomicRuleDraft({
      report:review,candidateRef:review.candidates[0].candidateRef,
      reviewRefs,draftText:RULE,
    });
    memory.recordEvidence({
      id:'confirmation',projectId:PROJECT,branch:BRANCH,harness:'codex',
      sessionId:'confirmed-session',sourceKind:'session',sourceRef:'session:confirmed',
      capturedAt:'2026-11-06T12:00:00.000Z',
      content:atomicRuleConfirmationText({
        projectId:PROJECT,branch:BRANCH,draftRef:draft.draftRef,ruleText:RULE,
      }),
      authorityClass:'user_direct',
      metadata:{
        event_type:'user_prompt',hook_event_name:'UserPromptSubmit',
        explicit_memory:true,explicit_memory_mode:'atomic_rule_confirm',
        atomic_rule_draft_ref:draft.draftRef,
      },
    });
    writable=new DatabaseSync(dbPath,{enableForeignKeyConstraints:true,timeout:5000});
    let stageId=null;
    if(stage){
      installAtomicRuleStagingSchema(writable);
      const staged=stageConfirmedAtomicRule({
        db:writable,projectId:PROJECT,branch:BRANCH,candidateId:'candidate',
        reviewRefs,draftRef:draft.draftRef,ruleText:RULE,
        confirmationEvidenceId:'confirmation',stagedAt:'2026-11-06T12:01:00.000Z',
      });
      assert.equal(staged.status,'staged_for_promotion_review');
      stageId=staged.stageId;
    }
    return await run({memory,writable,dbPath,stageId,reviewRefs,draftRef:draft.draftRef});
  } finally {
    writable?.close();
    memory.close();
    await rm(dir,{recursive:true,force:true});
  }
}
function preflight({dbPath,stageId,projectId=PROJECT,branch=BRANCH}) {
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try {
    return inspectAtomicPromotionPreflight({db,projectId,branch,stageId});
  } finally { db.close(); }
}

test('preflight validates original/source/confirmation and returns non-authorizing eligibility',async()=>{
  await fixture(async({dbPath,stageId,memory})=>{
    const claimsBefore=memory.exportCanonical().claims.length;
    const outcome=preflight({dbPath,stageId});
    assert.equal(outcome.status,'eligible_for_manual_promotion_review');
    assert.equal(outcome.preflightPassed,true);
    assert.equal(outcome.manualRelationReviewRequired,false);
    assert.equal(outcome.confirmedScope,'permanent_branch_scoped');
    assert.equal(outcome.sourceSpanCount,2);
    assert.equal(outcome.activeClaimsInScope,0);
    assert.equal(outcome.otherPendingCandidates,0);
    assert.equal(outcome.unresolvedEvidenceProposals,0);
    assert.equal(outcome.claimCreated,false);
    assert.equal(outcome.promotionAllowed,false);
    assert.equal(outcome.writesToSource,false);
    assert.equal(outcome.requiresSeparateWriteCapableImplementation,true);
    assert.equal(outcome.modelInvocations,0);
    assert.equal(JSON.stringify(outcome).includes(RULE),false);
    assert.equal(JSON.stringify(outcome).includes(SOURCE),false);
    assert.equal(JSON.stringify(outcome).includes('"confirmation"'),false);
    assert.equal(memory.exportCanonical().claims.length,claimsBefore);
    assert.equal(memory.getCandidate('candidate').status,'pending');
  });
});

test('a present unrelated active claim requires independent relation review',async()=>{
  await fixture(async({dbPath,stageId,memory})=>{
    memory.assertClaim({
      evidenceId:'source',
      claim:{
        id:'existing',kind:'user_direct',subject:'user memory',predicate:'states',
        value:'One other existing, unrelated rule.',state:'active',
        branchScope:BRANCH,createdAt:'2026-11-03T00:00:00.000Z',
      },
    });
    const outcome=preflight({dbPath,stageId});
    assert.equal(outcome.status,'needs_relation_review');
    assert.equal(outcome.preflightPassed,true);
    assert.equal(outcome.manualRelationReviewRequired,true);
    assert.equal(outcome.activeClaimsInScope,1);
    assert.equal(outcome.promotionAllowed,false);
  });
});

test('an exact active duplicate blocks even if the original stage is valid',async()=>{
  await fixture(async({dbPath,stageId,memory})=>{
    memory.assertClaim({
      evidenceId:'source',
      claim:{
        id:'same',kind:'user_direct',subject:'user memory',predicate:'states',
        value:RULE,state:'active',branchScope:BRANCH,
        createdAt:'2026-11-03T00:00:00.000Z',
      },
    });
    const outcome=preflight({dbPath,stageId});
    assert.equal(outcome.status,'blocked');
    assert.equal(outcome.issue,'active_duplicate_claim');
    assert.equal(outcome.promotionAllowed,false);
  });
});

test('malformed or tampered staging, spans, and Evidence fail closed without content',async()=>{
  await fixture(async({dbPath,stageId,writable,memory})=>{
    const assertIssue=(code)=>{
      const x=preflight({dbPath,stageId});
      assert.equal(x.status,'blocked');
      assert.equal(x.issue,code);
      assert.equal(JSON.stringify(x).includes(SOURCE),false);
      assert.equal(JSON.stringify(x).includes(RULE),false);
    };
    writable.prepare('UPDATE memory_atomic_rule_staging SET rule_sha256=? WHERE id=?')
      .run(SHA('forged'),stageId);
    assertIssue('confirmation_text_invalid');
    writable.prepare('UPDATE memory_atomic_rule_staging SET rule_sha256=? WHERE id=?')
      .run(SHA(RULE),stageId);
    writable.prepare('UPDATE memory_atomic_rule_staging_spans SET start_offset=9999 WHERE staging_id=?')
      .run(stageId);
    assertIssue('original_spans_invalid');
    // Proof missing scope cannot see same staged source
    assert.equal(preflight({dbPath,stageId,branch:'feature'}).issue,'staging_entry_missing');
    assert.equal(memory.getCandidate('candidate').status,'pending');
  });
});

test('stale or forged stored confirmation metadata blocks the stage',async()=>{
  await fixture(async({dbPath,stageId,writable})=>{
    writable.prepare('UPDATE evidence SET metadata_json=? WHERE id=?')
      .run(JSON.stringify({
        event_type:'user_prompt',
        explicit_memory:true,
        explicit_memory_mode:'atomic_rule_confirm',
      }),'confirmation');
    const outcome=preflight({dbPath,stageId});
    assert.equal(outcome.status,'blocked');
    assert.equal(outcome.issue,'confirmation_evidence_invalid');
  });
});

test('schema or stage is missing: no automatic migrations',async()=>{
  await fixture(async({dbPath})=>{
    const outcome=preflight({dbPath,stageId:'atomic-stage-missing'});
    assert.equal(outcome.status,'blocked');
    assert.equal(outcome.issue,'staging_schema_missing');
  },{stage:false});
});

test('the preflight uses no write-capable methods or provider calls',async()=>{
  await fixture(async({dbPath,stageId})=>{
    const db=new DatabaseSync(dbPath,{readOnly:true});
    try{
      const result=inspectAtomicPromotionPreflight({db,projectId:PROJECT,branch:BRANCH,stageId});
      assert.equal(result.readOnly,true);
      assert.equal(result.claimCreated,false);
      assert.equal(result.promotionAllowed,false);
      assert.equal(result.writesToSource,false);
    }finally{db.close();}
  });
});

test('unresolved scoped candidates prevent automatic eligibility for a new Claim',async()=>{
  await fixture(async({dbPath,stageId,memory})=>{
    memory.recordEvidence({
      id:'other-source',projectId:PROJECT,branch:BRANCH,harness:'codex',
      sessionId:'other-session',sourceKind:'session',sourceRef:'session:other',
      capturedAt:'2026-11-06T08:00:00.000Z',authorityClass:'user_direct',
      content:'Another unrelated pending review question.',
      metadata:{event_type:'user_prompt'},
    });
    memory.recordCandidate({
      id:'other-candidate',evidenceId:'other-source',type:'constraint',
      proposedValue:'Another unrelated pending review question.',
      decisionReason:'test',policyVersion:'capture-v1',
      fingerprint:SHA('other-source'),createdAt:'2026-11-06T08:00:00.000Z',
    });
    const outcome=preflight({dbPath,stageId});
    assert.equal(outcome.status,'needs_unresolved_memory_review');
    assert.equal(outcome.otherPendingCandidates,1);
    assert.equal(outcome.manualRelationReviewRequired,true);
    assert.equal(outcome.promotionAllowed,false);
  });
});

test('unresolved scoped evidence proposals are never ignored just because Claims are empty',async()=>{
  await fixture(async({dbPath,stageId,writable})=>{
    const exists=writable.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_evidence_proposals'"
    ).get();
    assert.ok(exists);
    writable.prepare(
      'INSERT INTO memory_evidence_proposals '
      + '(id,project_id,branch,kind,canonical_fact,status,'
      + 'policy_version,evaluator_id,fingerprint,created_at) '
      + 'VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(
      'p1',PROJECT,BRANCH,'procedure',
      'A separate synthetic proposal to review.',
      'needs_confirmation','fixture-v1','test-evaluator',SHA('proposal-fixture'),
      '2026-11-06T08:00:00.000Z',
    );
    const result=preflight({dbPath,stageId});
    assert.equal(result.status,'needs_unresolved_memory_review');
    assert.equal(result.unresolvedEvidenceProposals,1);
    assert.equal(result.activeClaimsInScope,0);
    assert.equal(result.promotionAllowed,false);
    assert.equal(JSON.stringify(result).includes('synthetic proposal'),false);
  });
});
