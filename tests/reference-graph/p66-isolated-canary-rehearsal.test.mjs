import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadPatterns, loadRecords, TAXONOMY } from '../../knowledge/design-references/scripts/lib.mjs';
import { buildP28OfflineProfileCandidatePool } from '../../reference-graph/p28-profile-candidate-contract.mjs';
import { runP11RuntimeQuery } from '../../reference-graph/p11-runtime-router.mjs';
import { constructP66GraphPublicResult } from '../../reference-graph/p66-graph-public-output.mjs';
import { createP66CanaryRehearsal } from '../../reference-graph/p66-isolated-canary-rehearsal.mjs';

const commit = '6de6795f7f07a954958319f41d45225351bf6bf1';
const project = 'vrznfnxzlxaavpqbzbzd';
const records = loadRecords(), patterns = loadPatterns();
const now = new Date('2026-11-11T06:31:00.000Z');
const refreshed = '2026-11-11T06:30:00.000Z';
const candidates = buildP28OfflineProfileCandidatePool({
  records, now: new Date('2026-11-11T00:00:00.000Z'),
});
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const idHash = digest(candidates.map(row => row.legacy_id).sort().join('\n'));
const witness = JSON.stringify({
  schema_version: 'reference-graph.p40-readonly-source-witness.v1',
  source_method: 'p7-vs-p31-read-only',
  project_ref: project, projection_version: 'reference-graph.profile-runtime.p30.v1',
  snapshot_date: '2026-11-11', refreshed_at: refreshed,
  observed_at: '2026-11-11T06:30:30.000Z',
  expected_candidate_count: candidates.length, expected_candidate_id_set_sha256: idHash,
  published_candidate_count: candidates.length, published_candidate_id_set_sha256: idHash,
  membership_mismatch_count: 0, metadata_mismatch_count: 0,
  refresh_instant_count: 1, activation_authorized: false,
  repository_default_graph_enabled: false,
});
const scope = {
  mode: 'isolated-production-like-canary-rehearsal',
  project_ref: project, source_commit_sha: commit,
  profiles: ['standard', 'deep'],
  default_off: true, production_route_wiring: false,
  canary_percent: 5, cohort_salt: 'a'.repeat(32),
};
const templates = JSON.parse(readFileSync('reference-graph/shadow-cases.json', 'utf8'));
const requestFor = (profile='standard', template=templates[0]) => ({
  profile, limit: TAXONOMY.profiles[profile].default,
  surface: template.surface, platform: template.platform,
  job: template.job, dimensions: template.dimensions,
});
const request = requestFor();
const args = (overrides = {}) => ({
  records, patterns, request, now, requestKey: eligibleKey, ...overrides,
});
const legacy = req => runP11RuntimeQuery({
  records, patterns, request: req, now, graphMode: 'legacy',
  recordUsageEnabled: false,
});
function chooseKey(eligible) {
  for(let i=0;i<3000;i++) {
    const key = 'operator-rehearsal-' + String(i).padStart(5,'0');
    const h = digest('reference-graph.p66-cohort.v1\\n' + scope.cohort_salt + '\\n' + key);
    const selected = Number.parseInt(h.slice(0,8),16) / 0x100000000 < scope.canary_percent/100;
    if (selected === eligible) return key;
  }
  throw Error('P66 test cohort key not found');
}
const eligibleKey=chooseKey(true), excludedKey=chooseKey(false);
function make(options={}) {
  const calls = { fetch:0 };
  const adapter=createP66CanaryRehearsal({
    checkoutSha:commit, sourceWitnessJson:witness,
    sourceWitnessSha256:digest(witness), serviceKey:'sb_secret_p66_mock_only',
    fetchCandidates: async input => {
      calls.fetch++;
      assert.equal(input.accessMode, 'server');
      assert.equal(input.expectedCandidateCount, candidates.length);
      assert.equal(input.expectedCandidateIdSetSha256, idHash);
      return {candidates,transport:{refreshed_at:refreshed}};
    },
    ...options,
  });
  return {adapter,calls};
}

