import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  P62_MANDATORY_RELEASE_EVIDENCE, P62_MANDATORY_ROLLBACK_TRIGGERS,
} from '../../reference-graph/p62-release-review-preflight.mjs';
import {
  P70_ENROLLED_PRODUCTION_PINS, verifyP70ProductionRelease,
  runP70ApprovedProfile,
} from '../../reference-graph/p70-production-release-gate.mjs';
import {
  computeP70InstalledRuntimeDigest, maybeRunP70InstalledProduction,
} from '../../reference-graph/p70-production-host-config.mjs';
import { runP69BoundQuery } from '../../knowledge/design-references/scripts/query-host-runtime.mjs';
import { loadRecords, loadPatterns } from '../../knowledge/design-references/scripts/lib.mjs';

const COMMIT='7d4366c2293633a5906faa809a4ca3d8117425a6';
const HOST='agentshub-windows-release-host-01';
const NOW=new Date('2026-11-11T20:30:00.000Z');
const COMPLETE_REQUEST={profile:'standard',limit:12,surface:'public-home',
  platform:'web-responsive',job:'creator product landing page with clear primary CTA',
  dimensions:'visual-world,topology'};
const PROJECT='vrznfnxzlxaavpqbzbzd';
const digest=s=>createHash('sha256').update(s).digest('hex');
const kp=()=>generateKeyPairSync('ed25519');
const owner=kp(), reviewer=kp(), coordinator=kp();
const pem=k=>k.publicKey.export({type:'spki',format:'pem'}).toString();
const pin=k=>digest(k.publicKey.export({type:'spki',format:'der'}));
const envPins={owner:pin(owner),reviewer:pin(reviewer),coordinator:pin(coordinator)};
const ARTIFACT=digest('expected installed-runtime bytes');
const WITNESS=digest('trusted pinned snapshot');
function record(patch={}) {
  return {
    schema_version:'reference-graph.p62-release-review-record.v1',
    repository:'Wibias/agent-hub', repository_sha:COMMIT,project_ref:PROJECT,
    operator_id:'operator-01', operator_host_id:HOST,
    owner_id:'Wibias',independent_reviewer_id:'reviewer-02',
    profiles:['standard','deep'],canary_percent:5,default_off:true,
    snapshot_date:'2026-11-11',refreshed_at:'2026-11-11T20:29:00.000Z',
    not_before:'2026-11-11T20:28:00.000Z',
    expires_at:'2026-11-11T20:58:00.000Z',
    evidence:Object.fromEntries(P62_MANDATORY_RELEASE_EVIDENCE.map((x,i)=>
      [x,(i+1).toString(16).repeat(64)])),
    human_approval:{
      reviewer_attestation_sha256:'a'.repeat(64),
      owner_activation_decision_sha256:'b'.repeat(64),
    },
    revocation:{
      nonce:'revoke-must-be-external-unique-0001',
      ledger_anchor_sha256:'c'.repeat(64),
      rollback_plan_sha256:'d'.repeat(64),
      rollback_triggers:[...P62_MANDATORY_ROLLBACK_TRIGGERS],
    },
    ...patch,
  };
}
function approval(patch={},review=record()) {
  const payload_json=JSON.stringify({
    schema_version:'reference-graph.p70-production-release.v1',
    repository_sha:COMMIT,project_ref:PROJECT,operator_host_id:HOST,
    profiles:['standard','deep'],canary_percent:5,
    not_before:review.not_before,expires_at:review.expires_at,
    release_review:review,witness_sha256:WITNESS,
    runtime_artifact_sha256:ARTIFACT,...patch,
  });
  return {
    payload_json,
    owner_signature_base64:sign(null,Buffer.from(payload_json),owner.privateKey)
      .toString('base64'),
    reviewer_signature_base64:sign(null,Buffer.from(payload_json),reviewer.privateKey)
      .toString('base64'),
  };
}
function verify(envelope=approval(),patch={}) {
  return verifyP70ProductionRelease({
    envelope,ownerPem:pem(owner),ownerPin:pin(owner),
    reviewerPem:pem(reviewer),reviewerPin:pin(reviewer),
    expectedRepositorySha:COMMIT,expectedHostId:HOST,
    expectedRuntimeDigest:ARTIFACT,requestProfile:'standard',now:NOW,...patch,
  });
}
function invocation(patch={}) {
  return {
    envelope:approval(),
    ownerPem:pem(owner),ownerPin:pin(owner),
    reviewerPem:pem(reviewer),reviewerPin:pin(reviewer),
    expectedRepositorySha:COMMIT,expectedHostId:HOST,
    expectedRuntimeDigest:ARTIFACT,
    coordinatorPem:pem(coordinator),coordinatorPin:pin(coordinator),
    stateEndpoint:'https://trusted-prod-coordinator.example.org/state',
    stateReadToken:'x'.repeat(50),
    serviceKey:'sb_secret_test_unit_only_0000000000',
    getWitness:async()=>({json:'{}',sha256:WITNESS}),
    records:loadRecords(),patterns:loadPatterns(),request:COMPLETE_REQUEST,
    requestKey:HOST,now:NOW,trustedClock:()=>NOW,recordUsageEnabled:false,
    ...patch,
  };
}

