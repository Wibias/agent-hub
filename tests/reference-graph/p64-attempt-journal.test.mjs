import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  inspectP64LocalAttempt, runP64JournalAttempt,
} from '../../reference-graph/p64-attempt-journal.mjs';
import { runP64Cli } from '../../reference-graph/cli/p64-journal-protected-attempt.mjs';

const PIN='a'.repeat(64);
const KEY='sb_secret_P64_FAKE_ONLY_NEVER_REAL';
const witness='C:\\private\\witness.json';
const fixedId='0b40c311-2e10-4c34-af3f-a9952ba4abfa';
const baseDate='2026-11-10T00:00:00.000Z';
const args=(out)=>['--witness-file',witness,'--witness-sha256',PIN,'--attempt-dir',out];
const fakeP61={
  schema_version:'reference-graph.p61-protected-readonly-observation.v1',
  project_ref:'vrznfnxzlxaavpqbzbzd',
  observed_at:'2026-11-10T00:00:00.100Z',
  completed_at:'2026-11-10T00:00:00.800Z',
  source_witness_sha256:PIN,
  snapshot_date:'2026-11-10',
  refreshed_at:'2026-11-10T00:00:00.000Z',
  candidate_count:275,
  http_get_requests:1,
  bounded_transport_elapsed_ms:700,
  server_only_transport_verified:true,
  source_provenance_independently_attested:false,
  twenty_four_hour_soak_complete:false,
  forty_eight_case_live_parity_attested:false,
  production_rollback_rehearsed:false,
  activation_authorized:false,
  repository_default_graph_enabled:false,
};
function fixture() {
  const parent=mkdtempSync(join(tmpdir(),'p64-journal-'));
  return {
    parent, out:join(parent,'new-attempt'),
    cleanup(){rmSync(parent,{recursive:true,force:true});},
  };
}
function clock() {
  let index=0;
  return ()=>new Date(index++===0?baseDate:'2026-11-10T00:00:01.000Z');
}
function goodProbe({expectOut,expectKey=true}={}) {
  return async ({argv,env,stdout})=>{
    assert.deepEqual(argv,['--witness-file',witness,'--witness-sha256',PIN]);
    if(expectKey)assert.equal(env.P40_SUPABASE_SECRET_KEY,KEY);
    const start=JSON.parse(readFileSync(join(expectOut,'start.json'),'utf8'));
    assert.equal(start.source_witness_sha256,PIN);
    assert.equal(start.attempt_id,fixedId);
    assert.equal(start.activation_authorized,false);
    assert.equal(existsSync(join(expectOut,'finish.json')),false);
    stdout.write(JSON.stringify(fakeP61)+'\n');
    return fakeP61;
  };
}
function launch(f,overrides={}) {
  return runP64JournalAttempt({
    argv:args(f.out),env:{P40_SUPABASE_SECRET_KEY:KEY},
    now:clock(),id:()=>fixedId,
    ...overrides,
  });
}

test('P64 persists start before invoking protected probe; success is bound to exact report hash',async()=>{
  const f=fixture();
  try {
    const result=await launch(f,{probe:goodProbe({expectOut:f.out})});
    assert.equal(result.outcome,'passed');
    assert.equal(result.journal_started,true);
    assert.equal(result.journal_finished,true);
    assert.equal(result.independent_attempt_completeness_attested,false);
    assert.equal(result.activation_authorized,false);
    assert.deepEqual(readdirSync(f.out).sort(),
      ['finish.json','p61-success.json','start.json']);
    const finish=JSON.parse(readFileSync(join(f.out,'finish.json'),'utf8'));
    const bytes=readFileSync(join(f.out,'p61-success.json'));
    assert.equal(finish.outcome,'passed');
    assert.equal(finish.p61_report_sha256,
      createHash('sha256').update(bytes).digest('hex'));
    assert.equal(inspectP64LocalAttempt({attemptDir:f.out}).outcome,'passed');
    assert.equal(inspectP64LocalAttempt({attemptDir:f.out}).independently_authenticated,false);
    for(const filename of readdirSync(f.out)){
      const body=readFileSync(join(f.out,filename),'utf8');
      assert.doesNotMatch(body,/sb_secret_|search_text|legacy_id|access_token/);
      if(process.platform!=='win32')assert.equal(lstatSync(join(f.out,filename)).mode & 0o777,0o600);
    }
  } finally {f.cleanup();}
});

test('P64 never drops failed P61 attempt or serializes an exception carrying a secret',async()=>{
  const f=fixture();
  try {
    const r=await launch(f,{probe:async()=>{throw new Error('sb_secret_SHOULD_NOT_APPEAR');}});
    assert.equal(r.outcome,'blocked');
    assert.deepEqual(readdirSync(f.out).sort(),['finish.json','start.json']);
    const contents=readFileSync(join(f.out,'finish.json'),'utf8');
    assert.equal(JSON.parse(contents).outcome,'blocked');
    assert.doesNotMatch(contents,/SHOULD_NOT_APPEAR|secret|search_text/);
    assert.equal(inspectP64LocalAttempt({attemptDir:f.out}).outcome,'blocked');
  }finally{f.cleanup();}
});

