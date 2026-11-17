import { createHash, createPublicKey, verify } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { isAbsolute } from 'node:path';

export const CI_READ_ONCE_PIPE='\\\\.\\pipe\\AgentHubMemoryReviewLab-ReadOnceCiV1';
export const CI_READ_ONCE_PROTOCOL='agenthub-memory-read-once-ci-v1';
export const CI_READ_ONCE_PROJECT='github.com/example/operator-evidence';
export const CI_READ_ONCE_BRANCH='main';
export const CI_READ_ONCE_PROPOSAL='E~'+createHash('sha256')
  .update('actual-canonical-evidence-proposal-id').digest('hex').slice(0,10);
export const CI_READ_ONCE_QUERY='exact-proposal:'+CI_READ_ONCE_PROPOSAL;

const HEX40=/^[0-9a-f]{40}$/u,HEX64=/^[0-9a-f]{64}$/u,
  CLAIM=/^C~[0-9a-f]{24}$/u,REQUEST=/^[0-9a-f]{48}$/u;
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>isRecord(x)
  &&Object.keys(x).length===keys.length
  &&keys.every(k=>Object.hasOwn(x,k));
const sha=text=>createHash('sha256').update(text).digest('hex');
const denied=status=>Object.freeze({
  status,items:[],read_only:true,ci_simulation_only:true,
  trusted_for_production_recall:false,
  physical_human_approval_verified:false,production_authorized:false,
});

export function verifySignedOnceCi({envelope,pinnedKey,expectedPid=process.pid}={}) {
  function deny(){throw new Error('ci_read_once_invalid_signed_recipient_payload');}
  if(!exact(envelope,['protocol','payload_b64','signature_b64'])
    ||envelope.protocol!==CI_READ_ONCE_PROTOCOL
    ||typeof pinnedKey!=='string'||pinnedKey.length>8192
    ||typeof expectedPid!=='number'||!Number.isSafeInteger(expectedPid))
    deny();
  let payload;
  try {
    const raw=Buffer.from(envelope.payload_b64,'base64');
    const signature=Buffer.from(envelope.signature_b64,'base64');
    if(raw.length<100||raw.length>16384
      ||signature.length<64||signature.length>96
      ||raw.toString('base64')!==envelope.payload_b64
      ||signature.toString('base64')!==envelope.signature_b64)
      deny();
    const key=createPublicKey(pinnedKey);
    if(key.asymmetricKeyType!=='ec'
      ||key.asymmetricKeyDetails?.namedCurve!=='prime256v1'
      ||!verify('sha256',raw,key,signature))deny();
    payload=JSON.parse(raw.toString('utf8'));
  }catch{deny();}
  if(!exact(payload,[
    'protocol','status','request_id','claim_id','project_id',
    'branch','revision_sha','proposal_ref','fact_sha256',
    'result_set_sha256','recipient_session_sha256',
    'recipient_kernel_pid','value','provenance','production_authorized',
  ])||payload.protocol!==CI_READ_ONCE_PROTOCOL
    ||payload.status!=='exact_one_shot_synthetic_ci_claim'
    ||payload.project_id!==CI_READ_ONCE_PROJECT
    ||payload.branch!==CI_READ_ONCE_BRANCH
    ||payload.proposal_ref!==CI_READ_ONCE_PROPOSAL
    ||!HEX40.test(payload.revision_sha??'')
    ||!HEX64.test(payload.fact_sha256??'')
    ||!HEX64.test(payload.result_set_sha256??'')
    ||!HEX64.test(payload.recipient_session_sha256??'')
    ||!REQUEST.test(payload.request_id??'')
    ||!CLAIM.test(payload.claim_id??'')
    ||payload.recipient_kernel_pid!==expectedPid
    ||payload.provenance!=='user_direct_reaffirmed_and_published_v1'
    ||payload.production_authorized!==false
    ||typeof payload.value!=='string'
    ||payload.value.length<1||payload.value.length>4000
    ||sha(payload.value)!==payload.fact_sha256)
    deny();
  return payload;
}

