import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { buildP28OfflineProfileCandidatePool } from '../../reference-graph/p28-profile-candidate-contract.mjs';
import { observeP61ProtectedSnapshot } from '../../reference-graph/p61-protected-soak.mjs';
import { runP61OperatorProbe } from '../../reference-graph/cli/p61-observe-protected-transport.mjs';

const key = 'sb_secret_p61_synthetic_test_only';
const target = 'https://vrznfnxzlxaavpqbzbzd.supabase.co/';
const now = new Date('2026-11-07T11:32:00.000Z');
const candidates = buildP28OfflineProfileCandidatePool({
  records: loadRecords(), now: new Date('2026-11-07T00:00:00.000Z'),
});
const legacyHash = createHash('sha256')
  .update(candidates.map(x => x.legacy_id).sort().join('\n'))
  .digest('hex');
const witness = {
  schema_version: 'reference-graph.p40-readonly-source-witness.v1',
  source_method: 'p7-vs-p31-read-only',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  projection_version: 'reference-graph.profile-runtime.p30.v1',
  snapshot_date: '2026-11-07',
  refreshed_at: '2026-11-07T11:30:00.000Z',
  observed_at: '2026-11-07T11:31:00.000Z',
  expected_candidate_count: candidates.length,
  expected_candidate_id_set_sha256: legacyHash,
  published_candidate_count: candidates.length,
  published_candidate_id_set_sha256: legacyHash,
  membership_mismatch_count: 0,
  metadata_mismatch_count: 0,
  refresh_instant_count: 1,
  activation_authorized: false,
  repository_default_graph_enabled: false,
};
const raw = JSON.stringify(witness);
const digest = createHash('sha256').update(raw).digest('hex');
const rows = [...candidates].sort((a,b) =>
  a.asset_id.localeCompare(b.asset_id)).map(x => ({
  ...x,
  projection_version: 'reference-graph.profile-runtime.p30.v1',
  snapshot_date: '2026-11-07',
  refreshed_at: '2026-11-07T11:30:00+00:00',
}));
function input(overrides={}) {
  let tick = 0;
  return {
    sourceWitnessJson: raw, sourceWitnessSha256: digest,
    supabaseUrl: target, serviceKey: key,
    now: () => now,
    monotonicNow: () => tick++ * 35,
    ...overrides,
  };
}
function fakeHttp(calls) {
  return async (url, options) => {
    calls.push({url,options});
    assert.equal(new URL(url).pathname,
      '/rest/v1/reference_graph_profile_candidates_server_p30_v1');
    assert.equal(options.method,'GET');
    assert.equal(options.body,undefined);
    assert.equal(options.headers.apikey,key);
    assert.equal(options.redirect,'error');
    assert.equal(options.cache,'no-store');
    assert.equal(options.credentials,'omit');
    assert.equal(options.referrerPolicy,'no-referrer');
    const parsed=new URL(url);
    const offset=Number(parsed.searchParams.get('offset'));
    const limit=Number(parsed.searchParams.get('limit'));
    const page=rows.slice(offset,offset+limit);
    return {
      ok:true,status:206,
      headers:{get(k){
        return k.toLowerCase()==='content-range'
          ? offset+'-'+(offset+page.length-1)+'/'+rows.length : null;
      }},
      async json(){return page;},
    };
  };
}

test('P61 performs real P30 validator over bounded mocked GET; output is safe and non-authorizing',async()=>{
  const calls=[];
  const result=await observeP61ProtectedSnapshot(input({fetchImpl:fakeHttp(calls)}));
  assert.equal(result.schema_version,
    'reference-graph.p61-protected-readonly-observation.v1');
  assert.equal(result.server_only_transport_verified,true);
  assert.equal(result.candidate_count,candidates.length);
  assert.equal(result.http_get_requests,1);
  assert.equal(result.bounded_transport_elapsed_ms,35);
  for(const flag of [
    'source_provenance_independently_attested',
    'twenty_four_hour_soak_complete',
    'forty_eight_case_live_parity_attested',
    'production_rollback_rehearsed','activation_authorized',
    'repository_default_graph_enabled',
  ])assert.equal(result[flag],false);
  assert.doesNotMatch(JSON.stringify(result),
    /sb_secret_|search_text|legacy_id|asset_id|sourceWitnessJson|access_token/);
  assert.equal(calls.length,1);
});

