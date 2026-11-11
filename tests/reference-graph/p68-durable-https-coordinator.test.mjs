import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { loadRecords, loadPatterns } from '../../knowledge/design-references/scripts/lib.mjs';
import { buildP28OfflineProfileCandidatePool } from '../../reference-graph/p28-profile-candidate-contract.mjs';
import { createP68DurableCoordinatorStore, startP68LoopbackCoordinator }
  from '../../reference-graph/p68-durable-https-coordinator.mjs';
import { createP68TrustedServerHost } from '../../reference-graph/p68-server-host.mjs';
import { planP68LocalOperator, runP68LocalOperator } from '../../reference-graph/cli/p68-run-local-coordinator.mjs';

const sha='5ac18272df42234b7fc9df8ab625391e860c4e26';
const now=new Date('2026-11-11T08:41:00.000Z');
const repo='vrznfnxzlxaavpqbzbzd';
const hash=value=>createHash('sha256').update(value).digest('hex');
const owner=generateKeyPairSync('ed25519');
const signer=generateKeyPairSync('ed25519');
const ownerPem=owner.publicKey.export({type:'spki',format:'pem'}).toString();
const ownerPin=hash(owner.publicKey.export({type:'spki',format:'der'}));
const signingPem=signer.publicKey.export({type:'spki',format:'pem'}).toString();
const signingPin=hash(signer.publicKey.export({type:'spki',format:'der'}));
const salt='ab'.repeat(16);
const token=()=>randomBytes(32).toString('base64url');
const fixture=fileURLToPath(new URL('./fixtures/p68-https-worker.mjs',import.meta.url));

