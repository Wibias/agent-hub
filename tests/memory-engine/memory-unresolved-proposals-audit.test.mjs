import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { EVIDENCE_PROPOSAL_SCHEMA_SQL } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  parseUnresolvedProposalAuditArgs,
  inspectUnresolvedMemoryProposals,
} from '../../scripts/inspect-memory-unresolved-proposals.mjs';

const PROJECT='github.com/example/streamer-content';
const OTHER='github.com/example/other';
const BRANCH='main';
const SECRET='Sensitive internal product instruction, do not share this text.';

async function fixture(run,{ledger=true}={}){
  const root=await mkdtemp(join(tmpdir(),'unresolved-proposals-audit-'));
  const dbPath=join(root,'memory.sqlite3');
  const memory=new MemoryEngine({dbPath});
  let db;
  try{
    memory.registerProject({projectId:PROJECT,repoIdentity:PROJECT});
    memory.registerProject({projectId:OTHER,repoIdentity:OTHER});
    const capture=(id,projectId=PROJECT,branch=BRANCH,authority='user_direct')=>{
      memory.recordEvidence({
        id,projectId,branch,harness:'codex',sessionId:'session-'+id,
        sourceKind:'session',sourceRef:'session:'+id,
        capturedAt:'2026-11-05T00:00:00.000Z',
        content:'Some synthetic source for '+id,
        authorityClass:authority,metadata:{event_type:'user_prompt'},
      });
    };
    capture('user-source');
    capture('untrusted-source',PROJECT,BRANCH,'agent_inference');
    capture('cross-branch-source',PROJECT,'feature');
    capture('cross-project-source',OTHER,BRANCH);
    db=new DatabaseSync(dbPath,{enableForeignKeyConstraints:true});
    if(ledger){
      db.exec(EVIDENCE_PROPOSAL_SCHEMA_SQL);
      const insert=db.prepare(
        'INSERT INTO memory_evidence_proposals '
        +'(id,project_id,branch,kind,canonical_fact,status,'
        +'policy_version,evaluator_id,fingerprint,created_at) '
        +'VALUES (?,?,?,?,?,?,?,?,?,?)',
      );
      const link=db.prepare(
        'INSERT INTO memory_evidence_proposal_evidence '
        +'(proposal_id,evidence_id,linked_at) VALUES (?,?,?)',
      );
      for(let n=1;n<=7;n++){
        const id='proposal-'+n;
        insert.run(id,PROJECT,BRANCH,
          n===1?'preference':n===7?'knowledge':'procedure',
          SECRET+' proposal '+n,
          n===7?'failed':n===1?'pending':'needs_confirmation',
          'v1','fixture','fingerprint-'+n,'2026-11-05T00:00:00.000Z',
        );
        if(n===1)link.run(id,'user-source','2026-11-05T00:00:00.000Z');
        if(n===2)link.run(id,'untrusted-source','2026-11-05T00:00:00.000Z');
        if(n===3)link.run(id,'cross-branch-source','2026-11-05T00:00:00.000Z');
        if(n===4)link.run(id,'cross-project-source','2026-11-05T00:00:00.000Z');
      }
      insert.run('ignored',PROJECT,BRANCH,'procedure','Already ignored.','ignored',
        'v1','fixture','fingerprint-ignored','2026-11-05T00:00:00.000Z');
      insert.run('other-branch',PROJECT,'feature','procedure','Foreign branch secret.',
        'needs_confirmation','v1','fixture','fingerprint-other','2026-11-05T00:00:00.000Z');
      insert.run('other-project',OTHER,BRANCH,'procedure','Foreign project secret.',
        'needs_confirmation','v1','fixture','fingerprint-other-project','2026-11-05T00:00:00.000Z');
    }
    return await run({db,memory,dbPath});
  }finally{
    db?.close();
    memory.close();
    await rm(root,{recursive:true,force:true});
  }
}