test('P61 rejects unsigned, forged, expired, mis-scoped and non-server inputs before GET',async()=>{
  const changes=[
    {sourceWitnessSha256:'b'.repeat(64)},
    {sourceWitnessJson:raw+' '},
    {sourceWitnessJson:'{}',sourceWitnessSha256:
      createHash('sha256').update('{}').digest('hex')},
    {serviceKey:'sb_publishable_not_server'},
    {supabaseUrl:'https://other.supabase.co/'},
    {now:()=>new Date('2026-11-07T12:00:00.000Z')},
    {timeoutMs:60},
    {timeoutMs:11000},
  ];
  for(const change of changes){
    let calls=0;
    await assert.rejects(observeP61ProtectedSnapshot(input({
      ...change,fetchImpl:async()=>{calls++;throw Error('must not call');},
    })),/P61 protected read-only transport BLOCKED/);
    assert.equal(calls,0);
  }
});

test('P61 never forwards server key to a different URL or to a non-GET endpoint',async()=>{
  for(const [url,method] of [
    ['https://attacker.test/rest/v1/reference_graph_profile_candidates_server_p30_v1','GET'],
    [target+'rest/v1/reference_graph_profile_runtime_projection_p30_v1','GET'],
    [target+'rest/v1/reference_graph_profile_candidates_server_p30_v1','POST'],
  ]){
    let called=false;
    await assert.rejects(observeP61ProtectedSnapshot(input({
      fetchImpl:async()=>{called=true;return {ok:true};},
      transportFn:async cfg=>{
        await cfg.fetchImpl(url,{method,headers:{apikey:key}});
        return {transport:{}};
      },
    })),/BLOCKED/);
    assert.equal(called,false);
  }
});

test('P61 fails closed on changed refresh, invalid content pin, zero GET, expired final witness',async()=>{
  const validTransport = {
    candidate_count:candidates.length,
    candidate_id_set_sha256:legacyHash,
    refreshed_at:witness.refreshed_at,
  };
  for(const changed of [
    {candidate_count:candidates.length-1},
    {candidate_id_set_sha256:'a'.repeat(64)},
    {refreshed_at:'2026-11-07T11:35:00.000Z'},
  ]){
    await assert.rejects(observeP61ProtectedSnapshot(input({
      transportFn:async cfg=>{
        await cfg.fetchImpl(target+'rest/v1/reference_graph_profile_candidates_server_p30_v1',
          {method:'GET',headers:{apikey:key}});
        return {transport:{...validTransport,...changed}};
      },
      fetchImpl:async()=>({ok:true}),
    })),/BLOCKED/);
  }
  await assert.rejects(observeP61ProtectedSnapshot(input({
    transportFn:async()=>({transport:validTransport}),
  })),/BLOCKED/);
  let times=0;
  await assert.rejects(observeP61ProtectedSnapshot(input({
    now:()=>times++===0?now:new Date('2026-11-07T12:01:00.000Z'),
    transportFn:async cfg=>{
      await cfg.fetchImpl(target+'rest/v1/reference_graph_profile_candidates_server_p30_v1',
        {method:'GET',headers:{apikey:key}});
      return {transport:validTransport};
    },
    fetchImpl:async()=>({ok:true}),
  })),/BLOCKED/);
});

test('P61 CLI rejects missing credentials; outputs only the sanitized report with injected probe',async()=>{
  const argv=['--witness-file','private/witness.json','--witness-sha256',digest];
  await assert.rejects(runP61OperatorProbe({
    argv,env:{},readText:()=>raw,stdout:{write(){throw Error('unexpected');}},
  }),/BLOCKED/);
  let output='';
  const expected={schema_version:'reference-graph.p61-protected-readonly-observation.v1',
    activation_authorized:false};
  const ret=await runP61OperatorProbe({
    argv,env:{P40_SUPABASE_SECRET_KEY:key},readText:()=>raw,
    observe:async arg=>{
      assert.equal(arg.serviceKey,key);
      assert.equal(arg.sourceWitnessSha256,digest);
      return expected;
    },
    stdout:{write(s){output+=s;}},
  });
  assert.deepEqual(ret,expected);
  assert.equal(output,JSON.stringify(expected)+'\n');
  assert.doesNotMatch(output,/sb_secret_|sourceWitnessJson/);
});

test('P61 forbids following a redirect that might leak the custom apikey header',async()=>{
  const observed=[];
  await assert.rejects(observeP61ProtectedSnapshot(input({
    fetchImpl:async (url,options)=>{
      observed.push({url,redirect:options.redirect});
      return {ok:false,status:302,headers:{get:()=>null}};
    },
  })),/BLOCKED/);
  assert.equal(observed.length,1);
  assert.equal(observed[0].redirect,'error');
  assert.equal(new URL(observed[0].url).origin,new URL(target).origin);
});
