import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createP47DurableLabRevocation } from '../../reference-graph/p47-durable-lab-revocation.mjs';

const sha='83a3794cc54d2f2d129b83e8e672e18b35f11cff';
const labId='p47-durable-lab-20261109';
const key=generateKeyPairSync('ed25519');
const publicKeyPem=key.publicKey.export({type:'spki',format:'pem'});
const publicKeySha256=createHash('sha256').update(key.publicKey.export({
  type:'spki',format:'der',
})).digest('hex');
const scope={
  mode:'isolated-shadow-rehearsal',profiles:['standard','deep'],
  default_off:true,production_route_wiring:false,
};
const clock=()=>new Date('2026-11-09T19:10:02.000Z');

function signed(decision='shadow-probe-only',sequence=1,patch={},signingKey=key.privateKey) {
  const payload={
    schema_version:'reference-graph.p46-lab-lease.v1',
    repository:'Wibias/agent-hub',repository_sha:sha,
    project_ref:'vrznfnxzlxaavpqbzbzd',lab_id:labId,
    scope:'isolated-shadow-rehearsal',profiles:['standard','deep'],
    sequence,decision,issued_at:'2026-11-09T19:10:00.000Z',
    expires_at:'2026-11-09T19:10:06.000Z',default_off:true,...patch,
  };
  const payload_json=JSON.stringify(payload);
  return {
    schema_version:'reference-graph.p46-signed-lab-envelope.v1',
    payload_json,signature_base64:sign(null,Buffer.from(payload_json),signingKey).toString('base64'),
  };
}
function store(dir, overrides={}){
  return createP47DurableLabRevocation({
    directory:dir,scope,publicKeyPem,publicKeySha256,
    expectedRepositorySha:sha,expectedLabId:labId,clock,...overrides,
  });
}
function tmp(){
  return mkdtempSync(join(tmpdir(),'p47-revocation-'));
}

test('P47 signed revoked intent survives new coordinator instance and never re-arms',()=>{
  const dir=tmp();
  try {
    const first=store(dir);
    assert.equal(first.seedLabPermit(signed()).activation_authorized,false);
    assert.deepEqual(first.readSignedState(),signed());
    const revoke=first.revokeWithSignedState(signed('revoked',2));
    assert.equal(revoke.lab_revoked,true);
    assert.equal(revoke.activation_authorized,false);
    const second=store(dir);
    assert.equal(second.state().lab_revocation_intent_present,true);
    assert.equal(JSON.parse(second.readSignedState().payload_json).decision,'revoked');
    assert.throws(()=>second.seedLabPermit(signed('shadow-probe-only',3)),/BLOCKED/);
    assert.throws(()=>second.revokeWithSignedState(signed('revoked',3)),/BLOCKED/);
    assert.equal(second.state().repository_default_graph_enabled,false);
  }finally{rmSync(dir,{force:true,recursive:true});}
});

test('P47 crash after OFF-intent but before signed report blocks stale permit after restart',()=>{
  const dir=tmp();
  try{
    const state=store(dir);
    state.seedLabPermit(signed());
    writeFileSync(join(dir,'p47-revocation-intent'),'partial', {flag:'wx'});
    assert.throws(()=>store(dir).readSignedState(),/BLOCKED/);
    assert.throws(()=>store(dir).seedLabPermit(signed()),/BLOCKED/);
  }finally{rmSync(dir,{force:true,recursive:true});}
});

test('P47 rejects forged signature, old sequence and invalid lab scope before revocation',()=>{
  const dir=tmp();
  try{
    const f=store(dir);
    const impostor=generateKeyPairSync('ed25519');
    assert.throws(()=>f.seedLabPermit(signed('shadow-probe-only',1,{},impostor.privateKey)),/BLOCKED/);
    f.seedLabPermit(signed());
    for(const bad of [
      signed('revoked',1),
      signed('revoked',0),
      signed('shadow-probe-only',2),
      signed('revoked',2,{repository_sha:'0'.repeat(40)}),
      signed('revoked',2,{project_ref:'unrelated'}),
      signed('revoked',2,{},impostor.privateKey),
    ])assert.throws(()=>f.revokeWithSignedState(bad),/BLOCKED/);
    assert.equal(existsSync(join(dir,'p47-revocation-intent')),false);
    assert.deepEqual(f.readSignedState(),signed());
    assert.throws(()=>store(dir,{scope:{...scope,production_route_wiring:true}}),
      /isolated lab-only/);
  }finally{rmSync(dir,{force:true,recursive:true});}
});

test('P47 corrupt or expired signed state is blocked, with no silent reissue',()=>{
  const dir=tmp();
  try{
    const f=store(dir);
    f.seedLabPermit(signed());
    assert.throws(()=>store(dir,{clock:()=>new Date('2026-11-09T19:11:00.000Z')})
      .readSignedState(),/BLOCKED/);
    writeFileSync(join(dir,'p47-lab-permit.json'),'{badjson}');
    assert.throws(()=>store(dir).readSignedState(),/BLOCKED/);
    assert.throws(()=>f.seedLabPermit(signed()),/BLOCKED/);
  }finally{rmSync(dir,{force:true,recursive:true});}
});

test('P47 incomplete OFF-intent rejects a GET even when valid permit remains stored',()=>{
  const dir=tmp();
  try{
    const f=store(dir);
    f.seedLabPermit(signed());
    writeFileSync(join(dir,'p47-revocation-intent'),'OFF\n',{flag:'wx'});
    assert.throws(()=>f.readSignedState(),/BLOCKED/);
    assert.equal(readFileSync(join(dir,'p47-lab-permit.json'),'utf8').length>0,true);
  }finally{rmSync(dir,{force:true,recursive:true});}
});