test('P70 has no enrolled production trust anchors in shipped runtime',()=>{
  assert.deepEqual(P70_ENROLLED_PRODUCTION_PINS,
    {owner:null,reviewer:null,coordinator:null});
  assert.equal(Object.isFrozen(P70_ENROLLED_PRODUCTION_PINS),true);
});

test('P70 rejects unsigned and forged release and never treats a P62 record as authorization',()=>{
  assert.equal(verify().authorized,true);
  assert.equal(verify({...approval(),owner_signature_base64:'A'.repeat(86)+'=='}).authorized,false);
  assert.equal(verify({...approval(),reviewer_signature_base64:'A'.repeat(86)+'=='}).authorized,false);
  assert.equal(verify(approval(),{ownerPin:pin(coordinator)}).authorized,false);
  assert.equal(verify(approval(),{reviewerPin:pin(owner)}).authorized,false);
  assert.equal(verify(approval(),{expectedHostId:'another-host-0001'}).authorized,false);
  assert.equal(verify(approval(),{expectedRepositorySha:'f'.repeat(40)}).authorized,false);
  assert.equal(verify(approval(),{expectedRuntimeDigest:'f'.repeat(64)}).authorized,false);
});

test('P70 rejects wrong profile, percent, window, source witness and P62 evidence shape',()=>{
  for(const alt of [
    {canary_percent:10},{profiles:['quick']},
    {operator_host_id:'unknown-host-3333'},{repository_sha:'f'.repeat(40)},
    {witness_sha256:'broken'},{runtime_artifact_sha256:'f'.repeat(64)},
    {expires_at:'2026-11-11T23:59:00.000Z'},
  ]) assert.equal(verify(approval(alt)).authorized,false,JSON.stringify(alt));
  assert.equal(verify(approval({},record({evidence:{}}))).authorized,false);
  assert.equal(verify(approval(),{now:new Date('2026-11-12T00:00:00.000Z')}).authorized,false);
  assert.equal(verify(approval(),{requestProfile:'quick'}).authorized,false);
});

