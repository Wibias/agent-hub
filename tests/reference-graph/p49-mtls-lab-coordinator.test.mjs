import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, sign, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createP47DurableLabRevocation } from '../../reference-graph/p47-durable-lab-revocation.mjs';
import {
  startP49MtlsLabCoordinator, readP49MtlsSignedState,
} from '../../reference-graph/p49-mtls-lab-coordinator.mjs';

const repoSha='83a3794cc54d2f2d129b83e8e672e18b35f11cff';
const labId='p49-mutual-tls-lab-20261109';
const signer=generateKeyPairSync('ed25519');
const publicPem=signer.publicKey.export({type:'spki',format:'pem'});
const signerPin=createHash('sha256')
  .update(signer.publicKey.export({type:'spki',format:'der'})).digest('hex');
const scope={mode:'isolated-shadow-rehearsal',default_off:true,
  production_route_wiring:false,profiles:['standard','deep']};
const now=()=>new Date('2026-11-09T19:10:02.000Z');
const workerPath=fileURLToPath(new URL('./fixtures/p49-mtls-lab-worker.mjs',import.meta.url));

function runOpenSSL(args, cwd) {
  execFileSync('openssl',args,{cwd,stdio:'ignore',timeout:12000});
}
function issue(dir,label,cn,eku) {
  runOpenSSL(['req','-new','-newkey','rsa:2048','-nodes',
    '-keyout',label+'.key','-out',label+'.csr',
    '-subj','/CN='+cn],dir);
  writeFileSync(join(dir,label+'.ext'),
    'subjectAltName=DNS:'+cn+'\nextendedKeyUsage='+eku+'\n');
  runOpenSSL(['x509','-req','-in',label+'.csr','-CA','ca.pem',
    '-CAkey','ca.key','-CAcreateserial','-out',label+'.pem',
    '-days','1','-sha256','-extfile',label+'.ext'],dir);
}
function certs(dir) {
  runOpenSSL(['req','-x509','-newkey','rsa:2048','-nodes',
    '-keyout','ca.key','-out','ca.pem','-days','1',
    '-subj','/CN=P49 Isolated Lab CA'],dir);
  issue(dir,'server','p49-coordinator.lab','serverAuth');
  issue(dir,'client','p49-client.lab','clientAuth');
  issue(dir,'other','p49-other.lab','clientAuth');
  return {
    ca:readFileSync(join(dir,'ca.pem'),'utf8'),
    serverCert:readFileSync(join(dir,'server.pem'),'utf8'),
    serverKey:readFileSync(join(dir,'server.key'),'utf8'),
    clientCert:readFileSync(join(dir,'client.pem'),'utf8'),
    clientKey:readFileSync(join(dir,'client.key'),'utf8'),
    otherCert:readFileSync(join(dir,'other.pem'),'utf8'),
    otherKey:readFileSync(join(dir,'other.key'),'utf8'),
    serverPin:createHash('sha256').update(new X509Certificate(
      readFileSync(join(dir,'server.pem'),'utf8')).raw).digest('hex'),
    clientPin:createHash('sha256').update(new X509Certificate(
      readFileSync(join(dir,'client.pem'),'utf8')).raw).digest('hex'),
  };
}
function envelope(decision='shadow-probe-only',sequence=1) {
  const payload_json=JSON.stringify({
    schema_version:'reference-graph.p46-lab-lease.v1',
    repository:'Wibias/agent-hub',repository_sha:repoSha,
    project_ref:'vrznfnxzlxaavpqbzbzd',lab_id:labId,
    scope:'isolated-shadow-rehearsal',
    profiles:['standard','deep'],sequence,decision,
    issued_at:'2026-11-09T19:10:00.000Z',
    expires_at:'2026-11-09T19:10:06.000Z',default_off:true,
  });
  return {
    schema_version:'reference-graph.p46-signed-lab-envelope.v1',
    payload_json,signature_base64:sign(null,Buffer.from(payload_json),
      signer.privateKey).toString('base64'),
  };
}
function persisted(dir) {
  const state=createP47DurableLabRevocation({
    directory:dir,scope,publicKeyPem,publicKeySha256:signerPin,
    expectedRepositorySha:repoSha,expectedLabId:labId,clock:now,
  });
  state.seedLabPermit(envelope());
  return state;
}
function tlsArgs(cert,port,override={}) {
  return {
    host:'127.0.0.1',port,servername:'p49-coordinator.lab',
    ca:cert.ca,clientCert:cert.clientCert,clientKey:cert.clientKey,
    serverCertSha256:cert.serverPin,timeoutMs:1000,...override,
  };
}
function childWorker(dir,port,pin) {
  const pem=join(dir,'p49-lab-state-pub.pem');
  writeFileSync(pem,publicPem);
  const child=spawn(process.execPath,[
    workerPath,String(port),dir,pin,pem,signerPin,repoSha,labId,
  ],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data',x=>{stdout+=x;});
  child.stderr.on('data',x=>{stderr+=x;});
  return new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('close',code=>{
      if(code!==0) reject(new Error('P49 worker exited '+code+': '+stderr.slice(0,100)));
      else resolve(JSON.parse(stdout.trim()));
    });
  });
}

