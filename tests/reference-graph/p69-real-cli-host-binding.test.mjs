import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { planP17QueryRuntime } from '../../knowledge/design-references/scripts/query-runtime.mjs';
import { runP69BoundQuery } from '../../knowledge/design-references/scripts/query-host-runtime.mjs';
import { probeP69InstalledOffHost } from '../../reference-graph/p69-installed-off-host.mjs';
import { startP68LoopbackCoordinator } from '../../reference-graph/p68-durable-https-coordinator.mjs';
import { loadRecords, loadPatterns } from '../../knowledge/design-references/scripts/lib.mjs';
import { runP11RuntimeQuery } from '../../reference-graph/p11-runtime-router.mjs';

const hostSha='477282f0eba1a848d06d928c70890fb0add784b8';
const project='vrznfnxzlxaavpqbzbzd';
const args=[
  '--profile','standard','--surface','public-home',
  '--job','creator product landing page with clear primary CTA',
  '--platform','web-responsive','--dimensions','visual-world,topology',
  '--no-record-usage',
];
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'p69-host-binding-'));
  const key=generateKeyPairSync('ed25519');
  const signPem=join(root,'public.pem');
  const certPem=join(root,'localhost.pem');
  const tlsKey=join(root,'localhost.key');
  const token=join(root,'token.txt');
  const binding=join(root,'p69-host-binding.json');
  const signerPin=createHash('sha256')
    .update(key.publicKey.export({type:'spki',format:'der'})).digest('hex');
  writeFileSync(signPem,key.publicKey.export({type:'spki',format:'pem'}).toString());
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes',
    '-keyout',tlsKey,'-out',certPem,'-days','1',
    '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],
  {stdio:'ignore',timeout:15000});
  const secret=randomBytes(32).toString('base64url');
  writeFileSync(token,secret);
  function config(endpoint,patch={}) {
    writeFileSync(binding,JSON.stringify({
      schema_version:'reference-graph.p69-off-host-binding.v1',
      project_ref:project,coordinator_commit:hostSha,endpoint,
      server_certificate_path:certPem,signer_public_key_path:signPem,
      signer_spki_sha256:signerPin,read_token_path:token,...patch,
    }));
  }
  async function server(policy={status:'off',generation:1,profiles:[],
    canary_percent:0,cohort_salt:'0'.repeat(32)}) {
    const started=await startP68LoopbackCoordinator({
      store:{readPolicy:()=>policy},
      repositorySha:hostSha,
      readToken:secret,
      tls:{key:readFileSync(tlsKey,'utf8'),cert:readFileSync(certPem,'utf8')},
      signResponse:raw=>sign(null,raw,key.privateKey).toString('base64'),
    });
    config(started.endpoint);
    return started;
  }
  return {root,binding,token,signPem,certPem,signerPin,config,server,
    close:()=>rmSync(root,{recursive:true,force:true})};
}

test('P69 selects the real bound Standard/Deep CLI only with an installed binding',async()=>{
  const f=fixture();
  try {
    const statePath=join(f.root,'missing-p17-state.json');
    const opts={statePath,env:{LOCALAPPDATA:f.root},
      argv:args,queryPath:undefined};
    const plain=await planP17QueryRuntime(opts);
    assert.equal(plain.args[0].endsWith('query.mjs'),true);
    f.config('https://127.0.0.1:32000/state');
    const std=await planP17QueryRuntime({
      ...opts,env:{AGENTHUB_P69_BINDING_FILE:f.binding},
    });
    assert.equal(std.args[0].endsWith('query-host-runtime.mjs'),true);
    assert.equal(std.env.AGENTHUB_P69_BINDING_FILE,f.binding);
    const deep=await planP17QueryRuntime({...opts,
      argv:['--profile','deep'],
      env:{AGENTHUB_P69_BINDING_FILE:f.binding},
    });
    assert.equal(deep.args[0].endsWith('query-host-runtime.mjs'),true);
    const quick=await planP17QueryRuntime({...opts,
      argv:['--profile','quick'],
      env:{AGENTHUB_P69_BINDING_FILE:f.binding,REFERENCE_GRAPH_QUICK_RUNTIME:'graph'},
    });
    assert.equal(quick.args[0].endsWith('query.mjs'),true);
    assert.equal(Object.hasOwn(quick.env,'AGENTHUB_P69_BINDING_FILE'),false);
  } finally {f.close();}
});

