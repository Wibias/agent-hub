import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { EvidenceBoundProposalStore } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import { evidenceExtractionFingerprint } from '../../memory-engine/evidence-bound-extraction.mjs';
import {
  advanceShadowReview, parseAutoReviewArgs, runAutoReviewCommand,
} from '../../scripts/advance-memory-shadow-review.mjs';

const projectId = 'github.com/example/streamer';
const branch = 'fix5-plan44';
const fact = 'For all future acceptance prompts, measure elapsed time from zeit.txt.';
const id = 'evidence-proposal:scope-fixture';
const opaque = '~p' + createHash('sha256').update(id).digest('hex').slice(0,12);
const importance = {
  decision:'promote',durability:'long',future_utility:'high',
  confidence:'high',meaning_preserved:true,reason:'Future run reporting rule',risk_flags:[],
};
const supported = {
  decision:'supported',confidence:'high',meaning_preserved:true,
  reason:'Exactly stated by the original user',risk_flags:[],
};
const unsupported = {
  decision:'unsupported',confidence:'high',meaning_preserved:false,
  reason:'Evidence does not fully support generalization',risk_flags:['scope_mismatch'],
};
const unrelated = {
  relation:'unrelated',target_ref:null,confidence:'high',meaning_preserved:true,
  reason:'No claims describe this acceptance workflow',
};
function fixture(t,{activeClaim=false}={}) {
  const root = mkdtempSync(join(tmpdir(),'agenthub-auto-review-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const dir = join(root,'AgentHub-Evidence-Shadow-'+'a'.repeat(32));
  mkdirSync(dir);
  const dbPath = join(dir,'memory-shadow.sqlite3');
  const memory = new MemoryEngine({dbPath});
  try {
    memory.registerProject({projectId,repoIdentity:projectId});
    memory.recordEvidence({
      id:'user-source',projectId,branch,
      sourceKind:'session',sourceRef:'session:current',harness:'codex',
      capturedAt:'2026-11-16T10:00:00Z',authorityClass:'user_direct',
      content:fact,
    });
    if(activeClaim) {
      memory.recordEvidence({
        id:'other-source',projectId,branch,
        sourceKind:'session',sourceRef:'session:older',harness:'codex',
        capturedAt:'2026-11-15T10:00:00Z',authorityClass:'user_direct',
        content:'Unrelated host instruction.',
      });
      memory.assertClaim({
        evidenceId:'other-source',
        claim:{
          id:'other-claim',kind:'knowledge',subject:'host',predicate:'uses',
          value:'Independent runtime',state:'active',branchScope:branch,
          createdAt:'2026-11-15T11:00:00Z',
        },
      });
    }
  } finally {memory.close();}
  const store=new EvidenceBoundProposalStore({
    dbPath,inspectTextSensitivity:()=>({containsSecret:false}),
  });
  try{
    store.record({
      id,projectId,branch,kind:'procedure',canonicalFact:fact,
      evidenceIds:['user-source'],
      fingerprint:evidenceExtractionFingerprint({kind:'procedure',canonicalFact:fact}),
      policyVersion:'evidence-verbatim-selection-v1',
      evaluatorId:'deterministic:fixture',
      createdAt:'2026-11-16T10:01:00Z',
    });
  } finally {store.close();}
  return {root,dbPath,args:{dbPath,projectId,branch,proposalRef:opaque,localAppData:root}};
}
function state(dbPath){
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try{
    const row=db.prepare('SELECT status,importance_json,support_json FROM memory_evidence_proposals WHERE id=?').get(id);
    return {
      status:row.status,
      importance:row.importance_json?JSON.parse(row.importance_json).decision:null,
      support:row.support_json?JSON.parse(row.support_json).decision:null,
      relation:db.prepare('SELECT relation FROM memory_evidence_proposal_relations WHERE proposal_id=?').get(id)?.relation??null,
      claims:db.prepare('SELECT COUNT(*) n FROM claims').get().n,
      promotions:db.prepare('SELECT COUNT(*) n FROM memory_evidence_proposal_promotions').get().n,
    };
  } finally {db.close();}
}
function judges({supportResult=supported,relationResult=unrelated}={}) {
  const attempted=[],closed=[];
  return {
    attempted,closed,
    async createJudge({workspaceLabel}) {
      const stage=workspaceLabel.split('-').at(-1);
      assert.ok(['importance','support','relation'].includes(stage));
      return {
        evaluatorId:'synthetic-test:'+stage,
        async judge(prompt){
          attempted.push(stage);
          assert.match(prompt,/scope-fixture|Future run reporting rule|zeit.txt/u);
          return JSON.stringify(stage==='importance'?importance:stage==='support'?supportResult:relationResult);
        },
        async close(){closed.push(stage);},
      };
    },
  };
}

test('explicit opt-in arguments and model-free dry-run leave all ledgers unchanged',async t=>{
  const f=fixture(t); const before=state(f.dbPath);
  const opts=['--shadow-db',f.dbPath,'--project-id',projectId,
    '--branch',branch,'--proposal-ref',opaque];
  assert.equal(parseAutoReviewArgs(opts).runJudges,false);
  assert.equal(parseAutoReviewArgs([...opts,'--run-judges']).runJudges,true);
  assert.throws(()=>parseAutoReviewArgs([...opts,'--run-judges','--run-judges']));
  assert.throws(()=>parseAutoReviewArgs([...opts,'--apply']));
  assert.throws(()=>parseAutoReviewArgs([...opts,'--proposal-ref','~p000000000000']));
  const q=judges(); const report=await advanceShadowReview({...f.args,createJudge:q.createJudge});
  assert.equal(report.status,'shadow_auto_review_inspected');
  assert.equal(report.modelCalls,0);
  assert.equal(report.claimsCreated,0);
  assert.equal(report.protectedApproval,false);
  assert.deepEqual(q.attempted,[]);
  assert.deepEqual(state(f.dbPath),before);
  assert.doesNotMatch(JSON.stringify(report),/zeit.txt|Future run reporting rule/u);
});

test('one opt-in command processes Importance Support and deterministic Relation, without Claims',async t=>{
  const f=fixture(t),j=judges();
  const r=await advanceShadowReview({...f.args,runJudges:true,createJudge:j.createJudge});
  assert.equal(r.status,'shadow_auto_review_complete_unapproved');
  assert.equal(r.modelCalls,2);
  assert.equal(r.importanceDecision,'promote');
  assert.equal(r.supportDecision,'supported');
  assert.equal(r.relation,'unrelated');
  assert.deepEqual(j.attempted,['importance','support']);
  assert.deepEqual(j.closed,['importance','support']);
  assert.deepEqual(state(f.dbPath),{
    status:'pending',importance:'promote',support:'supported',
    relation:'unrelated',claims:0,promotions:0,
  });
  const repeat=await advanceShadowReview({...f.args,runJudges:true,createJudge:()=>{
    throw new Error('no repeat model allowed');
  }});
  assert.equal(repeat.status,'shadow_auto_review_complete_unapproved');
  assert.equal(repeat.modelCalls,0);
});

test('importance/support failures prevent later stages, no automatic retry',async t=>{
  const f=fixture(t),j=judges({supportResult:unsupported});
  const r=await advanceShadowReview({...f.args,runJudges:true,createJudge:j.createJudge});
  assert.equal(r.status,'shadow_auto_review_stopped_at_support');
  assert.equal(r.supportDecision,'unsupported');
  assert.deepEqual(j.attempted,['importance','support']);
  assert.deepEqual(state(f.dbPath),{
    status:'ignored',importance:'promote',support:'unsupported',
    relation:null,claims:0,promotions:0,
  });
});

test('one eligible active claim requires exactly one third relation model call',async t=>{
  const f=fixture(t,{activeClaim:true}),j=judges();
  const r=await advanceShadowReview({...f.args,runJudges:true,createJudge:j.createJudge});
  assert.equal(r.status,'shadow_auto_review_complete_unapproved');
  assert.equal(r.modelCalls,3);
  assert.deepEqual(j.attempted,['importance','support','relation']);
  assert.deepEqual(j.closed,['importance','support','relation']);
  assert.equal(state(f.dbPath).claims,1);
  assert.equal(state(f.dbPath).promotions,0);
  assert.equal(state(f.dbPath).relation,'unrelated');
});

test('bad scoped ref is refused before model creation and any write',async t=>{
  const f=fixture(t),j=judges();
  await assert.rejects(advanceShadowReview({
    ...f.args,proposalRef:'~p000000000000',runJudges:true,createJudge:j.createJudge,
  }),/opaque ref not uniquely in scope/u);
  assert.deepEqual(j.attempted,[]);
  assert.equal(state(f.dbPath).importance,null);
});

test('failed model call returns only safe status and can resume without repeating good stages',async t=>{
  const f=fixture(t);
  let attempts=0,output='';
  const rc=await runAutoReviewCommand({
    argv:['--shadow-db',f.dbPath,'--project-id',projectId,
      '--branch',branch,'--proposal-ref',opaque,'--run-judges'],
    run:args=>advanceShadowReview({
      ...args,localAppData:f.root,
      createJudge:async({workspaceLabel})=>({
        evaluatorId:'synthetic-test:'+workspaceLabel,
        async judge(){
          attempts++;
          if(attempts===1)return JSON.stringify(importance);
          throw Error('codex isolated memory judge failed with exit 1: secret original text '+fact);
        },
        async close(){},
      }),
    }),
    write:s=>{output+=s;},
  });
  assert.equal(rc,2);
  const error=JSON.parse(output);
  assert.equal(error.status,'shadow_auto_review_failed');
  assert.equal(error.modelCallsAttempted,2);
  assert.doesNotMatch(output,/zeit.txt|secret original text/u);
  assert.deepEqual(state(f.dbPath),{
    status:'pending',importance:'promote',support:null,relation:null,claims:0,promotions:0,
  });
  const good=judges();
  const r=await advanceShadowReview({...f.args,runJudges:true,createJudge:good.createJudge});
  assert.equal(r.modelCalls,1);
  assert.deepEqual(good.attempted,['support']);
  assert.equal(r.status,'shadow_auto_review_complete_unapproved');
});
