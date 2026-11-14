import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  evidenceBoundReviewIntentCommand,
  installEvidenceBoundReviewIntentSchema,
  stageEvidenceBoundReviewIntent,
} from '../../memory-engine/evidence-bound-review-intent-staging.mjs';
import {
  evidenceBoundDecisionRef,
  inspectEvidenceBoundDecision,
} from '../../memory-engine/evidence-bound-decision-preflight.mjs';
import { EVIDENCE_PROPOSAL_SCHEMA_SQL } from '../../memory-engine/evidence-bound-proposal-store.mjs';

const PROJECT='github.com/example/repo', BRANCH='main';
const REVISION='a'.repeat(40), FACT='Always check reproducible tests before calling a defect confirmed.';
const PROPOSAL='review-proposal-1';
const REF=evidenceBoundDecisionRef(PROPOSAL);
const BEFORE='2026-11-10T00:00:00.000Z';
const AFTER='2026-11-14T08:00:00.000Z';
const RECORDED='2026-11-14T08:01:00.000Z';

function fixture({ install=true }={}) {
  const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:true});
  db.exec(
    'PRAGMA foreign_keys=ON;'
    + 'CREATE TABLE project_registry (project_id TEXT PRIMARY KEY, repo_identity TEXT);'
    + 'CREATE TABLE evidence (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, branch TEXT, '
    + 'authority_class TEXT, sensitivity TEXT, content_redacted TEXT, metadata_json TEXT, '
    + 'harness TEXT, source_kind TEXT, source_ref TEXT, session_id TEXT, path TEXT, captured_at TEXT);'
    + 'CREATE TABLE claims (id TEXT PRIMARY KEY, project_id TEXT, branch_scope TEXT, '
    + 'state TEXT, value_text TEXT);'
  );
  db.exec(EVIDENCE_PROPOSAL_SCHEMA_SQL);
  db.prepare('INSERT INTO project_registry(project_id,repo_identity) VALUES (?,?)').run(PROJECT,PROJECT);
  db.prepare('INSERT INTO evidence(id,project_id,branch,authority_class,sensitivity,content_redacted,metadata_json,'
    +'harness,source_kind,source_ref,session_id,path,captured_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('source-1',PROJECT,BRANCH,'user_direct','normal',FACT,
      '{"event_type":"user_prompt"}','codex','session','session:original','original',null,BEFORE);
  db.prepare("INSERT INTO memory_evidence_proposals (id,project_id,branch,kind,canonical_fact,status,"
    +"policy_version,evaluator_id,fingerprint,created_at) VALUES (?,?,?,?,?,'needs_confirmation',?,?,?,?)")
    .run(PROPOSAL,PROJECT,BRANCH,'procedure',FACT,'extraction-v1','test-extractor','f'.repeat(64),BEFORE);
  db.prepare('INSERT INTO memory_evidence_proposal_evidence(proposal_id,evidence_id,linked_at) VALUES (?,?,?)')
    .run(PROPOSAL,'source-1',BEFORE);
  if (install) installEvidenceBoundReviewIntentSchema(db);
  const preview=inspectEvidenceBoundDecision({db,projectId:PROJECT,branch:BRANCH,revisionSha:REVISION,selectedRef:REF});
  const args={
    db,projectId:PROJECT,branch:BRANCH,revisionSha:REVISION,selectedRef:REF,
    expectedSnapshot:preview.reviewSnapshotSha256,
    expectedFactHash:preview.canonicalFactHash,
    decision:'confirm',decisionEvidenceId:'decision-1',recordedAt:RECORDED,
  };
  const cmd=evidenceBoundReviewIntentCommand({
    proposalRef:REF,projectId:PROJECT,branch:BRANCH,revisionSha:REVISION,
    snapshotSha256:args.expectedSnapshot,canonicalFactSha256:args.expectedFactHash,decision:'confirm',
  });
  db.prepare('INSERT INTO evidence(id,project_id,branch,authority_class,sensitivity,content_redacted,metadata_json,'
    +'harness,source_kind,source_ref,session_id,path,captured_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('decision-1',PROJECT,BRANCH,'user_direct','normal',cmd,
      '{"event_type":"user_prompt","hook_event_name":"UserPromptSubmit",'
      +'"explicit_memory":true,"explicit_memory_mode":"evidence_bound_review_intent"}',
      'codex','session','session:review-session','review-session',null,AFTER);
  return {db,args};
}

