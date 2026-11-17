#!/usr/bin/env node
// CI-only read-only audit after a REAL Windows LocalService SCM restart.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { createConnection } from 'node:net';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'
  ||process.env.RUNNER_OS!=='Windows'||!process.env.ProgramData
  ||process.argv.length!==4||process.argv[2]!=='--pin'
  ||!isAbsolute(process.argv[3]))
  throw Error('ci_only_durable_one_shot_revocation_required');
const project='github.com/example/operator-evidence';
const proposal='E~'+createHash('sha256')
  .update('actual-canonical-evidence-proposal-id').digest('hex').slice(0,10);
const path=join(process.env.ProgramData,'AgentHubMemoryReviewLab-State',
  'review-authority.sqlite3');
if(!existsSync(path))throw Error('protected_one_shot_wal_missing');
const db=new DatabaseSync(path,{readOnly:true});
try{
  const revoked=db.prepare(
    'SELECT lane,revoked_utc FROM protected_ci_read_once_revocations').all();
  if(revoked.length!==1
    ||revoked[0].lane!=='synthetic_read_once_ci_v1'
    ||!String(revoked[0].revoked_utc).includes('T'))
    throw Error('ci_read_once_immutable_tombstone_missing');
  const rows=db.prepare(
    'SELECT request_id,project_id,branch,revision_sha,proposal_ref,'
    +'claim_id,result_set_sha256,query_sha256,principal_sid,kernel_pid,'
    +'recipient_session_sha256,state,consumed_utc,policy '
    +'FROM protected_ci_read_once_receipts ORDER BY created_utc').all();
  const counts={aborted:0,consumed_pre_io:0};
  const sessions=new Set(),requests=new Set();
  if(rows.length!==3)throw Error('ci_read_once_audit_count_wrong');
  for(const r of rows){
    if(!Object.hasOwn(counts,r.state)
      ||r.project_id!==project||r.branch!=='main'
      ||r.proposal_ref!==proposal
      ||!/^C~[0-9a-f]{24}$/.test(r.claim_id)
      ||!/^([a-f0-9]{48})$/.test(r.request_id)
      ||!/^([a-f0-9]{40})$/.test(r.revision_sha)
      ||!/^([a-f0-9]{64})$/.test(r.recipient_session_sha256)
      ||!/^([a-f0-9]{64})$/.test(r.result_set_sha256)
      ||!/^([a-f0-9]{64})$/.test(r.query_sha256)
      ||!/^S-1-5-21-(?:[0-9]+-){2,}[0-9]+$/.test(r.principal_sid)
      ||!Number.isInteger(r.kernel_pid)||r.kernel_pid<=0
      ||!String(r.consumed_utc).includes('T')
      ||r.policy!=='agenthub-protected-ci-read-once-v1'
      ||sessions.has(r.recipient_session_sha256)
      ||requests.has(r.request_id))
      throw Error('ci_read_once_audit_scope_or_receipt_corrupt');
    sessions.add(r.recipient_session_sha256);requests.add(r.request_id);
    counts[r.state]++;
  }
  if(counts.aborted!==1||counts.consumed_pre_io!==2)
    throw Error('ci_read_once_audit_terminal_states_wrong');
}finally{db.close();}

function next(child){
  return new Promise((resolve,reject)=>{
    let settled=false;
    const timer=setTimeout(()=>done(Error('ci_revocation_receiver_timeout')),12000);
    function done(error,message){
      if(settled)return;settled=true;clearTimeout(timer);
      child.off('message',messageHandler);
      child.off('error',errorHandler);
      child.off('exit',exitHandler);
      if(error)reject(error);else resolve(message);
    }
    const messageHandler=m=>done(null,m);
    const errorHandler=e=>done(e);
    const exitHandler=code=>done(Error('ci_revocation_receiver_exit_'+code));
    child.on('message',messageHandler);
    child.on('error',errorHandler);
    child.on('exit',exitHandler);
  });
}
const receiver=fork(new URL('./memory-read-once-ci-recipient.mjs',import.meta.url),
  [process.argv[3],proposal],{stdio:['ignore','ignore','pipe','ipc']});
try{
  const ready=await next(receiver);
  if(ready?.status!=='ready')throw Error('ci_revocation_receiver_not_ready');
  const nonce=randomBytes(32).toString('base64url');
  const denied=await new Promise((resolve,reject)=>{
    const pipe=createConnection('\\\\.\\pipe\\AgentHubMemoryReviewLab-OperatorV1');
    let bytes=0,settled=false;
    function done(error){
      if(settled)return;settled=true;pipe.destroy();
      if(error)reject(error);else resolve(bytes);
    }
    pipe.setTimeout(4500,()=>done(Error('ci_revocation_operator_timeout')));
    pipe.on('error',()=>done(Error('ci_revocation_operator_unavailable')));
    pipe.on('connect',()=>pipe.write(JSON.stringify({
      protocol:'agenthub-operator-uv-service-v1',
      op:'ci_read_begin',nonce,
      projectId:project,branch:'main',proposalRef:proposal,
    })+'\n'));
    pipe.on('data',chunk=>{
      bytes+=chunk.length;
      if(bytes>0)done(Error('revoked_read_received_signed_offer'));
    });
    pipe.on('end',()=>done(null));
  });
  if(denied!==0)throw Error('revoked_one_shot_was_offered');
  const result=await next(receiver);
  if(result?.status!=='denied_without_bytes')
    throw Error('revoked_connected_recipient_received_or_hung');
  process.stdout.write(JSON.stringify({
    status:'durable_ci_read_once_revoke_survived_real_scm_restart',
    receipt_rows:3,aborted_rows:1,pre_io_consumed_rows:2,
    permanent_revocation_rows:1,
    fresh_connected_recipient_denied:true,
    no_private_bytes:true,production_no_go:true,
  })+'\n');
}finally{
  try{receiver.kill();}catch{}
}