test('P70 actual P67 factory is only invoked with two trusted signatures and independent coordinator',async()=>{
  let calls=0,usage=0;
  const factory=args=>{
    calls++;
    assert.equal(args.repositorySha,COMMIT);
    assert.equal(args.trustedPublicKeySha256,pin(coordinator));
    return {run:async input=>{
      const control=await args.legacyRunner({
        records:loadRecords(),patterns:loadPatterns(),request:COMPLETE_REQUEST,now:NOW,
        recordUsageEnabled:true,
      });
      assert.equal(control.routing.authoritative_source,'legacy-control');
      assert.equal(input.requestKey,HOST);
      return {result:{coverageGaps:[],profile:'standard'},routing:{
        authoritative_source:'reference-graph'}};
    }};
  };
  // Empty local data still produces an authentic legacy object.
  const result=await runP70ApprovedProfile(invocation({
    factory,recordUsageEnabled:true,
    recordUsageFn:()=>{usage++;},
  }));
  assert.equal(result.routing.authoritative_source,'reference-graph');
  assert.equal(calls,1);
  assert.equal(usage,1);
  assert.equal(await runP70ApprovedProfile(invocation({
    factory,envelope:{...approval(),owner_signature_base64:'bad'},
  })),null);
  assert.equal(calls,1);
  assert.equal(await runP70ApprovedProfile(invocation({
    factory,stateEndpoint:'https://127.0.0.1:443/state',
  })),null);
  assert.equal(calls,1);
  assert.equal(await runP70ApprovedProfile(invocation({
    factory,coordinatorPin:pin(owner),coordinatorPem:pem(owner),
  })),null);
  assert.equal(calls,1);
});

test('P70 operational failure after P11 usage returns memoized Legacy without double recording',async()=>{
  let count=0;
  const result=await runP70ApprovedProfile(invocation({
    recordUsageEnabled:true,recordUsageFn:()=>{count++;},
    factory:args=>({run:async()=>{
      await args.legacyRunner({
        records:loadRecords(),patterns:loadPatterns(),request:COMPLETE_REQUEST,now:NOW,
        recordUsageEnabled:true,
      });
      throw Error('simulate coordinator disconnect after legacy side effect');
    }}),
  }));
  assert.equal(result.routing.authoritative_source,'legacy-control');
  assert.equal(count,1);
});


test('P70 approved release really lazy-loads P67/P68 without injected factory and respects central OFF',async()=>{
  let reads=0,usage=0;
  const stateFetchImpl=async(url,options)=>{
    reads++;
    assert.equal(url,'https://trusted-prod-coordinator.example.org/state');
    assert.equal(options.method,'GET');
    const nonce=options.headers['X-P67-Nonce'];
    assert.match(nonce,/^[0-9a-f]{32}$/);
    const payload_json=JSON.stringify({
      schema_version:'reference-graph.p67-shared-state.v1',
      repository_sha:COMMIT,project_ref:PROJECT,nonce,generation:1,
      status:'off',profiles:[],canary_percent:0,cohort_salt:'0'.repeat(32),
      issued_at:NOW.toISOString(),
      expires_at:new Date(NOW.valueOf()+3000).toISOString(),
    });
    return {ok:true,status:200,text:async()=>JSON.stringify({
      payload_json,
      signature_base64:sign(null,Buffer.from(payload_json),coordinator.privateKey)
        .toString('base64'),
    })};
  };
  const out=await runP70ApprovedProfile(invocation({
    // No factory override: this must load the real P68 trusted-host wrapper
    // after independent test signatures have been verified.
    records:loadRecords(),patterns:loadPatterns(),
    request:{
      profile:'standard',limit:12,surface:'public-home',
      platform:'web-responsive',
      job:'creator product landing page with clear primary CTA',
      dimensions:'visual-world,topology',
    },
    recordUsageEnabled:true,
    recordUsageFn:()=>{usage++;},
    stateFetchImpl,
    getWitness:async()=>{throw Error('OFF must not access source');},
    fetchCandidates:async()=>{throw Error('OFF must not access P30');},
  }));
  assert.equal(out?.routing?.authoritative_source,'legacy-control');
  assert.equal(out.canary.status,'legacy');
  assert.equal(usage,1);
  assert.equal(reads,1);
});

