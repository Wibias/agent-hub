import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { manageGlobalMemoryProject } from '../../memory-engine/adapters/codex-global-memory-scope.mjs';
import {
  diagnoseCodexMemory,parseDoctorArgs,
} from '../../scripts/doctor-codex-memory-read.mjs';

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'codex-local-read-doctor-'));
  const project=join(root,'alpha'),other=join(root,'outsider');
  for(const [dir,name] of [[project,'alpha'],[other,'outsider']]){
    mkdirSync(dir);
    execFileSync('git',['init','-b','main',dir],{stdio:'ignore'});
    execFileSync('git',['-C',dir,'-c','user.name=CI',
      '-c','user.email=ci@example.invalid','commit','--allow-empty',
      '-m','initial'],{stdio:'ignore'});
    execFileSync('git',['-C',dir,'remote','add','origin',
      'https://github.com/example/'+name+'.git']);
  }
  const dbPath=join(root,'memory.sqlite3'),scopePath=join(root,'scopes.json');
  const db=new MemoryEngine({dbPath});
  db.registerProject({projectId:'github.com/example/alpha',
    repoIdentity:'github.com/example/alpha'});
  db.ingest({
    evidence:{
      id:'direct-evidence-1',projectId:'github.com/example/alpha',
      harness:'codex',sessionId:'real-1',
      sourceKind:'session',sourceRef:'session:real-1',
      capturedAt:'2026-11-12T00:00:00Z',branch:'main',
      commitSha:null,path:null,blobOid:null,
      content:'Our preferred database is PostgreSQL.',
      authorityClass:'user_direct',metadata:{},
    },
    claim:{
      id:'direct-claim-1',kind:'decision',subject:'database',
      predicate:'uses',value:'Our preferred database is PostgreSQL.',
      branchScope:'main',createdAt:'2026-11-12T00:00:00Z',
    },
  });
  db.close();
  manageGlobalMemoryProject({
    cwd:project,operation:'add',dbPath,scopePath,apply:true,
  });
  return {root,project,other,dbPath,scopePath,
    cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');

test('real stdio doctor finds existing memory but prints no facts or paths and writes no SQLite/config',()=>{
  const f=fixture();
  try{
    const before=[sha(f.dbPath),sha(f.scopePath)];
    const response=diagnoseCodexMemory({
      cwd:f.project,scopePath:f.scopePath,query:'database',
    });
    assert.deepEqual([response.status,response.memory_status,
      response.project_id,response.branch,response.matching_items],[
      'ready_with_memory','found','github.com/example/alpha','main',1,
    ]);
    assert.equal(response.original_codex_cli_desktop_verified,false);
    assert.equal(response.protected_private_claim_release_enabled,false);
    assert.equal(response.memory_db_modified,false);
    assert.ok(!JSON.stringify(response).includes('PostgreSQL'));
    assert.ok(!JSON.stringify(response).includes(f.root));
    assert.deepEqual([sha(f.dbPath),sha(f.scopePath)],before);
  }finally{f.cleanup();}
});

test('real stdio doctor distinguishes empty query result from broken MCP',()=>{
  const f=fixture();
  try{
    const x=diagnoseCodexMemory({
      cwd:f.project,scopePath:f.scopePath,
      query:'a completely nonexistent project keyword zzz-not-in-db',
    });
    assert.equal(x.stdio_mcp_ok,true);
    assert.equal(x.status,'ready_no_matching_memory');
    assert.equal(x.memory_status,'no_current_authorized_match');
    assert.equal(x.matching_items,0);
  }finally{f.cleanup();}
});

test('real stdio doctor does not silently enroll a foreign repo',()=>{
  const f=fixture();
  try{
    const before=[sha(f.dbPath),sha(f.scopePath)];
    const x=diagnoseCodexMemory({
      cwd:f.other,scopePath:f.scopePath,query:'database',
    });
    assert.equal(x.status,'not_ready');
    assert.equal(x.memory_status,'project_not_approved');
    assert.equal(x.matching_items,0);
    assert.deepEqual([sha(f.dbPath),sha(f.scopePath)],before);
  }finally{f.cleanup();}
});

test('CLI emits only bounded read status, no user facts',()=>{
  const f=fixture();
  try{
    const script=resolve('scripts/doctor-codex-memory-read.mjs');
    const result=spawnSync(process.execPath,[
      script,'--cwd',f.project,'--scope',f.scopePath,'--query','database',
    ],{encoding:'utf8',timeout:25000});
    assert.equal(result.status,0,result.stderr);
    const parsed=JSON.parse(result.stdout);
    assert.equal(parsed.status,'ready_with_memory');
    assert.ok(!result.stdout.includes('PostgreSQL'));
    assert.ok(!result.stdout.includes(f.root));
    assert.equal(result.stderr,'');
  }finally{f.cleanup();}
});

test('doctor rejects input spoofing and malformed protocol',()=>{
  const f=fixture();
  try{
    assert.deepEqual(parseDoctorArgs([
      '--cwd',f.project,'--scope',f.scopePath,
    ]),{cwd:resolve(f.project),scopePath:resolve(f.scopePath),
      query:'project decision'});
    assert.throws(()=>parseDoctorArgs(['--query','database']));
    assert.throws(()=>parseDoctorArgs(['--cwd','relative']));
    assert.throws(()=>parseDoctorArgs(['--cwd',f.project,'--scope','relative']));
    assert.throws(()=>diagnoseCodexMemory({
      cwd:f.project,run:()=>JSON.stringify({
        jsonrpc:'2.0',id:1,result:{},
      }),
    }),/doctor_stdio_protocol_invalid/);
  }finally{f.cleanup();}
});
