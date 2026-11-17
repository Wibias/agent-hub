import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { evidenceExtractionFingerprint } from '../../memory-engine/evidence-bound-extraction.mjs';
import { EVIDENCE_PROPOSAL_SCHEMA_SQL } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  exportReviewedShadowToOperator, parseReviewedShadowTransferArgs,
} from '../../scripts/export-reviewed-memory-shadow-to-operator.mjs';
import {
  EVIDENCE_SNAPSHOT_NAME, EVIDENCE_MANIFEST_NAME,
} from '../../scripts/export-protected-evidence-review.mjs';

const projectId='github.com/example/operator-evidence';
const proposalId='reviewed-shadow-example';
const fact='For acceptance reports, measure actual duration from zeit.txt.';
const shadowRef='~p'+createHash('sha256').update(proposalId).digest('hex').slice(0,12);
const evidenceRef='E~'+createHash('sha256').update(proposalId).digest('hex').slice(0,10);
const reviewedImportance={
  decision:'promote',durability:'long',future_utility:'high',
  confidence:'high',meaning_preserved:true,reason:'Reusable procedure',risk_flags:[],
};
const reviewedSupport={
  decision:'supported',confidence:'high',meaning_preserved:true,
  reason:'Exact original user instruction',risk_flags:[],
};
const reviewedRelation={
  relation:'unrelated',target_ref:null,confidence:'high',
  meaning_preserved:true,reason:'No active in-scope claims',
};

function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'operator-shadow-transfer-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const repo=join(root,'repo');
  const shadowDir=join(root,'AgentHub-Evidence-Shadow-'+'a'.repeat(32));
  mkdirSync(repo);mkdirSync(shadowDir);
  const dbPath=join(shadowDir,'memory-shadow.sqlite3');
  const outputDir=join(root,'exported');
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{
    encoding:'utf8',timeout:5000,windowsHide:true,stdio:['ignore','pipe','pipe'],
  }).trim();
  git('init','-b','main');
  git('config','user.name','Operator Fixture');
  git('config','user.email','fixture@example.invalid');
  git('config','commit.gpgsign','false');
  git('remote','add','origin','https://github.com/example/operator-evidence.git');
  writeFileSync(join(repo,'README.md'),'test\n');
  git('add','README.md');git('commit','-m','fixture');
  const revision=git('rev-parse','HEAD');
  const db=new DatabaseSync(dbPath);
  try {
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE project_registry (project_id TEXT PRIMARY KEY,repo_identity TEXT);
      CREATE TABLE evidence (
        id TEXT PRIMARY KEY,project_id TEXT,branch TEXT,
        authority_class TEXT,sensitivity TEXT,
        source_kind TEXT,commit_sha TEXT,
        content_redacted TEXT,metadata_json TEXT
      );
      CREATE TABLE claims(
        id TEXT PRIMARY KEY,project_id TEXT,branch_scope TEXT,
        state TEXT,value_text TEXT
      );
    `);
    db.exec(EVIDENCE_PROPOSAL_SCHEMA_SQL);
    db.prepare('INSERT INTO project_registry VALUES(?,?)').run(projectId,projectId);
    db.prepare(`INSERT INTO evidence
      (id,project_id,branch,authority_class,sensitivity,content_redacted,metadata_json)
      VALUES(?,?,?,?,?,?,?)`
    ).run('source-1',projectId,'main','user_direct','normal',
      'For acceptance reports, measure actual duration from zeit.txt.',
      '{"event_type":"user_prompt"}');
    db.prepare(`INSERT INTO memory_evidence_proposals
      (id,project_id,branch,kind,canonical_fact,status,policy_version,evaluator_id,
       fingerprint,created_at,importance_json,support_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(proposalId,projectId,'main','procedure',fact,'pending',
      'evidence-verbatim-selection-v1','deterministic:source-quote',
      evidenceExtractionFingerprint({kind:'procedure',canonicalFact:fact}),
      '2026-11-16T10:00:00.000Z',
      JSON.stringify(reviewedImportance),JSON.stringify(reviewedSupport));
    db.prepare(`INSERT INTO memory_evidence_proposal_evidence
      (proposal_id,evidence_id,linked_at) VALUES(?,?,?)`
    ).run(proposalId,'source-1','2026-11-16T10:00:00.000Z');
    db.prepare(`INSERT INTO memory_evidence_proposal_relations
      (proposal_id,relation,related_claim_id,evaluator_id,policy_version,evaluated_at,result_json)
      VALUES(?,'unrelated',NULL,?,?,?,?)`
    ).run(proposalId,'deterministic:zero-comparable-claims','evidence-relation-v1',
      '2026-11-16T10:05:00.000Z',JSON.stringify(reviewedRelation));
  }finally{db.close();}
  const options={
    dbPath,repoPath:repo,proposalRef:shadowRef,
    decision:'confirm',outputDir,localAppData:root,
  };
  return{root,repo,git,revision,dbPath,outputDir,options};
}
test('explicit ~p shadow alias exports original E~ immutable private snapshot, no canonical/Claim writes',async t=>{
  const f=fixture(t);
  const result=await exportReviewedShadowToOperator(f.options);
  assert.equal(result.status,'shadow_operator_transfer_prepared_unverified_unapproved');
  assert.equal(result.sourceRef,shadowRef);
  assert.equal(result.operatorRef,evidenceRef);
  assert.equal(result.gitRevision,f.revision);
  assert.equal(result.sourceIsUserWritableShadow,true);
  assert.equal(result.completePrivateDatabaseExported,true);
  assert.equal(result.modelCalls,0);
  assert.equal(result.humanApprovalVerified,false);
  assert.equal(result.claimWritten,false);
  assert.equal(result.originalShadowModifiedByTool,false);
  assert.equal(result.protectedServiceImportCompleted,false);
  assert.doesNotMatch(JSON.stringify(result),/measure actual duration from zeit.txt/u);
  const original=new DatabaseSync(f.dbPath,{readOnly:true});
  const copy=new DatabaseSync(join(f.outputDir,EVIDENCE_SNAPSHOT_NAME),{readOnly:true});
  try{
    for(const db of [original,copy]){
      const row=db.prepare('SELECT status,kind,canonical_fact FROM memory_evidence_proposals WHERE id=?').get(proposalId);
      assert.equal(row.status,'pending');
      assert.equal(row.kind,'procedure');
      assert.equal(row.canonical_fact,fact);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM claims').get().n,0);
    }
    const manifest=JSON.parse((await import('node:fs')).readFileSync(
      join(f.outputDir,EVIDENCE_MANIFEST_NAME),'utf8'));
    assert.equal(Object.keys(manifest).length,5);
    assert.equal(manifest.proposalRef,evidenceRef);
    assert.equal(manifest.branch,'main');
    assert.equal(manifest.revisionSha,f.revision);
  }finally{original.close();copy.close();}
});

