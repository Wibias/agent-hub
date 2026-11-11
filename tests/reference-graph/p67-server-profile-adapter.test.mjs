import assert from 'node:assert/strict';
import { createHash, createHmac, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadPatterns, loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { buildP28OfflineProfileCandidatePool } from '../../reference-graph/p28-profile-candidate-contract.mjs';
import { runP11RuntimeQuery } from '../../reference-graph/p11-runtime-router.mjs';
import {
  createP67SharedStateVerifier, createP67HttpsStateReader, createP67ServerProfileAdapter,
} from '../../reference-graph/p67-server-profile-adapter.mjs';

const sha = '320be65001fde72f9d0175baaa490f5f40fb12b2';
const now = new Date('2026-11-11T08:30:00.000Z');
const refreshed = '2026-11-11T08:25:00.000Z';
const records = loadRecords(), patterns = loadPatterns();
const req = {
  profile: 'standard', limit: 12, surface: 'public-home', platform: 'web-responsive',
  job: 'creator product landing page with clear primary CTA',
  dimensions: 'visual-world,topology',
};
const candidates = buildP28OfflineProfileCandidatePool({
  records, now: new Date('2026-11-11T00:00:00.000Z'),
});
const hash = x => createHash('sha256').update(x, 'utf8').digest('hex');
const idHash = hash(candidates.map(c => c.legacy_id).sort().join('\n'));
const witness = JSON.stringify({
  schema_version: 'reference-graph.p40-readonly-source-witness.v1',
  source_method: 'p7-vs-p31-read-only',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  projection_version: 'reference-graph.profile-runtime.p30.v1',
  snapshot_date: '2026-11-11', refreshed_at: refreshed,
  observed_at: '2026-11-11T08:29:00.000Z',
  expected_candidate_count: candidates.length,
  expected_candidate_id_set_sha256: idHash,
  published_candidate_count: candidates.length,
  published_candidate_id_set_sha256: idHash,
  membership_mismatch_count: 0, metadata_mismatch_count: 0,
  refresh_instant_count: 1,
  activation_authorized: false,
  repository_default_graph_enabled: false,
});

function coordinator() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString('utf8');
  const fingerprint = hash(publicKey.export({ type: 'spki', format: 'der' }));
  const shared = {
    status: 'canary', generation: 1, profiles: ['standard','deep'],
    canary_percent: 5, cohort_salt: 'ab'.repeat(16),
    issued_at: now.toISOString(),
    expires_at: new Date(now.valueOf() + 6000).toISOString(),
  };
  let readCount = 0;
  function envelope(nonce, patch = {}) {
    const payload_json = JSON.stringify({
      schema_version: 'reference-graph.p67-shared-state.v1',
      repository_sha: sha, project_ref: 'vrznfnxzlxaavpqbzbzd', nonce,
      ...shared, ...patch,
    });
    return {
      payload_json,
      signature_base64: sign(null, Buffer.from(payload_json), privateKey).toString('base64'),
    };
  }
  const readSharedState = async ({ nonce }) => {
    readCount++;
    return envelope(nonce);
  };
  return {
    pem, fingerprint, shared, envelope, readSharedState,
    get reads() { return readCount; },
    revoke() {
      shared.status = 'off';
      shared.canary_percent = 0;
      shared.profiles = [];
      shared.generation++;
    },
  };
}
function chosenKey(salt, percentage, included) {
  for (let i=0;i<8000;i++) {
    const key = 'server-trusted-key-' + String(i).padStart(5, '0');
    const bytes = createHmac('sha256', Buffer.from(salt, 'hex')).update(key).digest();
    const found = bytes.readUInt32BE(0) / 0x100000000 < percentage / 100;
    if (found === included) return key;
  }
  throw Error('no cohort key found');
}
function adapter(c, patch={}) {
  let gets = 0, usages = 0;
  const instance = createP67ServerProfileAdapter({
    repositorySha:sha, trustedPublicKeyPem:c.pem,
    trustedPublicKeySha256:c.fingerprint,
    clock:()=>now,
    readSharedState:c.readSharedState,
    getWitness:async()=>({json:witness,sha256:hash(witness)}),
    serviceKey:'sb_secret_p67_fixture_not_real',
    fetchCandidates:async options=>{
      gets++;
      assert.equal(options.accessMode,'server');
      assert.equal(options.expectedCandidateCount,candidates.length);
      return { candidates, transport:{refreshed_at:refreshed} };
    },
    ...patch,
  });
  return {
    instance,
    get gets() { return gets; },
    get usages() { return usages; },
    run: (args={})=>instance.run({
      records, patterns, request:req,
      requestKey:chosenKey(c.shared.cohort_salt,5,true),
      now,recordUsageEnabled:true,recordUsageFn:()=>{usages++;}, ...args,
    }),
  };
}