test('P49 rejects non-isolated public bind or invalid TLS options before start',async()=>{
  await assert.rejects(startP49MtlsLabCoordinator({
    store:{readSignedState:()=>envelope()},
    tls:{key:'x',cert:'x',ca:'x'},
    clientCertSha256:'a'.repeat(64),host:'0.0.0.0',
  }),/scoped mTLS/);
});

test('P49 authenticates TLS 1.3 mutual peer certificate, SAN, exact pins', {timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'p49-mtls-'));
  let server;
  try {
    const cert=certs(dir),state=persisted(dir);
    server=await startP49MtlsLabCoordinator({
      store:state,tls:{key:cert.serverKey,cert:cert.serverCert,ca:cert.ca},
      clientCertSha256:cert.clientPin,
    });
    assert.equal(server.host,'127.0.0.1');
    assert.equal(server.activation_authorized,false);
    assert.deepEqual(await readP49MtlsSignedState(tlsArgs(cert,server.port)),envelope());
    for(const overrides of [
      {serverCertSha256:'0'.repeat(64)},
      {servername:'incorrect-host.lab'},
      {clientCert:cert.otherCert,clientKey:cert.otherKey},
      {clientCert:'',clientKey:''},
      {ca:cert.otherCert},
    ]) {
      await assert.rejects(readP49MtlsSignedState(
        tlsArgs(cert,server.port,overrides)),/BLOCKED/);
    }
  } finally {
    if(server)await server.close();
    rmSync(dir,{recursive:true,force:true});
  }
});

test('P49 separate OS worker validates signed P46 permit then sees durable revoke', {timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'p49-mtls-worker-'));
  let server;
  try{
    const cert=certs(dir),state=persisted(dir);
    server=await startP49MtlsLabCoordinator({
      store:state,tls:{key:cert.serverKey,cert:cert.serverCert,ca:cert.ca},
      clientCertSha256:cert.clientPin,
    });
    const [a,b]=await Promise.all([
      childWorker(dir,server.port,cert.serverPin),
      childWorker(dir,server.port,cert.serverPin),
    ]);
    assert.equal(a.outcome,'eligible-lab-only');
    assert.equal(b.outcome,'eligible-lab-only');
    assert.equal(a.activation_authorized,false);
    state.revokeWithSignedState(envelope('revoked',2));
    const blocked=await childWorker(dir,server.port,cert.serverPin);
    assert.equal(blocked.outcome,'blocked');
    assert.equal(blocked.activation_authorized,false);
    await server.close();server=null;
    await assert.rejects(readP49MtlsSignedState(tlsArgs(cert,65432)),/BLOCKED/);
  }finally{
    if(server)await server.close();
    rmSync(dir,{recursive:true,force:true});
  }
});

test('P49 refuses partial OFF journal and all mutation attempts', {timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'p49-mtls-partial-'));
  let server;
  try{
    const cert=certs(dir),state=persisted(dir);
    server=await startP49MtlsLabCoordinator({
      store:state,tls:{key:cert.serverKey,cert:cert.serverCert,ca:cert.ca},
      clientCertSha256:cert.clientPin,
    });
    writeFileSync(join(dir,'p47-revocation-intent'),'partial',{flag:'wx'});
    await assert.rejects(readP49MtlsSignedState(tlsArgs(cert,server.port)),/BLOCKED/);
    assert.equal(server.production_coordinator_deployed,false);
  }finally{
    if(server)await server.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