test('preflight blocks scoped-claim conflict, foreign branch, unsupported and stale input',async t=>{
  const f=fixture(t);
  const db=new DatabaseSync(f.dbPath);
  try {
    db.prepare('UPDATE memory_evidence_proposals SET support_json=NULL WHERE id=?').run(proposalId);
  }finally{db.close();}
  await assert.rejects(exportReviewedShadowToOperator(f.options),/unavailable/u);
  assert.equal(existsSync(f.outputDir),false);
  const db2=new DatabaseSync(f.dbPath);
  try{
    db2.prepare('UPDATE memory_evidence_proposals SET support_json=? WHERE id=?').run(
      JSON.stringify(reviewedSupport),proposalId);
    db2.prepare(`INSERT INTO claims(id,project_id,branch_scope,state,value_text)
      VALUES(?,?,?,?,?)`).run('active',projectId,'main','active','Potential conflict');
  }finally{db2.close();}
  await assert.rejects(exportReviewedShadowToOperator(f.options),/unavailable/u);
  assert.equal(existsSync(f.outputDir),false);
  const db3=new DatabaseSync(f.dbPath);
  try{db3.prepare('DELETE FROM claims').run();}finally{db3.close();}
  f.git('checkout','-b','wrong-branch');
  await assert.rejects(exportReviewedShadowToOperator(f.options),/not unique in current Git scope/u);
  assert.equal(existsSync(f.outputDir),false);
});

test('malformed alias, arbitrary source, write-like args and duplicate flags denied',()=>{
  const sample=[
    '--shadow-db',join(tmpdir(),'AgentHub-Evidence-Shadow-'+'a'.repeat(32),'memory-shadow.sqlite3'),
    '--repo-path',join(tmpdir(),'repo'),'--proposal-ref',shadowRef,
    '--decision','confirm','--output-dir',join(tmpdir(),'fresh-export'),
  ];
  assert.equal(parseReviewedShadowTransferArgs(sample).proposalRef,shadowRef);
  assert.throws(()=>parseReviewedShadowTransferArgs([...sample,'--approve','yes']),/invalid/u);
  assert.throws(()=>parseReviewedShadowTransferArgs([...sample,'--decision','reject']),/invalid/u);
  assert.throws(()=>parseReviewedShadowTransferArgs(
    sample.map(x=>x===shadowRef?'E~1234567890':x)),/invalid/u);
  assert.throws(()=>parseReviewedShadowTransferArgs(
    sample.map(x=>x==='confirm'?'approve':x)),/invalid/u);
});


