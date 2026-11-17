#!/usr/bin/env node
/**
 * SYNTHETIC ADMIN-ONLY SCM test, never a real Windows Hello registration.
 * Generated software ES256 key exercises the exact service-owned enrollment
 * and possession tickets. On a real PC ONLY the independently installed,
 * admin-owned WinForms executable may initiate physical MakeCredential.
 */
import {
  createConnection,
} from 'node:net';
import {
  createHash, createPublicKey, generateKeyPairSync,
  randomBytes, sign, verify,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.RUNNER_OS !== 'Windows' || process.argv.length !== 3
  || !isAbsolute(process.argv[2])) {
  process.stderr.write('CI-only protected native enrollment test; no user keys or Claims.\n');
  process.exit(2);
}
const pinPath = process.argv[2];
const publicPin = createPublicKey(readFileSync(pinPath,'utf8'));
const pipePath = '\\\\.\\pipe\\AgentHubMemoryReviewLab-OperatorV1';
const protocol = 'agenthub-operator-uv-service-v1';
const scope = {
  projectId:'github.com/example/operator-evidence',
  branch:'main',
  proposalRef:'E~'+createHash('sha256').update(
    'actual-canonical-evidence-proposal-id').digest('hex').slice(0,10),
};
const fact='This real-schema E~ proposal has linked Evidence but no human approval.';
const sha = bytes => createHash('sha256').update(bytes).digest();
const b64 = bytes => Buffer.from(bytes).toString('base64url');

async function send(op, fields) {
  const nonce=b64(randomBytes(32));
  const input=JSON.stringify({protocol,op,nonce,...fields})+'\n';
  // Service uses one NamedPipeServerStream per request. Between requests
  // the previous instance can close before its successor starts listening.
  // Only retry a connection that FAILED BEFORE on('connect'); once a request
  // could have been delivered, absolutely no retry is permitted.
  let reply;
  for (let attempt=0;attempt<20;attempt++) {
    try {
      reply=await new Promise((resolve,reject)=>{
        const pipe=createConnection(pipePath);
        let output='',settled=false,connected=false;
        const fail=error=>{
          if(settled)return;
          settled=true;pipe.destroy();
          if(connected) {
            const delivered=new Error('native_enrollment_response_failed_after_connect');
            delivered.code='DELIVERED_OR_UNKNOWN';
            reject(delivered);
          } else reject(error);
        };
        pipe.setTimeout(4000,()=>fail(new Error('native_enrollment_pipe_timeout')));
        pipe.on('error',fail);
        pipe.on('connect',()=>{connected=true;pipe.write(input);});
        pipe.on('data',chunk=>{
          if(settled)return;
          output+=chunk.toString('utf8');
          if(output.length>16384)
            return fail(new Error('native_enrollment_response_too_large'));
          const end=output.indexOf('\n');
          if(end>=0){
            settled=true;pipe.destroy();resolve(output.slice(0,end));
          }
        });
        pipe.on('end',()=>{
          if(!settled)fail(new Error('native_enrollment_pipe_closed'));
        });
      });
      break;
    } catch(error) {
      if (attempt===19 || !['ENOENT','ECONNREFUSED'].includes(error?.code))
        throw error;
      await new Promise(resolve=>setTimeout(resolve,180));
    }
  }
  const envelope=JSON.parse(reply);
  if(envelope.protocol!==protocol)throw new Error('enrollment_envelope_protocol');
  const data=Buffer.from(envelope.payload_b64,'base64');
  const signature=Buffer.from(envelope.signature_b64,'base64');
  if(data.toString('base64')!==envelope.payload_b64
    || signature.toString('base64')!==envelope.signature_b64
    || !verify('sha256',data,publicPin,signature))
    throw new Error('untrusted_service_enrollment_signature');
  const p=JSON.parse(data.toString('utf8'));
  if(p.protocol!==protocol || p.op!==op || p.nonce!==nonce
    || p.service_signed!==true || p.human_approval_verified!==false
    || p.claim_written!==false)
    throw new Error('enrollment_reply_spoofed_authority');
  return p;
}