test('P70 never returns Graph after the independently signed owner window expires',async()=>{
  let used=0;
  const after=new Date('2026-11-11T21:01:00.000Z');
  const response=await runP70ApprovedProfile(invocation({
    recordUsageEnabled:true,
    recordUsageFn:()=>{used++;},
    trustedClock:()=>after,
    factory:args=>({run:async()=>{
      await args.legacyRunner({
        records:loadRecords(),patterns:loadPatterns(),request:COMPLETE_REQUEST,now:NOW,
        recordUsageEnabled:true,
      });
      return {result:{coverageGaps:[]},routing:{
        authoritative_source:'reference-graph'}};
    }}),
  }));
  assert.equal(response?.routing?.authoritative_source,'legacy-control');
  assert.equal(used,1);
});

test('P70 installed-config path cannot read ANY local secret without enrolled pins',async()=>{
  let reads=0,called=0;
  const result=await maybeRunP70InstalledProduction({
    configPath:'/private/not-authorized.json',
    request:{profile:'standard'},trustedPins:P70_ENROLLED_PRODUCTION_PINS,
    read:()=>{reads++;throw Error('must not read');},
    activate:()=>{called++;throw Error('must not activate');},
  });
  assert.equal(result,null);assert.equal(reads,0);assert.equal(called,0);
});

test('P70 release digest includes transitive Graph modules and actual JSONL loader inputs',()=>{
  const d=mkdtempSync(join(tmpdir(),'p70-digest-'));
  const files=[
    'knowledge/design-references/scripts/query-runtime.mjs',
    'knowledge/design-references/scripts/query-host-runtime.mjs',
    'knowledge/design-references/scripts/query.mjs',
    'reference-graph/p69-installed-off-host.mjs',
    'reference-graph/p70-production-release-gate.mjs',
    'reference-graph/p70-production-host-config.mjs',
    'reference-graph/p68-server-host.mjs',
    'reference-graph/p67-server-profile-adapter.mjs',
    'knowledge/design-references/taxonomy.json',
    'knowledge/design-references/data/test.jsonl',
    'knowledge/design-references/patterns/test.jsonl',
  ];
  const put=(p,contents)=>{const loc=join(d,p);mkdirSync(join(loc,'..'),{recursive:true});writeFileSync(loc,contents);};
  try {
    for(const p of files) put(p,'export const fixture=1;');
    put('reference-graph/p70-production-release-gate.mjs',
      "const runtime = import('./p68-server-host.mjs');");
    put('reference-graph/p68-server-host.mjs',
      "import { fixture } from './p67-server-profile-adapter.mjs';");
    const before=computeP70InstalledRuntimeDigest({repoRoot:d});
    assert.match(before,/^[a-f0-9]{64}$/);
    put('reference-graph/p67-server-profile-adapter.mjs','export const fixture=2;');
    const changedDependency=computeP70InstalledRuntimeDigest({repoRoot:d});
    assert.notEqual(changedDependency,before);
    put('knowledge/design-references/data/test.jsonl','{"tampered":true}\n');
    const changedData=computeP70InstalledRuntimeDigest({repoRoot:d});
    assert.notEqual(changedData,changedDependency);
    put('reference-graph/p70-production-release-gate.mjs',
      'const runtime=import(dynamicName);');
    assert.throws(()=>computeP70InstalledRuntimeDigest({repoRoot:d}),
      /computed dynamic import not pinned/);
  } finally {rmSync(d,{recursive:true,force:true});}
});