test('P69 real signed HTTPS OFF is validated from installed host files',async()=>{
  const f=fixture();let s;
  try{
    s=await f.server();
    const good=await probeP69InstalledOffHost({configPath:f.binding});
    assert.deepEqual(good,{connected:true,signed_off:true,graph_activation_authorized:false});
    f.config(s.endpoint,{signer_spki_sha256:'f'.repeat(64)});
    const bad=await probeP69InstalledOffHost({configPath:f.binding});
    assert.equal(bad.signed_off,false);
  }finally{await s?.close();f.close();}
});

test('P69 refuses even a validly signed LAB Canary and fails closed on host loss',async()=>{
  const f=fixture();let s;
  try{
    s=await f.server({status:'canary',generation:1,
      profiles:['standard'],canary_percent:5,cohort_salt:'a'.repeat(32)});
    assert.equal((await probeP69InstalledOffHost({configPath:f.binding})).signed_off,false);
    await s.close();s=null;
    assert.equal((await probeP69InstalledOffHost({configPath:f.binding})).signed_off,false);
  }finally{await s?.close();f.close();}
});

test('P69 real query-runtime runs the bound host, retains Legacy public JSON and exit code',async()=>{
  const f=fixture();let s;
  try{
    s=await f.server();
    const executable=process.execPath;
    const main='knowledge/design-references/scripts/query-runtime.mjs';
    const old='knowledge/design-references/scripts/query.mjs';
    const baseline=spawnSync(executable,[old,...args],{encoding:'utf8',timeout:15000});
    // The P68 TLS test server runs in this process. The query client must
    // be spawned asynchronously so this event loop can answer the real GET.
    const current=await new Promise((resolveChild,rejectChild)=>{
      const child=spawn(executable,[main,...args],{
        env:{...process.env,AGENTHUB_P69_BINDING_FILE:f.binding,
          AGENTHUB_P69_DIAGNOSTICS:'1',REFERENCE_GRAPH_QUICK_RUNTIME:'graph'},
        stdio:['ignore','pipe','pipe'],
      });
      let stdout='',stderr='';
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data',x=>{stdout+=x;});
      child.stderr.on('data',x=>{stderr+=x;});
      child.once('error',rejectChild);
      child.once('close',status=>resolveChild({status,stdout,stderr}));
    });
    assert.equal(current.status,baseline.status);
    assert.equal(current.stdout,baseline.stdout);
    assert.match(current.stderr,/P69_REAL_CLI_P68_SIGNED_OFF_CONNECTED/);
    assert.equal(current.stderr.includes('sb_secret'),false);
  }finally{await s?.close();f.close();}
});

test('P69 fail-closed binding retains once-only usage and authentic JSON',async()=>{
  const f=fixture();
  try{
    let queries=0, usage=0, stdout='',stderr='';
    const records=loadRecords(), patterns=loadPatterns();
    const result=await runP69BoundQuery({
      argv:args.filter(arg=>arg!=='--no-record-usage'),
      env:{AGENTHUB_P69_BINDING_FILE:f.binding,AGENTHUB_P69_DIAGNOSTICS:'1'},
      records,patterns,stdout:{write:s=>{stdout+=s;}},
      stderr:{write:s=>{stderr+=s;}},
      probe:async()=>({connected:false,signed_off:false,graph_activation_authorized:false}),
      query:async input=>{
        queries++;
        return runP11RuntimeQuery({...input,recordUsageFn:()=>{usage++;}});
      },
    });
    assert.equal(result.signed_off,false);
    assert.equal(queries,1);
    assert.equal(usage,1);
    assert.match(stderr,/UNAVAILABLE_OR_NOT_OFF_LEGACY/);
    assert.equal(JSON.parse(stdout).profile,'standard');
  }finally{f.close();}
});

test('P69 code cannot enable Graph, mutate production, or intercept Quick',()=>{
  const module=readFileSync('reference-graph/p69-installed-off-host.mjs','utf8');
  const bridge=readFileSync('knowledge/design-references/scripts/query-host-runtime.mjs','utf8');
  assert.doesNotMatch(module,/fetchP30ProfileCandidateSnapshot|serviceKey|sb_secret/);
  assert.match(bridge,/graphMode:'legacy'/);
  assert.doesNotMatch(bridge,/graphMode:'graph'|createP68TrustedServerHost/);
  assert.match(bridge,/Standard\/Deep only/);
});