function moveFixtureToHistoricalSource(f) {
  // The source revision is the real first commit. The active checkout
  // advances on 'main', and NO fix5-plan44 branch or worktree exists.
  const historical = f.revision;
  writeFileSync(join(f.repo,'README.md'),'current main after original session\n');
  f.git('add','README.md');
  f.git('commit','-m','later main');
  const current = f.git('rev-parse','HEAD');
  assert.notEqual(current,historical);
  assert.equal(f.git('branch','--show-current'),'main');
  assert.equal(f.git('branch','--list','fix5-plan44'),'');
  const db = new DatabaseSync(f.dbPath);
  try {
    db.prepare('UPDATE memory_evidence_proposals SET branch=? WHERE id=?')
      .run('fix5-plan44',proposalId);
    db.prepare(`UPDATE evidence
      SET branch=?,commit_sha=?,source_kind='session' WHERE id=?`)
      .run('fix5-plan44',historical,'source-1');
  } finally { db.close(); }
  return {
    ...f.options, sourceBranch:'fix5-plan44',sourceCommitSha:historical,
  };
}

test('historical single-session Source commits export with source scope despite missing branch/worktree',async t=>{
  const f=fixture(t);
  const options=moveFixtureToHistoricalSource(f);
  const current=f.git('rev-parse','HEAD');
  const result=await exportReviewedShadowToOperator(options);
  assert.equal(result.status,'shadow_operator_transfer_prepared_unverified_unapproved');
  assert.equal(result.scope.branch,'fix5-plan44');
  assert.equal(result.gitRevision,f.revision);
  assert.equal(result.checkoutBranch,'main');
  assert.equal(result.checkoutRevisionSha,current);
  assert.equal(result.historicalSource,true);
  assert.equal(result.historicalProvenance.status,'historical_user_direct_metadata_consistent_unverified');
  assert.equal(result.historicalProvenance.identityAuthenticated,false);
  assert.equal(result.originalShadowModifiedByTool,false);
  assert.equal(result.canonicalSourceDatabaseModifiedByTool,false);
  assert.equal(result.claimWritten,false);
  assert.equal(result.humanApprovalVerified,false);
  assert.equal(result.protectedServiceImportCompleted,false);
  assert.equal(f.git('branch','--show-current'),'main');
  const manifest=JSON.parse((await import('node:fs')).readFileSync(
    join(f.outputDir,EVIDENCE_MANIFEST_NAME),'utf8'));
  assert.deepEqual(Object.keys(manifest).sort(),[
    'branch','decision','projectId','proposalRef','revisionSha',
  ].sort());
  assert.equal(manifest.branch,'fix5-plan44');
  assert.equal(manifest.revisionSha,f.revision);
  assert.equal(manifest.proposalRef,evidenceRef);
  const src=new DatabaseSync(f.dbPath,{readOnly:true});
  const copy=new DatabaseSync(join(f.outputDir,EVIDENCE_SNAPSHOT_NAME),{readOnly:true});
  try {
    for(const db of [src,copy]) {
      assert.equal(db.prepare('SELECT status FROM memory_evidence_proposals WHERE id=?')
        .get(proposalId).status,'pending');
      assert.equal(db.prepare('SELECT branch FROM memory_evidence_proposals WHERE id=?')
        .get(proposalId).branch,'fix5-plan44');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM claims').get().n,0);
    }
  } finally {src.close();copy.close();}
});

test('historical Source rejects forged branch, missing object, source-kind and mismatching evidence commit',async t=>{
  const f=fixture(t);
  const options=moveFixtureToHistoricalSource(f);
  assert.throws(()=>parseReviewedShadowTransferArgs([
    '--shadow-db',options.dbPath,'--repo-path',options.repoPath,
    '--proposal-ref',shadowRef,'--decision','confirm',
    '--output-dir',options.outputDir,'--source-branch','fix5-plan44',
  ]),/historical/u);
  assert.throws(()=>parseReviewedShadowTransferArgs([
    '--shadow-db',options.dbPath,'--repo-path',options.repoPath,
    '--proposal-ref',shadowRef,'--decision','confirm',
    '--output-dir',options.outputDir,'--source-branch','../unsafe',
    '--source-commit',f.revision,
  ]),/historical/u);
  await assert.rejects(exportReviewedShadowToOperator({
    ...options,sourceCommitSha:'f'.repeat(40),
  }));
  assert.equal(existsSync(f.outputDir),false);
  const db=new DatabaseSync(f.dbPath);
  try {
    db.prepare('UPDATE evidence SET commit_sha=?').run('d'.repeat(40));
  } finally{db.close();}
  await assert.rejects(exportReviewedShadowToOperator(options));
  assert.equal(existsSync(f.outputDir),false);
  const db2=new DatabaseSync(f.dbPath);
  try {
    db2.prepare('UPDATE evidence SET commit_sha=?,source_kind=?')
      .run(f.revision,'agent_inference');
  }finally{db2.close();}
  await assert.rejects(exportReviewedShadowToOperator(options));
  assert.equal(existsSync(f.outputDir),false);
});