test('record exact bounded intent once; never modify proposal, Claim or relation',t=>{
  const {db,args}=fixture();t.after(()=>db.close());
  const one=stageEvidenceBoundReviewIntent(args);
  assert.equal(one.status,'staged_for_independent_host_authorization');
  assert.equal(one.independentHostAuthorizationEstablished,false);
  assert.equal(one.claimCreated,false);
  assert.equal(one.proposalModified,false);
  assert.equal(db.prepare('SELECT status FROM memory_evidence_proposals WHERE id=?').get(PROPOSAL).status,'needs_confirmation');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claims').get().n,0);
  const row=db.prepare('SELECT * FROM memory_evidence_bound_review_intents').get();
  assert.equal(row.decision,'confirm');
  assert.equal(row.status,'awaiting_independent_host_authorization');
  assert.equal(row.decision_evidence_id,'decision-1');
  assert.equal(stageEvidenceBoundReviewIntent(args).status,'already_staged');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_bound_review_intents').get().n,1);
});

test('incorrect origin, event authority or source freshness never stages',t=>{
  const {db,args}=fixture();t.after(()=>db.close());
  for(const [field,value] of [
    ['authority_class','agent_inference'],['sensitivity','secret_redacted'],
    ['branch','foreign'],['source_ref','session:wrong'],
    ['captured_at','2026-11-09T00:00:00.000Z'],
  ]) {
    const before=db.prepare('SELECT '+field+' AS field FROM evidence WHERE id=?').get('decision-1').field;
    db.prepare('UPDATE evidence SET '+field+'=? WHERE id=?').run(value,'decision-1');
    assert.throws(()=>stageEvidenceBoundReviewIntent(args));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_bound_review_intents').get().n,0);
    db.prepare('UPDATE evidence SET '+field+'=? WHERE id=?').run(before,'decision-1');
  }
});

test('new Claim or changed source makes review snapshot stale and prevents intent write',t=>{
  const {db,args}=fixture();t.after(()=>db.close());
  db.prepare('INSERT INTO claims(id,project_id,branch_scope,state,value_text) VALUES (?,?,?,?,?)')
    .run('other-claim',PROJECT,BRANCH,'active','A different rule with a semantic relation.');
  assert.throws(()=>stageEvidenceBoundReviewIntent(args),/stale/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_bound_review_intents').get().n,0);
});

test('wrong decision or mismatched scope and changed evidence cannot replay',t=>{
  const {db,args}=fixture();t.after(()=>db.close());
  assert.throws(()=>stageEvidenceBoundReviewIntent({...args,decision:'reject'}));
  assert.throws(()=>stageEvidenceBoundReviewIntent({...args,branch:'feature'}));
  assert.throws(()=>stageEvidenceBoundReviewIntent({...args,revisionSha:'b'.repeat(40)}));
  stageEvidenceBoundReviewIntent(args);
  db.prepare("UPDATE evidence SET content_redacted=? WHERE id=?").run('tampered','decision-1');
  assert.throws(()=>stageEvidenceBoundReviewIntent(args));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_bound_review_intents').get().n,1);
});

test('no automatic migration and no admin bypass flag',t=>{
  const {db,args}=fixture({install:false});t.after(()=>db.close());
  assert.throws(()=>stageEvidenceBoundReviewIntent(args),/not installed/);
  assert.throws(()=>evidenceBoundReviewIntentCommand({
    proposalRef:REF,projectId:PROJECT,branch:BRANCH,revisionSha:REVISION,
    snapshotSha256:'no',canonicalFactSha256:args.expectedFactHash,decision:'confirm',
  }));
});
