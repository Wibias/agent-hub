import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHash, generateKeyPairSync, randomBytes, sign,
} from 'node:crypto';
import {
  buildEvidenceBoundWebAuthnChallenge,
  verifyEvidenceBoundWebAuthnAssertion,
} from '../../memory-engine/evidence-bound-webauthn-verifier.mjs';

const sha = s => createHash('sha256').update(s).digest();
const b64 = b => Buffer.from(b).toString('base64url');
const context = {
  projectId:'github.com/Wibias/agent-hub',
  branch:'main',
  revisionSha:'a'.repeat(40),
  proposalRef:'E~0123456789',
  reviewSnapshotSha256:'b'.repeat(64),
  canonicalFactSha256:'c'.repeat(64),
  decision:'confirm',
};

function setup({ flags=0x05, counter=1, origin='http://localhost:4328',
  rpId='localhost', challenge=null }={}) {
  const { privateKey, publicKey }=generateKeyPairSync('ec',{
    namedCurve:'prime256v1',
  });
  const expectedChallenge=challenge ?? buildEvidenceBoundWebAuthnChallenge({
    ...context,nonce:randomBytes(32),
  });
  const client=Buffer.from(JSON.stringify({
    type:'webauthn.get',origin,challenge:expectedChallenge,crossOrigin:false,
  }), 'utf8');
  const auth=Buffer.alloc(37);
  sha(Buffer.from(rpId)).copy(auth,0);
  auth[32]=flags;
  auth.writeUInt32BE(counter,33);
  const signature=sign('sha256',Buffer.concat([auth,sha(client)]),privateKey);
  const credentialId=b64(randomBytes(32));
  const assertion={
    id:credentialId,type:'public-key',
    response:{
      clientDataJSON:b64(client),
      authenticatorData:b64(auth),
      signature:b64(signature),
    },
  };
  const options={
    assertion,credentialId,
    credentialPublicKeyPem:publicKey.export({type:'spki',format:'pem'}),
    expectedChallenge,expectedOrigin:origin,
    previousSignCount:0,
  };
  return {options,privateKey};
}

test('challenge binds exact proposal, decision, fact, branch, commit and nonce',()=>{
  const nonce=Buffer.alloc(32,0x4b);
  const baseline=buildEvidenceBoundWebAuthnChallenge({...context,nonce});
  assert.match(baseline,/^[A-Za-z0-9_-]{43}$/u);
  for(const change of [
    {decision:'reject'}, {branch:'other'},{revisionSha:'d'.repeat(40)},
    {reviewSnapshotSha256:'e'.repeat(64)}, {canonicalFactSha256:'f'.repeat(64)},
    {proposalRef:'E~1111111111'},
  ]) {
    assert.notEqual(buildEvidenceBoundWebAuthnChallenge({
      ...context,...change,nonce,
    }),baseline);
  }
  assert.notEqual(buildEvidenceBoundWebAuthnChallenge({
    ...context,nonce:Buffer.alloc(32,0x4c),
  }),baseline);
  assert.throws(()=>buildEvidenceBoundWebAuthnChallenge({
    ...context,nonce:Buffer.alloc(4),
  }),/nonce/);
});

test('valid P-256 assertion requires UP + UV and returns no approval authority',()=>{
  const {options}=setup({counter:9});
  const result=verifyEvidenceBoundWebAuthnAssertion(options);
  assert.equal(result.verified,true);
  assert.equal(result.userVerification,true);
  assert.equal(result.userPresence,true);
  assert.equal(result.signCount,9);
  assert.equal(result.approvedReviewDecision,false);
  assert.equal(result.hostCredentialProtectionVerified,false);
  assert.equal(result.challengeConsumed,false);
});

test('missing user verification or presence always fails even with a valid signature',()=>{
  for(const flags of [0,0x01,0x04,0x10]) {
    const {options}=setup({flags});
    assert.throws(()=>verifyEvidenceBoundWebAuthnAssertion(options),/user_presence_or_verification_missing/);
  }
});

test('reject wrong origin, rpId, challenge, credential ID and signature',()=>{
  const {options}=setup();
  const changes=[
    {...options,expectedOrigin:'http://localhost:4545'},
    {...options,expectedChallenge:b64(randomBytes(32))},
    {...options,credentialId:b64(randomBytes(32))},
    {...options,assertion:{...options.assertion,
      response:{...options.assertion.response,signature:b64(randomBytes(70))}}},
  ];
  for(const changed of changes) {
    assert.throws(()=>verifyEvidenceBoundWebAuthnAssertion(changed));
  }
  const foreign=setup({rpId:'evil.example'});
  assert.throws(()=>verifyEvidenceBoundWebAuthnAssertion(foreign.options),/rp_id_hash/);
  const remote=setup({origin:'https://example.com'});
  assert.throws(()=>verifyEvidenceBoundWebAuthnAssertion(remote.options),/origin_not_localhost/);
});

test('cross-origin, unsupported flags, wrong types and noncanonical encodings fail',()=>{
  for(const flags of [0x45,0x85,0x15,0x07]) {
    const {options}=setup({flags});
    assert.throws(()=>verifyEvidenceBoundWebAuthnAssertion(options));
  }
  const {options}=setup();
  assert.throws(()=>verifyEvidenceBoundWebAuthnAssertion({
    ...options,assertion:{...options.assertion,type:'password'},
  }),/credential_type/);
  assert.throws(()=>verifyEvidenceBoundWebAuthnAssertion({
    ...options,assertion:{...options.assertion,id:'%%%'},
  }),/credential_invalid/);
  assert.throws(()=>verifyEvidenceBoundWebAuthnAssertion({
    ...options,assertion:{...options.assertion,response:{
      ...options.assertion.response,userHandle:b64(Buffer.from('foreign-user')),
    }},
  }),/unexpected_user_handle/);
});

test('monotonic counters reject stale replay, zero counters are explicitly unverified',()=>{
  const {options}=setup({counter:7});
  assert.throws(()=>verifyEvidenceBoundWebAuthnAssertion({
    ...options,previousSignCount:7,
  }),/sign_counter_replay/);
  assert.equal(verifyEvidenceBoundWebAuthnAssertion({
    ...options,previousSignCount:5,
  }).counterVerifiable,true);
  const zero=setup({counter:0});
  assert.equal(verifyEvidenceBoundWebAuthnAssertion({
    ...zero.options,previousSignCount:5,
  }).counterVerifiable,false);
});

test('clientData challenge mismatch cannot be bypassed by signing another challenge',()=>{
  const a=setup();
  const b=setup({challenge:b64(randomBytes(32))});
  assert.throws(()=>verifyEvidenceBoundWebAuthnAssertion({
    ...b.options,expectedChallenge:a.options.expectedChallenge,
  }),/challenge_mismatch/);
});