function grant(patch={}) {
  const payload_json=JSON.stringify({
    schema_version:'reference-graph.p68-owner-canary-grant.v1',
    repository_sha:sha,project_ref:repo,
    mode:'isolated-integration-canary',
    profiles:['standard','deep'],canary_percent:5,cohort_salt:salt,
    generation:1,issued_at:'2026-11-11T08:40:00.000Z',
    expires_at:'2026-11-11T08:45:00.000Z',
    default_off:true,production_route_wiring:false,...patch,
  });
  return {payload_json,
    signature_base64:sign(null,Buffer.from(payload_json),owner.privateKey).toString('base64')};
}
function store(dir) {
  return createP68DurableCoordinatorStore({
    directory:dir,repositorySha:sha,ownerPublicKeyPem:ownerPem,
    ownerPublicKeySha256:ownerPin,clock:()=>now,
  });
}
function certs(dir) {
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes',
    '-keyout',join(dir,'tls.key'),'-out',join(dir,'tls.pem'),'-days','1',
    '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],
    {stdio:'ignore',timeout:15000});
  return {
    key:readFileSync(join(dir,'tls.key'),'utf8'),
    cert:readFileSync(join(dir,'tls.pem'),'utf8'),
  };
}
function httpsResponse(endpoint,tls,options={}) {
  return new Promise((resolve,reject)=>{
    const url=new URL(endpoint);
    const req=httpsRequest({
      hostname:url.hostname,port:url.port,path:url.pathname,
      method:options.method||'GET',headers:options.headers||{},
      ca:tls.cert,rejectUnauthorized:true,servername:'localhost',
      agent:false,
    },response=>{
      let body='';
      response.setEncoding('utf8');
      response.on('data',chunk=>{body+=chunk;});
      response.on('end',()=>resolve({
        status:response.statusCode,ok:response.statusCode===200,
        body,text:async()=>body,
      }));
    });
    req.once('error',reject);
    if (options.signal) {
      if (options.signal.aborted) req.destroy(Error('aborted'));
      else options.signal.addEventListener('abort',
        ()=>req.destroy(Error('aborted')),{once:true});
    }
    req.end();
  });
}
async function init({seed=true}={}) {
  const dir=mkdtempSync(join(tmpdir(),'p68-durable-'));
  const tls=certs(dir), stateDir=join(dir,'state');
  const {mkdirSync}=await import('node:fs');
  mkdirSync(stateDir, {mode:0o700});
  const s=store(stateDir);
  if(seed) s.seedSignedLabCanary(grant());
  const bearer=token();
  const server=await startP68LoopbackCoordinator({
    store:s,repositorySha:sha,readToken:bearer,tls,
    signResponse:bytes=>sign(null,bytes,signer.privateKey).toString('base64'),
    clock:()=>now,
  });
  const fetchImpl=async(url,opts)=>httpsResponse(url,tls,opts);
  return {dir,stateDir,state:s,tls,bearer,server,fetchImpl,
    close:async()=>{await server.close();rmSync(dir,{recursive:true,force:true});}};
}
function worker(env) {
  const publicFile=join(env.dir,'p68-signing-public.pem');
  writeFileSync(publicFile,signingPem);
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[
      fixture,env.server.endpoint,join(env.dir,'tls.pem'),
      publicFile,signingPin,sha,now.toISOString(),
    ],{cwd:process.cwd(),stdio:['ignore','pipe','pipe'],
      env:{...process.env,P68_TEST_READ_TOKEN:env.bearer}});
    let out='',err='';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data',s=>{out+=s;});
    child.stderr.on('data',s=>{err+=s;});
    child.once('error',reject);
    child.once('close',code=>code===0
      ? resolve(JSON.parse(out.trim()))
      : reject(Error('P68 worker error: '+err.slice(0,160))));
  });
}
function eligibleKey() {
  for(let i=0;i<10000;i++) {
    const k='p68-approved-worker-'+String(i).padStart(5,'0');
    const h=createHmac('sha256',Buffer.from(salt,'hex')).update(k).digest();
    if(h.readUInt32BE(0)/0x100000000<0.05)return k;
  }
  throw Error('No 5% key');
}
const records=loadRecords(),patterns=loadPatterns();
const candidates=buildP28OfflineProfileCandidatePool({
  records,now:new Date('2026-11-11T00:00:00.000Z'),
});
const idSha=hash(candidates.map(c=>c.legacy_id).sort().join('\n'));
const witness=JSON.stringify({
  schema_version:'reference-graph.p40-readonly-source-witness.v1',
  source_method:'p7-vs-p31-read-only',project_ref:repo,
  projection_version:'reference-graph.profile-runtime.p30.v1',
  snapshot_date:'2026-11-11',refreshed_at:'2026-11-11T08:40:00.000Z',
  observed_at:'2026-11-11T08:40:30.000Z',
  expected_candidate_count:candidates.length,
  expected_candidate_id_set_sha256:idSha,
  published_candidate_count:candidates.length,
  published_candidate_id_set_sha256:idSha,
  membership_mismatch_count:0,metadata_mismatch_count:0,
  refresh_instant_count:1,activation_authorized:false,
  repository_default_graph_enabled:false,
});
const request={profile:'standard',limit:12,surface:'public-home',
  platform:'web-responsive',
  job:'creator product landing page with clear primary CTA',
  dimensions:'visual-world,topology'};
function host(env,patch={}) {
  let gets=0,usage=0;
  const h=createP68TrustedServerHost({
    repositorySha:sha,
    trustedPublicKeyPem:signingPem,trustedPublicKeySha256:signingPin,
    stateEndpoint:env.server.endpoint,stateReadToken:env.bearer,
    stateFetchImpl:env.fetchImpl,clock:()=>now,
    getWitness:async()=>({json:witness,sha256:hash(witness)}),
    serviceKey:'sb_secret_test_only_p68',
    fetchCandidates:async options=>{
      gets++;
      assert.equal(options.accessMode,'server');
      return {candidates,transport:{refreshed_at:'2026-11-11T08:40:00.000Z'}};
    },
    statePollMs:50,...patch,
  });
  return {h,run:()=>h.run({records,patterns,request,requestKey:eligibleKey(),now,
    recordUsageEnabled:true,recordUsageFn:()=>{usage++;}}),
    get gets(){return gets;},get usage(){return usage;}};
}

