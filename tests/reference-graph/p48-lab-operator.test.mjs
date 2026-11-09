import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createP47DurableLabRevocation } from '../../reference-graph/p47-durable-lab-revocation.mjs';
import { planP48LabOperator } from '../../reference-graph/cli/p48-run-lab-coordinator.mjs';

const repoSha = '83a3794cc54d2f2d129b83e8e672e18b35f11cff';
const labId = 'p48-separate-daemon-20261109';
const pair = generateKeyPairSync('ed25519');
const publicKeyPem = pair.publicKey.export({ type:'spki', format:'pem' });
const keyPin = createHash('sha256')
  .update(pair.publicKey.export({ type:'spki', format:'der' })).digest('hex');
const scope = {
  mode: 'isolated-shadow-rehearsal', profiles:['standard','deep'],
  default_off:true, production_route_wiring:false,
};
const script = fileURLToPath(new URL('../../reference-graph/cli/p48-run-lab-coordinator.mjs',import.meta.url));
const token = () => randomBytes(32).toString('base64url');
function envelope(decision, seq, issued) {
  const payload_json = JSON.stringify({
    schema_version: 'reference-graph.p46-lab-lease.v1',
    repository: 'Wibias/agent-hub', repository_sha: repoSha,
    project_ref: 'vrznfnxzlxaavpqbzbzd', lab_id: labId,
    scope: 'isolated-shadow-rehearsal', profiles:['standard','deep'],
    sequence:seq,decision,
    issued_at:new Date(issued).toISOString(),
    expires_at:new Date(issued + 9500).toISOString(),
    default_off:true,
  });
  return {
    schema_version: 'reference-graph.p46-signed-lab-envelope.v1',
    payload_json,
    signature_base64: sign(null,Buffer.from(payload_json),pair.privateKey).toString('base64'),
  };
}
function config(dir) {
  const pemPath=join(dir,'trusted-pub.pem');
  const manifest=join(dir,'lab-manifest.json');
  writeFileSync(pemPath,publicKeyPem);
  writeFileSync(manifest,JSON.stringify({
    schema_version:'reference-graph.p48-lab-operator-config.v1',
    scope,directory:dir,public_key_path:pemPath,
    public_key_sha256:keyPin,repository_sha:repoSha,lab_id:labId,
  }));
  return { manifest, pemPath };
}
function store(dir) {
  return createP47DurableLabRevocation({
    directory:dir,scope,publicKeyPem,publicKeySha256:keyPin,
    expectedRepositorySha:repoSha,expectedLabId:labId,
  });
}
function daemon(manifest,bearer) {
  const child=spawn(process.execPath,[script,'--manifest',manifest],{
    cwd:process.cwd(), stdio:['ignore','pipe','pipe'],
    env:{...process.env,P48_LAB_READ_TOKEN:bearer},
  });
  let out='',err='';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data',x=>{out+=x;});
  child.stderr.on('data',x=>{err+=x;});
  const ready=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('P48 daemon did not start')),5000);
    const check=()=>{
      const first=out.split('\n')[0];
      if(first.trim().startsWith('{')){
        clearTimeout(timeout);
        try{resolve(JSON.parse(first));}catch(e){reject(e);}
      }
    };
    child.stdout.on('data',check);
    child.once('exit',code=>{
      if(!out.includes('endpoint')) {
        clearTimeout(timeout);
        reject(new Error('P48 daemon exited before listening: '+code));
      }
    });
    check();
  });
  const stopped=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',code=>resolve({code,output:out,stderr:err}));
  });
  return {child,ready,stopped};
}
async function stop(d) {
  if (!d) return;
  if (d.child.exitCode === null) d.child.kill('SIGTERM');
  return d.stopped;
}