test('P70 trusted host samples a fresh private cohort ID per query, not constant host ID',async()=>{
  const d=mkdtempSync(join(tmpdir(),'p70-cohort-'));
  const put=(p,contents)=>{const loc=join(d,p);mkdirSync(join(loc,'..'),{recursive:true});writeFileSync(loc,contents);return loc;};
  try {
    for(const p of [
      'knowledge/design-references/scripts/query-runtime.mjs',
      'knowledge/design-references/scripts/query-host-runtime.mjs',
      'knowledge/design-references/scripts/query.mjs',
      'reference-graph/p69-installed-off-host.mjs',
      'reference-graph/p70-production-release-gate.mjs',
      'reference-graph/p70-production-host-config.mjs',
    ]) put(p,'export const fixture=1;');
    put('knowledge/design-references/taxonomy.json','{}');
    put('knowledge/design-references/data/test.jsonl','{}\n');
    put('knowledge/design-references/patterns/test.jsonl','{}\n');
    const digestValue=computeP70InstalledRuntimeDigest({repoRoot:d});
    const env=approval({runtime_artifact_sha256:digestValue});
    const paths={
      release_envelope_path:put('release.json',JSON.stringify(env)),
      owner_public_key_path:put('owner.pem',pem(owner)),
      reviewer_public_key_path:put('reviewer.pem',pem(reviewer)),
      coordinator_public_key_path:put('coordinator.pem',pem(coordinator)),
      state_read_token_path:put('coordinator-token','x'.repeat(50)),
      service_key_path:put('server-key','sb_secret_unit_test_only_000000000000'),
      witness_json_path:put('witness.json','trusted pinned snapshot'),
    };
    const configPath=put('manifest.json',JSON.stringify({
      schema_version:'reference-graph.p70-trusted-host-config.v1',
      repository_sha:COMMIT,operator_host_id:HOST,
      state_endpoint:'https://trusted-prod-coordinator.example.org/state',
      ...paths,
    }));
    const keys=[];
    const opts={
      configPath,records:[],patterns:[],request:{profile:'standard'},
      now:NOW,trustedPins:envPins,repoRoot:d,
      activate:async call=>{keys.push(call.requestKey);return {result:{coverageGaps:[]},
        routing:{authoritative_source:'legacy-control'}};},
    };
    assert.ok(await maybeRunP70InstalledProduction(opts));
    assert.ok(await maybeRunP70InstalledProduction(opts));
    assert.equal(keys.length,2);
    for(const key of keys) {
      assert.match(key,/^[a-f0-9]{32}$/);
      assert.notEqual(key,HOST);
    }
    assert.notEqual(keys[0],keys[1]);
    put('knowledge/design-references/data/test.jsonl','{"changed":true}\n');
    assert.equal(await maybeRunP70InstalledProduction(opts),null);
    assert.equal(keys.length,2);
  } finally {rmSync(d,{recursive:true,force:true});}
});

test('P70 real Standard CLI receives Graph only from approved injected server path; default stays Legacy',async()=>{
  let calls=0,stdout='',stderr='';
  const sample={profile:'standard',coverageGaps:[],requested:{},records:[],patterns:[]};
  const noResult=await runP69BoundQuery({
    argv:['--profile','standard','--surface','public-home','--job','landing',
      '--platform','web','--dimensions','visual','--no-record-usage'],
    env:{AGENTHUB_P70_DEPLOYMENT_MANIFEST:'/arbitrary/path',AGENTHUB_P69_DIAGNOSTICS:'1'},
    approvedProduction:async()=>null,probe:async()=>({signed_off:false}),
    query:async()=>({result:sample}),
    stdout:{write:s=>{stdout+=s;}},stderr:{write:s=>{stderr+=s;}},
  });
  assert.equal(noResult.mode,'legacy');
  assert.equal(JSON.parse(stdout).profile,'standard');
  stdout='';stderr='';
  const approved=await runP69BoundQuery({
    argv:['--profile','standard','--surface','public-home','--job','landing',
      '--platform','web','--dimensions','visual','--no-record-usage'],
    env:{AGENTHUB_P69_DIAGNOSTICS:'1'},
    approvedProduction:async()=>{calls++;return {result:sample,
      routing:{authoritative_source:'reference-graph'}};},
    probe:async()=>{throw Error('never consult LAB when authorized');},
    query:async()=>{throw Error('no double legacy call');},
    stdout:{write:s=>{stdout+=s;}},stderr:{write:s=>{stderr+=s;}},
  });
  assert.equal(approved.mode,'reference-graph');
  assert.equal(calls,1);
  assert.equal(JSON.parse(stdout).profile,'standard');
  assert.match(stderr,/P70_SIGNED_PRODUCTION_CANARY_GRAPH/);
});
