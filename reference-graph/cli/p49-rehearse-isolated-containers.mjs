#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  createHash, generateKeyPairSync, randomBytes, sign, X509Certificate,
} from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createP47DurableLabRevocation } from '../p47-durable-lab-revocation.mjs';

const IMAGE = 'node:24-alpine'; // CI-only fixture image, not a production image
const LAB = 'p49-isolated-container-rehearsal';
const FIXED = new Date('2026-11-09T19:10:02.000Z');
const SCOPE = Object.freeze({
  mode:'isolated-shadow-rehearsal',
  default_off:true, production_route_wiring:false,
  profiles:['standard','deep'],
});

function cmd(command,args,timeout=30000) {
  return execFileSync(command,args,{
    encoding:'utf8',timeout,stdio:['ignore','pipe','pipe'],
    maxBuffer:512*1024,
  }).trim();
}
function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
function openssl(dir,args) {
  cmd('openssl',args,12000);
}
function issue(dir,name,cn,purpose) {
  openssl(dir,[
    'req','-new','-newkey','rsa:2048','-nodes',
    '-keyout',join(dir,name+'.key'),'-out',join(dir,name+'.csr'),
    '-subj','/CN='+cn,
  ]);
  const ext=join(dir,name+'.ext');
  writeFileSync(ext,'subjectAltName=DNS:'+cn+'\nextendedKeyUsage='+purpose+'\n');
  openssl(dir,[
    'x509','-req','-in',join(dir,name+'.csr'),
    '-CA',join(dir,'ca.pem'),'-CAkey',join(dir,'ca.key'),
    '-CAcreateserial','-out',join(dir,name+'.pem'),
    '-days','1','-sha256','-extfile',ext,
  ]);
}
function makeCertificates(dir) {
  openssl(dir,[
    'req','-x509','-newkey','rsa:2048','-nodes',
    '-keyout',join(dir,'ca.key'),'-out',join(dir,'ca.pem'),
    '-days','1','-subj','/CN=P49 Disposable Container CA',
  ]);
  issue(dir,'server','p49-coordinator.lab','serverAuth');
  issue(dir,'client','p49-client.lab','clientAuth');
  issue(dir,'other','p49-other.lab','clientAuth');
}
function bind(src,dest) {
  return ['--mount','type=bind,src='+src+',dst='+dest+',readonly'];
}
function docker(args,timeout=30000) {
  return cmd('docker',args,timeout);
}
function workerArgs({name,network,checkout,root,phase='once',other=false}) {
  return [
    'run','--rm','--name',name,'--network',network,
    '--read-only','--cap-drop=ALL',
    '--security-opt','no-new-privileges:true',
    '--memory','192m','--pids-limit','96',
    '-e','P49_DOCKER_REHEARSAL=1',
    '-e','P49_LAB_PHASE='+phase,
    ...bind(checkout,'/repo'),
    ...bind(join(root,'ca.pem'),'/lab/ca.pem'),
    ...bind(join(root,'verify'),'/lab/verify'),
    ...bind(join(root,other?'other':'client'),'/lab/client'),
    IMAGE,'node','/repo/reference-graph/cli/p49-container-lab-worker.mjs',
  ];
}
function waitForServer(name) {
  for(let i=0;i<55;i++) {
    const log=docker(['logs',name],4000);
    if(log.includes('P49_SERVER_READY'))return;
    const state=docker(['inspect','--format','{{.State.Running}}',name],4000);
    if(state!=='true')throw Error('isolated P49 server exited');
    cmd('sleep',['0.1'],1000);
  }
  throw Error('isolated P49 TLS server startup timeout');
}
function signed(privateKey,repoSha,decision,sequence) {
  const payload_json=JSON.stringify({
    schema_version:'reference-graph.p46-lab-lease.v1',
    repository:'Wibias/agent-hub',
    repository_sha:repoSha,project_ref:'vrznfnxzlxaavpqbzbzd',
    lab_id:LAB,scope:'isolated-shadow-rehearsal',
    profiles:['standard','deep'],sequence,decision,
    issued_at:'2026-11-09T19:10:00.000Z',
    expires_at:'2026-11-09T19:10:09.000Z',default_off:true,
  });
  return {
    schema_version:'reference-graph.p46-signed-lab-envelope.v1',
    payload_json,
    signature_base64:sign(null,Buffer.from(payload_json),privateKey).toString('base64'),
  };
}
function validReport(lines,expected) {
  const r=JSON.parse(lines.trim().split('\n').at(-1));
  assert.equal(r.outcome,expected);
  assert.equal(r.activation_authorized,false);
  if(expected==='blocked')assert.equal(r.latched,true);
  if(expected==='eligible-lab-only')assert.equal(r.source,'legacy-control');
  return r;
}
function startPending(args) {
  const child=spawn('docker',args,{stdio:['ignore','pipe','pipe']});
  let out='',err='';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data',v=>{out+=v;});
  child.stderr.on('data',v=>{err+=v;});
  const done=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('close',code=>{
      if(code!==0)reject(Error('pending isolated worker failed'));
      else resolve(out);
    });
  });
  const started=new Promise((resolve,reject)=>{
    const deadline=setTimeout(()=>reject(Error('pending worker failed to start')),12000);
    const check=()=>{
      if(out.includes('P49_WORKER_STARTED\n')) {
        clearTimeout(deadline);
        resolve();
      }
    };
    child.stdout.on('data',check);
    child.once('close',()=>{
      if(!out.includes('P49_WORKER_STARTED\n')) {
        clearTimeout(deadline);
        reject(Error('pending worker exited without starting'));
      }
    });
    check();
  });
  return {child,done,started,output:()=>out};
}

