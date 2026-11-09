import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createP47DurableLabRevocation } from '../../reference-graph/p47-durable-lab-revocation.mjs';

const sha='83a3794cc54d2f2d129b83e8e672e18b35f11cff';
const labId='p47-worker-restart-lab-20261109';
const key=generateKeyPairSync('ed25519');
const publicKeyPem=key.publicKey.export({type:'spki',format:'pem'});
const keyPin=createHash('sha256')
  .update(key.publicKey.export({type:'spki',format:'der'})).digest('hex');
const scope={
  mode:'isolated-shadow-rehearsal',default_off:true,
  production_route_wiring:false,profiles:['standard','deep'],
};
const now=()=>new Date('2026-11-09T19:10:02.000Z');
const fixture=fileURLToPath(new URL('./fixtures/p46-lab-worker.mjs',import.meta.url));
function envelope(decision='shadow-probe-only',sequence=1){
  const payload_json=JSON.stringify({
    schema_version:'reference-graph.p46-lab-lease.v1',
    repository:'Wibias/agent-hub',repository_sha:sha,
    project_ref:'vrznfnxzlxaavpqbzbzd',lab_id:labId,
    scope:'isolated-shadow-rehearsal',profiles:['standard','deep'],
    sequence,decision,issued_at:'2026-11-09T19:10:00.000Z',
    expires_at:'2026-11-09T19:10:06.000Z',default_off:true,
  });
  return {
    schema_version:'reference-graph.p46-signed-lab-envelope.v1',
    payload_json,
    signature_base64:sign(null,Buffer.from(payload_json),key.privateKey).toString('base64'),
  };
}
function lab(dir){
  return createP47DurableLabRevocation({
    directory:dir,scope,publicKeyPem,publicKeySha256:keyPin,
    expectedRepositorySha:sha,expectedLabId:labId,clock:now,
  });
}
async function serverFor(dir){
  const state=lab(dir);
  const server=createServer((req,res)=>{
    if(req.method!=='GET'||req.url!=='/state'){
      res.writeHead(404).end();return;
    }
    res.setHeader('Cache-Control','no-store');
    try{
      const data=state.readSignedState();
      res.writeHead(200,{'Content-Type':'application/json'})
        .end(JSON.stringify(data));
    }catch{
      res.writeHead(503,{'Content-Type':'application/json'})
        .end('{"blocked":true}');
    }
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  return {
    server,
    endpoint:'http://127.0.0.1:'+server.address().port+'/state',
    stop:()=>new Promise(resolve=>server.close(resolve)),
  };
}
function worker(endpoint,mode='exact'){
  const processHandle=spawn(process.execPath,[
    fixture,endpoint,
    Buffer.from(publicKeyPem,'utf8').toString('base64url'),
    keyPin,sha,labId,mode,
  ],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
  let out='',err='';
  processHandle.stdout.setEncoding('utf8');
  processHandle.stderr.setEncoding('utf8');
  processHandle.stdout.on('data',chunk=>{out+=chunk;});
  processHandle.stderr.on('data',chunk=>{err+=chunk;});
  const done=new Promise((resolve,reject)=>{
    processHandle.once('error',reject);
    processHandle.once('close',code=>{
      if(code!==0)reject(new Error('P47 worker exited '+code+': '+err.slice(0,120)));
      else resolve(out.trim().split('\n'));
    });
  });
  return {processHandle,done,output:()=>out};
}

test('P47 persisted signed revocation survives fresh coordinator instance and worker restart', {timeout:15000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'p47-http-restart-'));
  let server;
  try{
    const first=lab(dir);
    first.seedLabPermit(envelope());
    server=await serverFor(dir);
    const [a,b]=await Promise.all([worker(server.endpoint).done,worker(server.endpoint).done]);
    for(const lines of [a,b]){
      const r=JSON.parse(lines.at(-1));
      assert.equal(r.outcome,'exact');
      assert.equal(r.authorized,false);
    }
    const receipt=first.revokeWithSignedState(envelope('revoked',2));
    assert.equal(receipt.lab_revoked,true);
    await server.stop();
    server=await serverFor(dir); // newly instantiated coordinator reads disk
    const after=JSON.parse((await worker(server.endpoint).done).at(-1));
    assert.equal(after.outcome,'blocked');
    assert.equal(after.latched,true);
    assert.equal(after.authorized,false);
    assert.equal(JSON.parse(lab(dir).readSignedState().payload_json).decision,'revoked');
  }finally{
    if(server)await server.stop().catch(()=>{});
    rmSync(dir,{recursive:true,force:true});
  }
});

test('P47 persisted OFF intent interrupts a separate worker already probing', {timeout:15000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'p47-http-flight-'));
  let server;
  let pending;
  try{
    const state=lab(dir);
    state.seedLabPermit(envelope());
    server=await serverFor(dir);
    pending=worker(server.endpoint,'pending');
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('P47 shadow did not start')),8000);
      const check=()=>{
        if(pending.output().includes('STARTED\n')){
          clearTimeout(timer);resolve();
        }
      };
      pending.processHandle.stdout.on('data',check);
      check();
    });
    state.revokeWithSignedState(envelope('revoked',2));
    const result=JSON.parse((await pending.done).at(-1));
    assert.equal(result.outcome,'blocked');
    assert.equal(result.latched,true);
    assert.equal(result.authorized,false);
  }finally{
    pending?.processHandle.kill();
    if(server)await server.stop().catch(()=>{});
    rmSync(dir,{recursive:true,force:true});
  }
});

test('P47 incomplete persisted revoke rejects all new OS workers after coordinator restart', {timeout:15000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'p47-http-partial-'));
  let server;
  try{
    const state=lab(dir);
    state.seedLabPermit(envelope());
    writeFileSync(join(dir,'p47-revocation-intent'),'partial',{flag:'wx'});
    server=await serverFor(dir);
    const result=JSON.parse((await worker(server.endpoint).done).at(-1));
    assert.equal(result.outcome,'blocked');
    assert.equal(result.latched,true);
    assert.equal(result.authorized,false);
  }finally{
    if(server)await server.stop().catch(()=>{});
    rmSync(dir,{recursive:true,force:true});
  }
});