test('P67 requires a pre-pinned trusted Ed25519 signing key and a shared state reader',()=>{
  const c=coordinator();
  assert.throws(()=>createP67SharedStateVerifier({
    repositorySha:sha,trustedPublicKeyPem:c.pem,
    trustedPublicKeySha256:'0'.repeat(64),
  }),/key rejected/);
  assert.throws(()=>createP67ServerProfileAdapter({
    repositorySha:sha,trustedPublicKeyPem:c.pem,
    trustedPublicKeySha256:c.fingerprint,
    serviceKey:'sb_secret_unit',
  }),/prerequisites/);
});

test('P67 signed state is project, revision, nonce, generation, scope and freshness bound',()=>{
  const c=coordinator();
  const verifier=createP67SharedStateVerifier({
    repositorySha:sha,trustedPublicKeyPem:c.pem,
    trustedPublicKeySha256:c.fingerprint,clock:()=>now,
  });
  const nonce='f'.repeat(32);
  assert.equal(verifier.verify(c.envelope(nonce),nonce).status,'canary');
  for(const patch of [
    {repository_sha:'f'.repeat(40)}, {project_ref:'wrong'},
    {nonce:'0'.repeat(32)}, {profiles:['quick']}, {canary_percent:9},
    {issued_at:new Date(now.valueOf()-7000).toISOString()},
    {expires_at:new Date(now.valueOf()+20000).toISOString()},
    {status:'production'},
  ]) assert.throws(()=>verifier.verify(c.envelope(nonce,patch),nonce));
  const wrong={...c.envelope(nonce),payload_json:'{}'};
  assert.throws(()=>verifier.verify(wrong,nonce),/signature/);
});

test('P67 default-off shared state and excluded cohort both preserve P11 Legacy without a Graph GET',async()=>{
  const c=coordinator(), a=adapter(c);
  const baseline=await runP11RuntimeQuery({
    records,patterns,request:req,now,graphMode:'legacy',recordUsageEnabled:false,
  });
  c.revoke();
  const off=await a.run();
  assert.deepEqual(off.result,baseline.result);
  assert.equal(off.routing.authoritative_source,'legacy-control');
  assert.equal(a.gets,0);
  assert.equal(a.usages,1);
  assert.equal(off.canary.status,'legacy');
  const c2=coordinator(), b=adapter(c2);
  const excluded=await b.run({requestKey:chosenKey(c2.shared.cohort_salt,5,false)});
  assert.deepEqual(excluded.result,baseline.result);
  assert.equal(b.gets,0);
  assert.equal(b.usages,1);
});

test('P67 chosen 5% returns distinct real Graph-generated public JSON, authentic P11 recorded once',async()=>{
  const c=coordinator(), a=adapter(c);
  const baseline=await runP11RuntimeQuery({
    records,patterns,request:req,now,graphMode:'legacy',recordUsageEnabled:false,
  });
  const result=await a.run();
  assert.equal(a.gets,1);
  assert.equal(a.usages,1);
  assert.notStrictEqual(result.result,baseline.result);
  assert.deepEqual(result.result,baseline.result);
  assert.equal(result.routing.authoritative_source,'reference-graph');
  assert.equal(result.canary.status,'graph');
  assert.equal(result.canary.production_default_graph_enabled,false);
  assert.ok(c.reads>=2);
});