test('exact scope inventory reports seven unresolved without source text or ID leakage',async()=>{
  await fixture(async({db,dbPath})=>{
    const before=db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_proposals').get().n;
    const report=inspectUnresolvedMemoryProposals({
      dbPath,projectId:PROJECT,branch:BRANCH,
    });
    assert.equal(report.readOnly,true);
    assert.equal(report.writesToSource,false);
    assert.equal(report.modelInvocations,0);
    assert.equal(report.contentIncluded,false);
    assert.equal(report.decisionsApplied,0);
    assert.equal(report.claimsCreated,0);
    assert.equal(report.status,'ok');
    assert.equal(report.unresolvedTotal,7);
    assert.equal(report.returned,7);
    assert.equal(report.truncated,false);
    assert.equal(report.statusCounts.pending,1);
    assert.equal(report.statusCounts.needs_confirmation,5);
    assert.equal(report.statusCounts.failed,1);
    assert.equal(report.statusCounts.ignored,1);
    assert.equal(report.items[0].kind,'preference');
    assert.equal(report.items[0].userDirectEvidence,1);
    assert.equal(report.items[0].structurallyReviewable,true);
    assert.equal(report.items[1].provenanceIssue,'requires_authority_review');
    assert.equal(report.items[2].provenanceIssue,'cross_scope_evidence');
    assert.equal(report.items[3].provenanceIssue,'cross_scope_evidence');
    assert.equal(report.items[4].provenanceIssue,'no_linked_evidence');
    assert.equal(report.items[6].status,'failed');
    for(const item of report.items){
      assert.match(item.proposalRef,/^~p[0-9a-f]{12}$/u);
      assert.equal(item.decision,'manual_review_required');
    }
    const output=JSON.stringify(report);
    for(const forbidden of [
      SECRET,'proposal-1','proposal-7','user-source','untrusted-source',
      'cross-branch-source','cross-project-source',
      'Foreign branch secret','Foreign project secret','memory.sqlite3',
    ]) assert.equal(output.includes(forbidden),false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_proposals').get().n,before);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memory_evidence_proposals WHERE status='needs_confirmation'").get().n,7);
  });
});

test('bounded inventory reports truncation and local-only opt-in fact text',async()=>{
  await fixture(async({dbPath})=>{
    const short=inspectUnresolvedMemoryProposals({
      dbPath,projectId:PROJECT,branch:BRANCH,limit:2,
    });
    assert.equal(short.returned,2);
    assert.equal(short.unresolvedTotal,7);
    assert.equal(short.truncated,true);
    assert.equal(JSON.stringify(short).includes(SECRET),false);
    const explicit=inspectUnresolvedMemoryProposals({
      dbPath,projectId:PROJECT,branch:BRANCH,limit:1,showLocalFacts:true,
    });
    assert.equal(explicit.contentIncluded,true);
    assert.equal(explicit.items[0].localCanonicalFact.includes(SECRET),true);
  });
});

test('missing proposal ledger is explicitly unavailable rather than zero',async()=>{
  await fixture(async({dbPath})=>{
    const report=inspectUnresolvedMemoryProposals({
      dbPath,projectId:PROJECT,branch:BRANCH,
    });
    assert.equal(report.status,'proposal_ledger_missing');
    assert.equal(report.unresolvedTotal,null);
    assert.equal(report.items.length,0);
    assert.equal(report.readOnly,true);
  },{ledger:false});
});

test('strict parser rejects writes, missing scope, duplicates and unsafe limit',()=>{
  const args=[
    '--db-path','fixture.sqlite3','--project-id',PROJECT,
    '--branch',BRANCH,'--limit','7',
  ];
  assert.equal(parseUnresolvedProposalAuditArgs(args).limit,7);
  assert.equal(parseUnresolvedProposalAuditArgs([...args,'--show-local-facts']).showLocalFacts,true);
  assert.throws(()=>parseUnresolvedProposalAuditArgs([...args,'--apply']),/unsupported/);
  assert.throws(()=>parseUnresolvedProposalAuditArgs([...args,'--branch','feature']),/duplicate/);
  assert.throws(()=>parseUnresolvedProposalAuditArgs([...args,'--limit','101']),/duplicate/);
  assert.throws(()=>parseUnresolvedProposalAuditArgs(args.slice(0,-2).concat(['--limit','101'])),/limit/);
  assert.throws(()=>parseUnresolvedProposalAuditArgs(args.slice(0,-4)),/required/);
});