function attestedFixture(key, challenge){
  const credentialId=randomBytes(32);
  const jwk=key.publicKey.export({format:'jwk'});
  const x=Buffer.from(jwk.x,'base64url'),y=Buffer.from(jwk.y,'base64url');
  if(x.length!==32||y.length!==32)throw new Error('test_key_not_p256');
  const cose=Buffer.concat([
    Buffer.from([0xa5,0x01,0x02,0x03,0x26,0x20,0x01,0x21,0x58,0x20]),
    x,Buffer.from([0x22,0x58,0x20]),y,
  ]);
  const auth=Buffer.alloc(55+credentialId.length+cose.length);
  sha('localhost').copy(auth,0);
  auth[32]=0x45; // UP, UV, attested credential data
  auth.writeUInt16BE(credentialId.length,53);
  credentialId.copy(auth,55);
  cose.copy(auth,55+credentialId.length);
  const client=Buffer.from(JSON.stringify({
    type:'webauthn.create',challenge,origin:'http://localhost:4328',
    crossOrigin:false,
  }));
  return{
    credentialId:b64(credentialId),
    clientDataJSON:b64(client),
    authenticatorData:b64(auth),
  };
}

function proofAssertion(key, offer, counter){
  const client=Buffer.from(JSON.stringify({
    type:'webauthn.get',challenge:offer.challenge,
    origin:offer.expected_origin,crossOrigin:false,
  }));
  const auth=Buffer.alloc(37);
  sha('localhost').copy(auth,0);
  auth[32]=0x05;auth.writeUInt32BE(counter,33);
  return {
    credentialId:offer.credential_id,type:'public-key',
    clientDataJSON:b64(client),authenticatorData:b64(auth),
    signature:b64(sign('sha256',
      Buffer.concat([auth,sha(client)]),key.privateKey)),
  };
}

async function run(){
  const started=await send('enroll_begin',scope);
  if(started.status!=='operator_native_registration_challenge_unapproved'
    || started.kind!=='procedure'
    || started.source_origin!=='operator_pinned_unverified_evidence_v1'
    || started.meaning?.canonicalFact!==fact
    || started.meaning.projectId!==scope.projectId
    || started.meaning.branch!==scope.branch
    || started.meaning.proposalRef!==scope.proposalRef
    || Buffer.from(started.challenge,'base64url').length!==32
    || Buffer.from(started.user_id,'base64url').length!==32)
    throw new Error('enrollment_source_or_challenge_invalid');
  const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const attestation=attestedFixture(key,started.challenge);
  const possess=await send('enroll_key',{
    ticketId:started.ticket_id,...attestation,
  });
  if(possess.status!=='operator_native_possession_challenge_unapproved'
    || possess.request_id!==started.request_id
    || possess.credential_id!==attestation.credentialId
    || possess.meaning.canonicalFact!==fact
    || possess.meaning.canonicalFactSha256!==started.meaning.canonicalFactSha256
    || possess.meaning.reviewSnapshotSha256!==started.meaning.reviewSnapshotSha256)
    throw new Error('native_possession_ticket_invalid');
  const enrolled=await send('enroll_finish',{
    ticketId:possess.ticket_id,
    assertion:proofAssertion(key,possess,1),
  });
  if(enrolled.status!=='operator_native_uv_enrolled_unapproved'
    || enrolled.signature_verified!==true
    || enrolled.enrollment_state!=='operator_native_uv_enrolled_unapproved_v1')
    throw new Error('native_enrollment_not_persisted');

  // After registration the same service can verify a fresh challenge,
  // but it still CANNOT write/approve a real operator E~ Claim.
  const begin=await send('begin',scope);
  if(begin.status!=='operator_service_uv_challenge_not_approval'
    || begin.credential_id!==attestation.credentialId
    || begin.meaning?.canonicalFact!==fact)
    throw new Error('new_native_pin_not_available_for_probe');
  const confirmed=await send('complete',{
    ticketId:begin.ticket_id,assertion:proofAssertion(key,begin,2),
  });
  if(confirmed.status!=='operator_webauthn_uv_verified_not_approved'
    || confirmed.signature_verified!==true)
    throw new Error('operator_new_credential_uv_not_accepted');
  const replay=await send('begin',scope);
  const denied=await send('complete',{
    ticketId:replay.ticket_id,assertion:proofAssertion(key,replay,2),
  });
  if(denied.signature_verified!==false
    || !['sign_counter_replay','operator_proof_scope_or_counter_denied'].includes(denied.status))
    throw new Error('native_enrollment_sign_counter_replay_accepted');

  process.stdout.write(JSON.stringify({
    status:'synthetic_native_enrollment_bridge_pass_not_human',
    source_kind:'procedure',
    original_fact_service_signed:true,
    independent_create_and_get_challenges:true,
    protected_key_persisted_for_probe:true,
    nonzero_sign_counter_replay_denied:true,
    hardware_attestation_verified:false,
    human_approval_verified:false,
    claim_written:false,
    production_no_go:true,
  })+'\n');
}
try{await run();}
catch(error){
  process.stderr.write('Synthetic native enrollment SCM check failed: '
    + String(error?.message??'unknown')+'\n');
  process.exitCode=2;
}