test('P64 crash or failed terminal write leaves a visible INCOMPLETE journal',async()=>{
  const f=fixture();
  let n=0;
  try{
    await assert.rejects(launch(f,{
      now:()=>{
        if(n++===0)return new Date(baseDate);
        throw new Error('simulated system crash');
      },
      probe:goodProbe({expectOut:f.out}),
    }),/simulated system crash/);
    assert.equal(existsSync(join(f.out,'start.json')),true);
    assert.equal(existsSync(join(f.out,'p61-success.json')),true);
    assert.equal(existsSync(join(f.out,'finish.json')),false);
    const result=inspectP64LocalAttempt({attemptDir:f.out});
    assert.equal(result.outcome,'incomplete');
    assert.equal(result.terminal_record_present,false);
    assert.equal(result.complete_attempt_journal_verified,false);
  }finally{f.cleanup();}
});

test('P64 rejects existing directories and never contacts the service on failed setup',async()=>{
  const f=fixture();
  let invoked=false;
  try{
    mkdirSync(f.out);
    await assert.rejects(launch(f,{probe:async()=>{invoked=true;}}),/BLOCKED/);
    assert.equal(invoked,false);
    assert.deepEqual(readdirSync(f.out),[]);
    await assert.rejects(launch(f,{
      argv:args(join(process.cwd(),'unsafe-attempt')),
      probe:async()=>{invoked=true;},
    }),/BLOCKED/);
    assert.equal(invoked,false);
  }finally{f.cleanup();}
});

test('P64 rejects forged outputs and does not label them successful',async()=>{
  for(const mutate of [
    r=>{r.activation_authorized=true;},
    r=>{r.extra='sb_secret_injected';},
    r=>{r.source_witness_sha256='b'.repeat(64);},
    r=>{r.server_only_transport_verified=false;},
    r=>{r.candidate_count=0;},
  ]){
    const f=fixture();
    try{
      const bad={...fakeP61};mutate(bad);
      const r=await launch(f,{probe:async ({stdout})=>{
        stdout.write(JSON.stringify(bad)+'\n');
        return bad;
      }});
      assert.equal(r.outcome,'blocked');
      assert.deepEqual(readdirSync(f.out).sort(),['finish.json','start.json']);
      assert.equal(inspectP64LocalAttempt({attemptDir:f.out}).outcome,'blocked');
    }finally{f.cleanup();}
  }
});

test('P64 inspector detects tampering, symlinks and unrecognized private files',async()=>{
  const f=fixture();
  try{
    await launch(f,{probe:goodProbe({expectOut:f.out})});
    writeFileSync(join(f.out,'unexpected-data.json'),'{}');
    assert.throws(()=>inspectP64LocalAttempt({attemptDir:f.out}),/BLOCKED/);
    rmSync(join(f.out,'unexpected-data.json'));
    writeFileSync(join(f.out,'p61-success.json'),JSON.stringify({...fakeP61,candidate_count:1})+'\n');
    assert.throws(()=>inspectP64LocalAttempt({attemptDir:f.out}),/BLOCKED/);
  }finally{f.cleanup();}
});

test('P64 CLI never needs a key to inspect, and reports blocked attempts generically',async()=>{
  const f=fixture();
  try{
    let written='';
    const result=await runP64Cli({
      argv:args(f.out),env:{},
      execute:params=>runP64JournalAttempt({
        ...params,now:clock(),id:()=>fixedId,
        probe:async()=>{throw new Error('secret never in CLI output');},
      }),
      stdout:{write(s){written+=s;}},
    });
    assert.equal(result.outcome,'blocked');
    assert.doesNotMatch(written,/secret never|sb_secret/);
    let inspection='';
    const check=await runP64Cli({
      argv:['--inspect-dir',f.out],env:{},
      stdout:{write(s){inspection+=s;}},
    });
    assert.equal(check.outcome,'blocked');
    assert.equal(check.activation_authorized,false);
    assert.equal(JSON.parse(inspection).independently_authenticated,false);
  }finally{f.cleanup();}
});

test('P64 remains disconnected from P11, P30 and production scheduling',()=>{
  const code=readFileSync(new URL('../../reference-graph/p64-attempt-journal.mjs',import.meta.url),'utf8');
  const router=readFileSync(new URL('../../reference-graph/p11-runtime-router.mjs',import.meta.url),'utf8');
  const p30=readFileSync(new URL('../../reference-graph/p30-profile-transport.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(router,/p64-attempt-journal/);
  assert.doesNotMatch(p30,/p64-attempt-journal/);
  assert.doesNotMatch(code,/cron\.schedule|schtasks|writeFileSync\(.*P11/);
  assert.ok(code.includes('activation_authorized:false'));
});