test('P67 shared revoke blocks two independent server workers and persists across new instances',async()=>{
  const c=coordinator();
  const a=adapter(c), b=adapter(c);
  assert.equal((await a.run()).routing.authoritative_source,'reference-graph');
  assert.equal((await b.run()).routing.authoritative_source,'reference-graph');
  c.revoke();
  assert.equal((await a.run()).routing.authoritative_source,'legacy-control');
  assert.equal((await b.run()).routing.authoritative_source,'legacy-control');
  assert.equal(a.gets,1);assert.equal(b.gets,1);
  const fresh=adapter(c);
  assert.equal((await fresh.run()).routing.authoritative_source,'legacy-control');
  assert.equal(fresh.gets,0);
});

test('P67 revocation during in-flight P30 fetch aborts even an adapter ignoring AbortSignal',async()=>{
  const c=coordinator();
  let started;
  const began=new Promise(resolve=>{started=resolve});
  const a=adapter(c,{
    statePollMs:50,fetchCandidates: async()=>{started();return new Promise(()=>{});},
  });
  const pending=a.run();
  await began;
  c.revoke();
  const output=await Promise.race([
    pending,new Promise((_resolve,reject)=>setTimeout(()=>reject(Error('P67 did not return')),2000)),
  ]);
  assert.equal(output.routing.authoritative_source,'legacy-control');
  assert.equal(output.canary.local_kill_switch_latched,true);
  assert.equal(a.instance.status().local_kill_switch_latched,true);
});

test('P67 mismatch latches off and never attempts another Graph GET',async()=>{
  const c=coordinator();
  let gets=0;
  // Deliberately wrong public output must fail closed.
  const x=adapter(c,{
    graphOutput:()=>({profile:'wrong',records:[],patterns:[]}),
    fetchCandidates:async()=>{gets++;return{candidates,transport:{refreshed_at:refreshed}};},
  });
  const first=await x.run(),second=await x.run();
  assert.equal(first.routing.authoritative_source,'legacy-control');
  assert.equal(first.canary.local_kill_switch_latched,true);
  assert.equal(second.routing.authoritative_source,'legacy-control');
  assert.equal(gets,1);
  assert.equal(x.usages,2);
});

test('P67 invalid source hash and coordinator error latch OFF without exposing secret error',async()=>{
  const c=coordinator();
  const a=adapter(c,{getWitness:async()=>({json:witness,sha256:'0'.repeat(64)})});
  assert.equal((await a.run()).routing.authoritative_source,'legacy-control');
  assert.equal(a.instance.status().local_kill_switch_latched,true);
  const b=adapter(c,{readSharedState:async()=>{throw Error('secret token must stay private');}});
  const response=await b.run();
  assert.equal(response.routing.authoritative_source,'legacy-control');
  assert.equal(JSON.stringify(response).includes('secret token must stay private'),false);
});

test('P67 HTTPS state reader enforces TLS, no redirect, GET and bounded protected request',async()=>{
  assert.throws(()=>createP67HttpsStateReader({
    endpoint:'http://example.test/state',readToken:'r'.repeat(40),
  }),/configuration/);
  let calls=0;
  const read=createP67HttpsStateReader({
    endpoint:'https://coordinator.example.test/state',
    readToken:'r'.repeat(40),
    fetchImpl:async(url,options)=>{
      calls++;
      assert.equal(url,'https://coordinator.example.test/state');
      assert.equal(options.method,'GET'); assert.equal(options.redirect,'error');
      assert.equal(options.cache,'no-store');
      assert.equal(options.headers.Authorization,'Bearer '+'r'.repeat(40));
      assert.equal(options.headers['X-P67-Nonce'],'a'.repeat(32));
      return {ok:true,status:200,text:async()=>JSON.stringify({payload_json:'x',signature_base64:'y'})};
    },
  });
  assert.deepEqual(await read({nonce:'a'.repeat(32)}),{payload_json:'x',signature_base64:'y'});
  assert.equal(calls,1);
});

test('P67 is not wired into existing public P11, CLI or Quick route',()=>{
  const router=readFileSync('reference-graph/p11-runtime-router.mjs','utf8');
  const cli=readFileSync('knowledge/design-references/scripts/query.mjs','utf8');
  assert.doesNotMatch(router,/p67-server-profile-adapter/);
  assert.doesNotMatch(cli,/p67-server-profile-adapter|P40_SUPABASE_SECRET_KEY/);
});
