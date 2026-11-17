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
const fact='This knowledge statement is proposed from unverified historical Evidence.';
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
    || (op!=='publish_complete' && p.claim_written!==false)
    || (op==='publish_complete' && p.claim_written!==p.signature_verified))
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
    || started.kind!=='knowledge'
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

  // Separate operator-INTENT gesture: a new purpose-bound challenge and
  // a fresh UV signature, never a real human or verified historic source.
  const affirmation=await send('reaffirm_begin',scope);
  if(affirmation.status!=='operator_reaffirmation_challenge_no_claim'
    || affirmation.kind!=='knowledge'
    || affirmation.confirmation_scope!=='new_user_statement_only'
    || affirmation.meaning?.canonicalFact!==fact
    || affirmation.meaning.canonicalFactSha256!==started.meaning.canonicalFactSha256
    || affirmation.credential_id!==attestation.credentialId
    || affirmation.source_origin!=='operator_pinned_unverified_evidence_v1'
    || affirmation.reaffirmation_intent_recorded!==false
    || affirmation.original_evidence_verified!==false
    || affirmation.human_approval_verified!==false
    || affirmation.claim_written!==false)
    throw new Error('synthetic_reaffirmation_challenge_invalid');
  const affirmed=await send('reaffirm_complete',{
    ticketId:affirmation.ticket_id,
    assertion:proofAssertion(key,affirmation,3),
  });
  if(affirmed.status!=='operator_reaffirmation_intent_recorded_no_claim'
    || affirmed.signature_verified!==true
    || affirmed.reaffirmation_intent_recorded!==true
    || affirmed.request_id!==started.request_id
    || affirmed.original_evidence_verified!==false
    || affirmed.human_approval_verified!==false
    || affirmed.claim_written!==false)
    throw new Error('synthetic_reaffirmation_intent_not_recorded');

  // New independent UV purpose for a protected direct Claim.
  // The synthetic software key is not human consent or source validation.
  const publish=await send('publish_begin',scope);
  if(publish.status!=='operator_direct_claim_publication_challenge'
    || publish.confirmation_scope!=='publish_new_user_direct_memory_claim'
    || publish.provenance!=='user_direct_reaffirmed_and_published_v1'
    || publish.meaning?.canonicalFact!==fact
    || publish.meaning.canonicalFactSha256!==started.meaning.canonicalFactSha256
    || publish.source_origin!=='operator_pinned_unverified_evidence_v1'
    || publish.published_to_codex!==false
    || publish.original_evidence_verified!==false
    || publish.claim_written!==false)
    throw new Error('synthetic_claim_commit_challenge_invalid');
  const published=await send('publish_complete',{
    ticketId:publish.ticket_id,
    assertion:proofAssertion(key,publish,4),
  });
  if(published.status!=='protected_user_direct_claim_committed_not_published_to_codex'
    || published.signature_verified!==true
    || published.claim_written!==true
    || published.provenance!=='user_direct_reaffirmed_and_published_v1'
    || !/^C~[a-f0-9]{24}$/.test(published.claim_id)
    || published.original_evidence_verified!==false
    || published.published_to_codex!==false
    || published.human_approval_verified!==false)
    throw new Error('synthetic_direct_claim_not_committed');

  // The service reuses the same ADMIN-only Windows pipe for a separate,
  // one-read preview of EXACTLY this protected, previously committed Claim.
  // Synthetic ES256 is a CI gesture, NEVER physical Hello or a Codex grant.
  const read=await send('read_begin',scope);
  const expectedClaim=[
    published.claim_id,scope.projectId,scope.branch,
    started.meaning.revisionSha,scope.proposalRef,
    started.meaning.reviewSnapshotSha256,
    started.meaning.canonicalFactSha256,'knowledge',
    fact,'user_direct_reaffirmed_and_published_v1',
  ];
  const selectedHash=sha(Buffer.from(JSON.stringify(expectedClaim))).toString('hex');
  if(read.status!=='protected_operator_read_preview_uv_challenge_no_release'
    || read.service_signed!==true || read.claim_written!==false
    || read.human_approval_verified!==false
    || read.published_to_codex!==false || read.read_released!==false
    || read.original_evidence_verified!==false
    || read.project_id!==scope.projectId || read.branch!==scope.branch
    || read.proposal_ref!==scope.proposalRef
    || read.claim_id!==published.claim_id
    || read.value!==fact || read.kind!=='knowledge'
    || read.query!=='exact-proposal:'+scope.proposalRef
    || read.result_set_sha256!==selectedHash
    || read.query_sha256!==sha(read.query).toString('hex')
    || read.recipient!=='Sealed operator UI only; no Codex recipient'
    || read.recipient_session_sha256!==
        sha('agenthub-local-operator-ui-preview-no-codex-v1').toString('hex')
    || read.credential_id!==attestation.credentialId
    || !/^S-1-5-21-(?:[0-9]+-){2,}[0-9]+$/.test(read.principal_sid)
    || !/^[a-f0-9]{48}$/.test(read.request_id)
    || Buffer.from(read.challenge,'base64url').length!==32)
    throw new Error('untrusted_operator_read_offer_or_claim_text');

  // A signed Claim-publication assertion CANNOT approve read disclosure.
  const wrongPurpose=await send('read_complete',{
    ticketId:read.ticket_id,assertion:proofAssertion(key,publish,5),
  });
  if(wrongPurpose.signature_verified!==false
    || wrongPurpose.status!=='challenge_mismatch'
    || wrongPurpose.read_released!==false
    || wrongPurpose.published_to_codex!==false)
    throw new Error('read_preview_accepted_claim_publication_assertion');
  try {
    await send('read_complete',{
      ticketId:read.ticket_id,assertion:proofAssertion(key,read,5),
    });
    throw new Error('read_preview_consumed_ticket_replayed');
  } catch(error) {
    if(String(error?.message??'').includes('read_preview_consumed_ticket_replayed'))
      throw error;
  }

  const secondRead=await send('read_begin',scope);
  if(secondRead.result_set_sha256!==selectedHash
    || secondRead.request_id===read.request_id)
    throw new Error('read_preview_snapshot_or_nonce_reuse');
  const consent=await send('read_complete',{
    ticketId:secondRead.ticket_id,
    assertion:proofAssertion(key,secondRead,5),
  });
  if(consent.status!=='verified_read_disclosure_intent_only'
    || consent.signature_verified!==true
    || consent.request_id!==secondRead.request_id
    || consent.result_set_sha256!==selectedHash
    || consent.claim_written!==false
    || consent.read_released!==false
    || consent.published_to_codex!==false
    || consent.human_approval_verified!==false)
    throw new Error('synthetic_read_intent_claimed_release_or_failed');

  process.stdout.write(JSON.stringify({
    status:'synthetic_native_enrollment_bridge_pass_not_human',
    source_kind:'knowledge',
    purpose_bound_reaffirmation_intent_recorded:true,
    separate_purpose_bound_claim_commit:true,
    private_direct_claim_committed:true,
    protected_read_offer_exact_claim_and_query:true,
    read_purpose_uv_one_use_only:true,
    read_released:false,
    published_to_codex:false,
    historical_evidence_verified:false,
    original_fact_service_signed:true,
    independent_create_and_get_challenges:true,
    protected_key_persisted_for_probe:true,
    nonzero_sign_counter_replay_denied:true,
    hardware_attestation_verified:false,
    human_approval_verified:false,
    claim_written:true, // protected direct CI Claim, NOT Codex-published
    production_no_go:true,
  })+'\n');
}
try{await run();}
catch(error){
  process.stderr.write('Synthetic native enrollment SCM check failed: '
    + String(error?.message??'unknown')+'\n');
  process.exitCode=2;
}