/**
 * Disposable Docker bridge rehearsal with three distinct network
 * namespaces: coordinator, worker A and worker B. Internal network, NO
 * published ports, fresh ephemeral test certificates, no Supabase/production
 * secrets and no product graph route. Signs leases on runner only.
 */
export async function runP49IsolatedContainers(argv=process.argv.slice(2)) {
  if(argv.length!==1 || argv[0]!=='--isolated-test'
    || process.env.P49_ALLOW_DOCKER_REHEARSAL!=='1') {
    throw Error('P49 Docker rehearsal requires explicit isolated-test opt-in');
  }
  const checkout=resolve(process.cwd());
  const repoSha=docker(['--version']) && cmd('git',['rev-parse','HEAD']);
  if(!/^[a-f0-9]{40}$/.test(repoSha))throw Error('invalid checkout SHA');
  const root=mkdtempSync(join(tmpdir(),'p49-isolated-containers-'));
  const suffix=randomBytes(5).toString('hex');
  const network='p49-ci-'+suffix;
  const serverName='p49-server-'+suffix;
  const pendingName='p49-pending-'+suffix;
  let created=false,pending=null, server=false;
  try {
    for(const dir of ['state','verify','server','client','other']) {
      mkdirSync(join(root,dir),{mode:0o700});
    }
    makeCertificates(root);
    for(const name of ['server','client','other']) {
      for(const ext of ['key','pem']) {
        writeFileSync(join(root,name,name+'.'+ext),
          readFileSync(join(root,name+'.'+ext)),{mode:0o600});
      }
    }
    const pair=generateKeyPairSync('ed25519');
    const publicKey=pair.publicKey.export({type:'spki',format:'pem'});
    const keyPin=digest(pair.publicKey.export({type:'spki',format:'der'}));
    const serverPin=digest(new X509Certificate(readFileSync(
      join(root,'server.pem'))).raw);
    const clientPin=digest(new X509Certificate(readFileSync(
      join(root,'client.pem'))).raw);
    writeFileSync(join(root,'verify','signer-public.pem'),publicKey,{mode:0o600});
    writeFileSync(join(root,'verify','lab.json'),JSON.stringify({
      schema_version:'reference-graph.p49-disposable-lab.v1',
      repository_sha:repoSha,lab_id:LAB,
      default_off:true,public_key_sha256:keyPin,
      server_cert_sha256:serverPin,client_cert_sha256:clientPin,
    }),{mode:0o600});
    const store=createP47DurableLabRevocation({
      directory:join(root,'state'),scope:SCOPE,
      publicKeyPem:publicKey,publicKeySha256:keyPin,
      expectedRepositorySha:repoSha,expectedLabId:LAB,
      clock:()=>FIXED,
    });
    store.seedLabPermit(signed(pair.privateKey,repoSha,'shadow-probe-only',1));
    docker(['pull',IMAGE],120000);
    docker(['network','create','--driver','bridge','--internal',network]);
    created=true;
    assert.equal(docker(['network','inspect','--format','{{.Internal}}',network]),'true');
    docker([
      'run','-d','--name',serverName,
      '--network',network,'--network-alias','p49-coordinator.lab',
      '--read-only','--cap-drop=ALL',
      '--security-opt','no-new-privileges:true',
      '--memory','192m','--pids-limit','96',
      '-e','P49_DOCKER_REHEARSAL=1',
      ...bind(checkout,'/repo'),
      ...bind(join(root,'ca.pem'),'/lab/ca.pem'),
      ...bind(join(root,'state'),'/lab/state'),
      ...bind(join(root,'verify'),'/lab/verify'),
      ...bind(join(root,'server'),'/lab/server'),
      IMAGE,'node','/repo/reference-graph/cli/p49-container-lab-server.mjs',
    ]);
    server=true;
    waitForServer(serverName);
    const ports=docker(['inspect','--format','{{json .HostConfig.PortBindings}}',serverName]);
    assert.ok(ports==='null'||ports==='{}','no host ports may be published');

    // Two different network namespace workers, not just processes.
    for(const n of ['a','b']) {
      validReport(docker(workerArgs({
        name:'p49-worker-'+n+'-'+suffix,network,checkout,root,
      }),12000),'eligible-lab-only');
    }
    // A different leaf certificate signed by the SAME CA must fail.
    validReport(docker(workerArgs({
      name:'p49-untrusted-'+suffix,network,checkout,root,other:true,
    }),12000),'blocked');

    pending=startPending(workerArgs({
      name:pendingName,network,checkout,root,phase:'pending',
    }));
    await pending.started;
    store.revokeWithSignedState(signed(pair.privateKey,repoSha,'revoked',2));
    validReport(await pending.done,'blocked');

    // Network/worker restart reads durable OFF, not an old permit cache.
    docker(['stop','-t','2',serverName],10000);
    docker(['start',serverName],10000);
    waitForServer(serverName);
    validReport(docker(workerArgs({
      name:'p49-post-restart-'+suffix,network,checkout,root,
    }),12000),'blocked');

    // An actual TLS connection loss fails closed.
    docker(['stop','-t','2',serverName],10000);
    validReport(docker(workerArgs({
      name:'p49-offline-'+suffix,network,checkout,root,
    }),12000),'blocked');

    return {
      schema_version:'reference-graph.p49-isolated-containers-rehearsal.v1',
      distinct_container_network_namespaces:3,
      internal_bridge_network:true,host_ports_published:false,
      tls_version:'TLSv1.3',
      mutual_tls_and_leaf_pins_verified:true,
      worker_permit_cases:2,
      wrong_client_cert_blocked:true,
      in_flight_revoke_blocked:true,
      coordinator_restart_revoke_blocked:true,
      coordinator_network_loss_blocked:true,
      production_deployment_performed:false,
      production_rollback_rehearsed:false,
      activation_authorized:false,
      repository_default_graph_enabled:false,
    };
  } finally {
    pending?.child.kill();
    try{docker(['rm','-f',pendingName],5000);}catch{}
    if(server)try{docker(['rm','-f',serverName],7000);}catch{}
    if(created)try{docker(['network','rm',network],5000);}catch{}
    rmSync(root,{recursive:true,force:true});
  }
}

if(process.argv[1]?.endsWith('p49-rehearse-isolated-containers.mjs')){
  try{
    const result=await runP49IsolatedContainers();
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{
    process.stderr.write('P49 isolated Docker rehearsal BLOCKED\n');
    process.exitCode=2;
  }
}
