#!/usr/bin/env node
/**
 * CI ONLY: a real second Windows process receives ONE signed synthetic private
 * Claim over a held named-pipe connection. Do not use this for personal Memory.
 */
import {createConnection} from 'node:net';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';

if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'
  ||process.env.RUNNER_OS!=='Windows'||process.argv.length!==4
  ||!isAbsolute(process.argv[2])||!/^E~[a-f0-9]{10}$/.test(process.argv[3])){
  process.stderr.write('CI-only exact one-shot recipient expected\n');
  process.exit(2);
}
const proto='agenthub-memory-read-once-ci-v1';
const pin=createPublicKey(readFileSync(process.argv[2],'utf8'));
const proposal=process.argv[3];
const expectedValue='This knowledge statement is proposed from unverified historical Evidence.';
const expectedHash=createHash('sha256').update(expectedValue).digest('hex');
const pipe=createConnection('\\\\.\\pipe\\AgentHubMemoryReviewLab-ReadOnceCiV1');
let buffer='',ready=false,done=false;
function finish(status,extra={}){
  if(done)return;
  done=true;
  process.send?.({status,...extra});
  pipe.destroy();
}
pipe.setTimeout(20000,()=>{finish('timeout');process.exitCode=2;});
pipe.on('connect',()=>{
  pipe.write(JSON.stringify({
    protocol:proto,projectId:'github.com/example/operator-evidence',
    branch:'main',proposalRef:proposal,
  })+'\n');
});
pipe.on('data',chunk=>{
  if(done)return;
  buffer+=chunk.toString('utf8');
  if(buffer.length>32768){finish('oversize');process.exitCode=2;return;}
  let e;
  while((e=buffer.indexOf('\n'))>=0){
    const raw=buffer.slice(0,e);buffer=buffer.slice(e+1);
    try{
      const reply=JSON.parse(raw);
      if(!ready){
        if(reply.protocol!==proto||reply.status!=='pending_no_claim'
          ||Object.keys(reply).length!==2)throw Error('non_secret_ack_invalid');
        ready=true;process.send?.({status:'ready'});
        continue;
      }
      if(reply.protocol!==proto||Object.keys(reply).sort().join(',')!==
          'payload_b64,protocol,signature_b64')throw Error('envelope_invalid');
      const payload=Buffer.from(reply.payload_b64,'base64');
      const sig=Buffer.from(reply.signature_b64,'base64');
      if(payload.toString('base64')!==reply.payload_b64
        ||sig.toString('base64')!==reply.signature_b64
        ||!verify('sha256',payload,pin,sig))throw Error('signature_invalid');
      const p=JSON.parse(payload.toString('utf8'));
      if(p.protocol!==proto||p.status!=='exact_one_shot_synthetic_ci_claim'
        ||p.project_id!=='github.com/example/operator-evidence'
        ||p.branch!=='main'||p.proposal_ref!==proposal
        ||p.value!==expectedValue||p.fact_sha256!==expectedHash
        ||p.provenance!=='user_direct_reaffirmed_and_published_v1'
        ||p.production_authorized!==false
        ||!/^C~[a-f0-9]{24}$/.test(p.claim_id)
        ||!Number.isInteger(p.recipient_kernel_pid)
        ||p.recipient_kernel_pid!==process.pid
        ||!/^([a-f0-9]{64})$/.test(p.result_set_sha256))
        throw Error('signed_claim_scope_or_recipient_invalid');
      finish('received_signed_exact_once',{
        claim_hash:expectedHash,claim_id:p.claim_id,
        result_set_sha256:p.result_set_sha256,
        recipient_pid:p.recipient_kernel_pid,
      });
    }catch(error){
      finish('invalid_'+error.message);
      process.exitCode=2;
    }
  }
});
pipe.on('end',()=>finish(ready?'denied_without_bytes':'closed_without_ack'));
pipe.on('error',error=>{finish('pipe_'+error.code);process.exitCode=2;});