export async function requestCiReadOnce({pinPath,timeoutMs=40000}={}) {
  if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'
    ||process.env.RUNNER_OS!=='Windows')throw Error('ci_read_once_only');
  if(typeof pinPath!=='string'||!isAbsolute(pinPath)
    ||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)
    throw Error('ci_read_once_arguments_invalid');
  const stat=lstatSync(pinPath);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<100||stat.size>8192)
    throw Error('ci_read_once_pin_invalid');
  const pem=readFileSync(pinPath,'utf8');
  return await new Promise((resolve,reject)=>{
    const pipe=createConnection(CI_READ_ONCE_PIPE);
    let buffer='',ack=false,settled=false;
    const done=(error,result)=>{
      if(settled)return;
      settled=true;
      pipe.destroy();
      if(error)reject(error);else resolve(result);
    };
    pipe.setTimeout(timeoutMs,()=>done(Error('ci_read_once_timed_out')));
    pipe.on('error',()=>done(Error('ci_read_once_pipe_unavailable')));
    pipe.on('connect',()=>pipe.write(JSON.stringify({
      protocol:CI_READ_ONCE_PROTOCOL,
      projectId:CI_READ_ONCE_PROJECT,branch:CI_READ_ONCE_BRANCH,
      proposalRef:CI_READ_ONCE_PROPOSAL,
    })+'\n'));
    pipe.on('end',()=>done(Error('ci_read_once_denied_without_release')));
    pipe.on('data',chunk=>{
      if(settled)return;
      buffer+=chunk.toString('utf8');
      if(buffer.length>32768)
        return done(Error('ci_read_once_oversize'));
      let n;
      while((n=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,n);buffer=buffer.slice(n+1);
        try {
          const message=JSON.parse(line);
          if(!ack){
            if(!exact(message,['protocol','status'])
              ||message.protocol!==CI_READ_ONCE_PROTOCOL
              ||message.status!=='pending_no_claim')
              throw Error('ci_read_once_preconsent_data_invalid');
            ack=true;
            // CI test observes the waiting process through IPC, never
            // treats this as an authentication proof in normal Codex.
            process.send?.({status:'ci_mcp_recipient_ready'});
          }else{
            const verified=verifySignedOnceCi({
              envelope:message,pinnedKey:pem,expectedPid:process.pid,
            });
            done(null,verified);
          }
        }catch{done(Error('ci_read_once_untrusted_reply'));}
      }
    });
  });
}

/** This alternate explicit CI mode never reads canonical user SQLite. */
export async function readScopedCiOneShot({
  query,maxItems=5,pinPath,
  platform=process.platform,ciEnv=process.env,
  request=requestCiReadOnce,
}={}) {
  if(platform!=='win32'||ciEnv.GITHUB_ACTIONS!=='true'
    ||ciEnv.RUNNER_OS!=='Windows')return denied('ci_one_shot_only');
  if(query!==CI_READ_ONCE_QUERY
    ||!Number.isInteger(maxItems)||maxItems<1||maxItems>10)
    return denied('ci_one_shot_exact_query_required');
  if(typeof pinPath!=='string'||!isAbsolute(pinPath))
    return denied('ci_one_shot_pin_required');
  try{
    const p=await request({pinPath});
    if(p?.production_authorized!==false
      ||p?.project_id!==CI_READ_ONCE_PROJECT
      ||p?.branch!==CI_READ_ONCE_BRANCH
      ||p?.proposal_ref!==CI_READ_ONCE_PROPOSAL
      ||p?.recipient_kernel_pid!==process.pid
      ||p?.status!=='exact_one_shot_synthetic_ci_claim')
      return denied('ci_one_shot_untrusted_response');
    return Object.freeze({
      status:'found_ci_one_shot_not_production',
      project_id:p.project_id,branch:p.branch,revision_sha:p.revision_sha,
      items:[{
        claim_id:p.claim_id,kind:'knowledge',value:p.value,
        fact_sha256:p.fact_sha256,provenance:p.provenance,
        recipient_session_sha256:p.recipient_session_sha256,
      }],
      read_only:true,ci_simulation_only:true,
      ci_mcp_delivered:true,
      trusted_for_production_recall:false,
      physical_human_approval_verified:false,
      production_authorized:false,
    });
  }catch{
    return denied('ci_one_shot_denied_or_expired');
  }
}