test('P68 starts OFF, rejects invalid owner approval, binds only localhost',async()=>{
  const env=await init({seed:false});
  try {
    assert.equal(env.state.readPolicy().status,'off');
    assert.equal((await worker(env)).status,'off');
    const wrong={...grant(),signature_base64:'A'.repeat(86)+'=='};
    assert.throws(()=>env.state.seedSignedLabCanary(wrong),/BLOCKED/);
    assert.throws(()=>env.state.seedSignedLabCanary(grant({
      production_route_wiring:true,
    })),/BLOCKED/);
    assert.throws(()=>env.state.seedSignedLabCanary(grant({
      repository_sha:'f'.repeat(40),
    })),/BLOCKED/);
    await assert.rejects(startP68LoopbackCoordinator({
      store:env.state,repositorySha:sha,readToken:env.bearer,
      tls:env.tls,signResponse:()=>'',host:'0.0.0.0',
    }),/loopback setup/);
  }finally{await env.close();}
});

test('P68 real TLS coordinator, 2 separate OS workers and durable OFF survive restart', {timeout:30000},async()=>{
  const env=await init();
  try {
    assert.equal(env.state.readPolicy().status,'canary');
    const [a,b]=await Promise.all([worker(env),worker(env)]);
    assert.deepEqual([a.status,b.status],['canary','canary']);
    assert.equal(a.generation,1);assert.equal(b.generation,1);
    env.state.revokePermanently();
    assert.equal(env.state.readPolicy().status,'off');
    const [x,y]=await Promise.all([worker(env),worker(env)]);
    assert.equal(x.status,'off');assert.equal(y.status,'off');
    assert.equal(x.generation,2);
    assert.throws(()=>env.state.seedSignedLabCanary(grant()),/BLOCKED/);
    assert.equal(store(env.stateDir).readPolicy().status,'off');
    await env.server.close();
    env.server=await startP68LoopbackCoordinator({
      store:store(env.stateDir),repositorySha:sha,
      readToken:env.bearer,tls:env.tls,
      signResponse:bytes=>sign(null,bytes,signer.privateKey).toString('base64'),
      clock:()=>now,
    });
    assert.equal((await worker(env)).status,'off');
    await env.server.close();
  }finally{await env.close();}
});

test('P68 authenticated GET rejects invalid bearer, missing nonce and mutations',async()=>{
  const env=await init();
  try {
    const good=await httpsResponse(env.server.endpoint,env.tls,{
      headers:{Authorization:'Bearer '+env.bearer,'X-P67-Nonce':'a'.repeat(32)},
    });
    assert.equal(good.status,200);
    for(const [method,headers,status] of [
      ['GET',{},403],
      ['GET',{Authorization:'Bearer '+token(),'X-P67-Nonce':'a'.repeat(32)},403],
      ['GET',{Authorization:'Bearer '+env.bearer},400],
      ['GET',{Authorization:'Bearer '+env.bearer,'X-P67-Nonce':'wrong'},400],
      ['POST',{Authorization:'Bearer '+env.bearer,'X-P67-Nonce':'a'.repeat(32)},405],
    ]) {
      const response=await httpsResponse(env.server.endpoint,env.tls,{method,headers});
      assert.equal(response.status,status);
      assert.equal(response.body.includes(env.bearer),false);
    }
  }finally{await env.close();}
});