test('P66 default OFF, no network, unchanged authentic P11 public JSON', async()=>{
  const {adapter,calls}=make();
  const baseline=await legacy(request);
  const result=await adapter.run(args());
  assert.deepEqual(result.result,baseline.result);
  assert.deepEqual(result.routing,baseline.routing);
  assert.equal(result.canary.status,'off');
  assert.equal(calls.fetch,0);
  assert.equal(adapter.status().production_graph_activated,false);
});

test('P66 requires a precise 1-5% isolated, source-bound grant and never accepts Quick', async()=>{
  const {adapter}=make();
  const bad=[
    {...scope,canary_percent:6},{...scope,canary_percent:0},
    {...scope,source_commit_sha:'f'.repeat(40)},
    {...scope,project_ref:'other'},{...scope,default_off:false},
    {...scope,production_route_wiring:true},{...scope,profiles:['quick']},
    {...scope,profiles:['standard','standard']},
    {...scope,mode:'production'},
    {...scope,cohort_salt:'short'},
  ];
  for(const grant of bad) assert.throws(()=>adapter.armForRehearsal(grant),/scope rejected/);
  adapter.armForRehearsal(scope);
  assert.throws(()=>adapter.armForRehearsal(scope),/cannot arm/);
  await assert.rejects(adapter.run(args({request:requestFor('quick')})),/Standard\/Deep/);
});

test('P66 selected 5% Graph output is distinct, exact and actually authoritative in isolated canary',async()=>{
  const {adapter,calls}=make();
  adapter.armForRehearsal(scope);
  const [a,control]=await Promise.all([adapter.run(args()),legacy(request)]);
  assert.equal(calls.fetch,1);
  assert.equal(a.canary.status,'graph');
  assert.equal(a.routing.authoritative_source,'reference-graph');
  assert.notStrictEqual(a.result,control.result);
  assert.deepEqual(a.result,control.result);
  assert.equal(a.canary.production_graph_activated,false);
  assert.equal(a.canary.production_rollback_performed,false);
});

test('P66 excludes non-cohort requests and suppresses their protected GET',async()=>{
  const {adapter,calls}=make();
  adapter.armForRehearsal(scope);
  const a=await adapter.run(args({requestKey:excludedKey}));
  assert.equal(a.canary.status,'not-selected');
  assert.equal(a.routing.authoritative_source,'legacy-control');
  assert.equal(calls.fetch,0);
});

test('P66 graph output algorithm matches all 48 Standard/Deep public Legacy controls',async()=>{
  let total=0;
  for(const t of templates) for(const profile of ['standard','deep']) {
    const req=requestFor(profile,t);
    const graph=constructP66GraphPublicResult({
      candidates,records,patterns,request:req,now,
    });
    const control=await legacy(req);
    assert.deepEqual(graph,control.result,t.id+':'+profile);
    total++;
  }
  assert.equal(total,48);
});

test('P66 full-JSON mismatch latches OFF and switches subsequent traffic to Legacy',async()=>{
  const {adapter,calls}=make({
    graphOutput(input) {
      const original=constructP66GraphPublicResult(input);
      return {...original,usageWarning:'tampered'};
    },
  });
  adapter.armForRehearsal(scope);
  const result=await adapter.run(args());
  assert.equal(result.routing.authoritative_source,'legacy-control');
  assert.equal(result.canary.status,'legacy-fallback');
  assert.equal(adapter.status().local_kill_switch_latched,true);
  const next=await adapter.run(args());
  assert.equal(next.canary.status,'off');
  assert.equal(calls.fetch,1);
  assert.throws(()=>adapter.armForRehearsal(scope),/cannot arm/);
});