test('P48 separate daemon input validator rejects insecure scope and malformed source files',()=>{
  const dir=mkdtempSync(join(tmpdir(),'p48-operator-contract-'));
  try {
    const {manifest,pemPath}=config(dir);
    const env={P48_LAB_READ_TOKEN:token()};
    const valid=planP48LabOperator({argv:['--manifest',manifest],env});
    assert.equal(valid.host,'127.0.0.1');
    assert.equal(valid.port,0);
    assert.equal(valid.readBearerToken,env.P48_LAB_READ_TOKEN);
    const wrongScope=JSON.parse(readFileSync(manifest,'utf8'));
    wrongScope.scope.production_route_wiring=true;
    writeFileSync(manifest,JSON.stringify(wrongScope));
    assert.throws(()=>planP48LabOperator({
      argv:['--manifest',manifest],env,
    }),/BLOCKED/);
    writeFileSync(manifest,'{}');
    assert.throws(()=>planP48LabOperator({
      argv:['--manifest',manifest],env,
    }),/BLOCKED/);
    assert.throws(()=>planP48LabOperator({
      argv:['--manifest',manifest],env:{P48_LAB_READ_TOKEN:'weak'},
    }),/BLOCKED/);
    assert.equal(readFileSync(pemPath,'utf8'),publicKeyPem);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('P48 separate OS daemon requires token, reads persisted signed revocation and survives restart', {timeout:18000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'p48-daemon-e2e-'));
  let first, second;
  try {
    const {manifest}=config(dir);
    const state=store(dir);
    const issued=Date.now()-150;
    state.seedLabPermit(envelope('shadow-probe-only',1,issued));
    const bearer=token();
    first=daemon(manifest,bearer);
    const ready=await first.ready;
    assert.equal(ready.activation_authorized,false);
    assert.equal(ready.repository_default_graph_enabled,false);
    const endpoint=ready.endpoint;
    assert.ok(endpoint.startsWith('http://127.0.0.1:'));
    const valid=await fetch(endpoint,{headers:{Authorization:'Bearer '+bearer}});
    assert.equal(valid.status,200);
    assert.equal(JSON.parse((await valid.json()).payload_json).decision,'shadow-probe-only');
    const noAuth=await fetch(endpoint);
    assert.equal(noAuth.status,403);
    state.revokeWithSignedState(envelope('revoked',2,issued));
    const denied=await fetch(endpoint,{headers:{Authorization:'Bearer '+bearer}});
    assert.equal(denied.status,200);
    assert.equal(JSON.parse((await denied.json()).payload_json).decision,'revoked');
    const initialExit=await stop(first);
    assert.equal(initialExit.code,0);
    assert.equal(initialExit.output.includes(bearer), false);
    assert.equal(initialExit.stderr.includes(bearer), false);
    second=daemon(manifest,bearer);
    const after=await second.ready;
    const result=await fetch(after.endpoint,{headers:{Authorization:'Bearer '+bearer}});
    assert.equal(JSON.parse((await result.json()).payload_json).decision,'revoked');
  }finally{
    await stop(first);
    await stop(second);
    rmSync(dir,{recursive:true,force:true});
  }
});

test('P48 missing or partially persisted OFF state prevents separate daemon from listening', {timeout:15000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'p48-daemon-partial-'));
  let d;
  try{
    const {manifest}=config(dir);
    d=daemon(manifest,token());
    await assert.rejects(d.ready, /exited before listening/);
    const failed=await d.stopped;
    assert.equal(failed.code,2);
    assert.doesNotMatch(failed.output,/endpoint/);
    assert.match(failed.stderr,/BLOCKED/);
    const state=store(dir);
    const issued=Date.now()-100;
    state.seedLabPermit(envelope('shadow-probe-only',1,issued));
    writeFileSync(join(dir,'p47-revocation-intent'),'incomplete',{flag:'wx'});
    d=daemon(manifest,token());
    await assert.rejects(d.ready, /exited before listening/);
    const after=await d.stopped;
    assert.equal(after.code,2);
    assert.doesNotMatch(after.output,/endpoint/);
  }finally{
    await stop(d);
    rmSync(dir,{recursive:true,force:true});
  }
});