test('P68 trusted host obtains actual selected Graph public output and switches to Legacy after shared revoke',async()=>{
  const env=await init();
  try{
    const a=host(env),b=host(env);
    const [first,second]=await Promise.all([a.run(),b.run()]);
    assert.equal(first.routing.authoritative_source,'reference-graph');
    assert.equal(second.routing.authoritative_source,'reference-graph');
    assert.equal(a.gets,1);assert.equal(b.gets,1);
    assert.equal(a.usage,1);assert.equal(b.usage,1);
    env.state.revokePermanently();
    const [afterOne,afterTwo]=await Promise.all([a.run(),b.run()]);
    assert.equal(afterOne.routing.authoritative_source,'legacy-control');
    assert.equal(afterTwo.routing.authoritative_source,'legacy-control');
    assert.equal(a.gets,1);assert.equal(b.gets,1);
    assert.equal(a.usage,2);assert.equal(b.usage,2);
    const fresh=host(env);
    assert.equal((await fresh.run()).routing.authoritative_source,'legacy-control');
    assert.equal(fresh.gets,0);
  }finally{await env.close();}
});

test('P68 corrupted persisted grant fails closed; OFF intent overrides corrupted file',async()=>{
  const env=await init();
  try{
    writeFileSync(join(env.stateDir,'p68-owner-approved-canary.json'),
      '{"invalid":true}');
    await assert.rejects(worker(env),/P67 state HTTP failed|P68 worker error/);
    env.state.revokePermanently();
    assert.equal(env.state.readPolicy().status,'off');
    assert.equal((await worker(env)).status,'off');
  }finally{await env.close();}
});

test('P68 disconnection during still-valid canary fails closed to Legacy',async()=>{
  const env=await init();
  try{
    const a=host(env);
    await env.server.close();
    const result=await a.run();
    assert.equal(result.routing.authoritative_source,'legacy-control');
    assert.equal(result.canary.local_kill_switch_latched,true);
    assert.equal(a.gets,0);
  }finally{
    // close is idempotent on server handle
    await env.close();
  }
});

test('P68 runnable local operator has a strict private manifest and starts OFF',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'p68-local-operator-'));
  let launched;
  try {
    const tls=certs(dir), stateDir=join(dir,'state');
    const {mkdirSync}=await import('node:fs');
    mkdirSync(stateDir,{mode:0o700});
    const ownerFile=join(dir,'owner-public.pem');
    const signerFile=join(dir,'response-signer-private.pem');
    const manifest=join(dir,'local-operator.json');
    writeFileSync(ownerFile,ownerPem);
    writeFileSync(signerFile,signer.privateKey.export({
      type:'pkcs8',format:'pem',
    }),{mode:0o600});
    writeFileSync(manifest,JSON.stringify({
      schema_version:'reference-graph.p68-lab-operator.v1',
      scope:{mode:'isolated-integration-canary',
        default_off:true,production_route_wiring:false},
      state_directory:stateDir,repository_sha:sha,
      owner_public_key_path:ownerFile,owner_public_key_sha256:ownerPin,
      response_signer_private_key_path:signerFile,
      tls_private_key_path:join(dir,'tls.key'),
      tls_certificate_path:join(dir,'tls.pem'),
    }));
    const localEnv={P68_ALLOW_LOCAL_OPERATOR:'1',
      P68_LAB_READ_TOKEN:token()};
    assert.throws(()=>planP68LocalOperator({
      argv:['--manifest',manifest],env:{},
    }),/BLOCKED/);
    const plan=planP68LocalOperator({
      argv:['--manifest',manifest],env:localEnv,clock:()=>now,
    });
    assert.equal(plan.store.readPolicy().status,'off');
    let output='';
    launched=await runP68LocalOperator({
      argv:['--manifest',manifest],env:localEnv,clock:()=>now,
      stdout:{write:s=>{output+=s;}},
    });
    assert.equal(JSON.parse(output.trim()).current_mode,'off');
    const result=await httpsResponse(launched.endpoint,tls,{
      headers:{Authorization:'Bearer '+localEnv.P68_LAB_READ_TOKEN,
        'X-P67-Nonce':'b'.repeat(32)},
    });
    assert.equal(result.status,200);
    assert.equal(JSON.parse(JSON.parse(result.body).payload_json).status,'off');
  } finally {
    if(launched) await launched.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