test('P66 fails closed for source pin mismatch, fetch error and timeout',async()=>{
  for(const type of ['pin','error','timeout']) {
    let calls=0;
    const override=type==='pin' ? {sourceWitnessSha256:'f'.repeat(64)}
      : {fetchCandidates:async()=>{
          calls++;
          if(type==='error') throw Error('privileged secret not for output');
          return new Promise(()=>{});
        },timeoutMs:30};
    const {adapter}=make(override);
    adapter.armForRehearsal(scope);
    const output=await adapter.run(args());
    assert.equal(output.routing.authoritative_source,'legacy-control');
    assert.equal(output.canary.status,'legacy-fallback');
    assert.equal(output.canary.local_kill_switch_latched,true);
    assert.equal(JSON.stringify(output).includes('privileged secret'),false);
    await adapter.run(args());
    assert.equal(calls, type==='pin'?0:1);
  }
});

test('P66 manual revoke aborts in-flight candidate transport and restart returns OFF',async()=>{
  let entered;
  const started=new Promise(resolve=>{entered=resolve});
  let fetches=0;
  const {adapter}=make({
    fetchCandidates:async ()=>{
      fetches++;
      entered();
      return new Promise(resolve=>setTimeout(
        ()=>resolve({candidates,transport:{refreshed_at:refreshed}}),30));
    },
  });
  adapter.armForRehearsal(scope);
  const pending=adapter.run(args());
  await started;
  adapter.revokeForRehearsal();
  const result=await pending;
  assert.equal(result.routing.authoritative_source,'legacy-control');
  assert.equal(result.canary.local_kill_switch_latched,true);
  await adapter.run(args());
  assert.equal(fetches,1);
  const {adapter:restarted,calls}=make();
  const again=await restarted.run(args());
  assert.equal(again.canary.status,'off');
  assert.equal(calls.fetch,0);
});

test('P66 can use actual P30 GET pagination with a mocked server-only HTTP response',async()=>{
  const rows=[...candidates].sort((a,b)=>a.asset_id.localeCompare(b.asset_id))
    .map(row=>({...row,projection_version:'reference-graph.profile-runtime.p30.v1',
      snapshot_date:'2026-11-11',refreshed_at:'2026-11-11T06:30:00+00:00'}));
  let gets=0;
  const adapter=createP66CanaryRehearsal({
    checkoutSha:commit,sourceWitnessJson:witness,
    sourceWitnessSha256:digest(witness),serviceKey:'sb_secret_p66_mock_only',
    fetchImpl:async(url,options)=>{
      gets++;
      assert.equal(new URL(url).pathname,
        '/rest/v1/reference_graph_profile_candidates_server_p30_v1');
      assert.equal(options.method,'GET');
      assert.equal(options.body,undefined);
      assert.equal(options.headers.apikey,'sb_secret_p66_mock_only');
      assert.equal(options.signal.aborted,false);
      const u=new URL(url),offset=Number(u.searchParams.get('offset'));
      const limit=Number(u.searchParams.get('limit'));
      const page=rows.slice(offset,offset+limit);
      return {ok:true,status:206,headers:{get:k=>k.toLowerCase()==='content-range'
        ? `${offset}-${offset+page.length-1}/${rows.length}` : null},
        json:async()=>page};
    },
  });
  adapter.armForRehearsal(scope);
  const response=await adapter.run(args());
  assert.equal(response.routing.authoritative_source,'reference-graph');
  assert.equal(response.canary.status,'graph');
  assert.ok(gets>=1);
});

test('P66 cannot wire itself into P11 or the public CLI; no production side effects',()=>{
  const adapter=readFileSync('reference-graph/p66-isolated-canary-rehearsal.mjs','utf8');
  const router=readFileSync('reference-graph/p11-runtime-router.mjs','utf8');
  const cli=readFileSync('knowledge/design-references/scripts/query.mjs','utf8');
  assert.doesNotMatch(router,/p66-isolated-canary-rehearsal/);
  assert.doesNotMatch(cli,/p66-isolated-canary-rehearsal|P40_SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(adapter,/writeFile|process\.env|recordUsageFn|apply_migration/);
});
