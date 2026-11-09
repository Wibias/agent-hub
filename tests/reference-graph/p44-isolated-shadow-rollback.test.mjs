import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRecords, loadPatterns } from '../../knowledge/design-references/scripts/lib.mjs';
import { runP11RuntimeQuery } from '../../reference-graph/p11-runtime-router.mjs';
import { createP44IsolatedShadowRollbackHarness } from '../../reference-graph/p44-isolated-shadow-rollback.mjs';

const records=loadRecords(), patterns=loadPatterns();
const request={profile:'standard',limit:12,surface:'public-home',
  platform:'web-responsive',job:'creator product landing page with clear primary CTA',
  dimensions:'visual-world,topology'};
const now=new Date('2026-11-09T18:00:00.000Z');
const scope={mode:'isolated-shadow-rehearsal',profiles:['standard','deep'],
  default_off:true,production_route_wiring:false};
const exact={status:'exact',record_order_exact:true,pattern_order_exact:true,
  authoritative_source:'legacy-control',activation_authorized:false,
  graph_runtime_activated:false};
const run=(h,o={})=>h.run({records,patterns,request,now,...o});

test('P44 disarmed by default: no probe and byte-compatible Legacy result',async()=>{
  let calls=0;
  const h=createP44IsolatedShadowRollbackHarness({shadowProbe:()=>{calls++;return exact;}});
  const baseline=await runP11RuntimeQuery({records,patterns,request,now,
    graphMode:'legacy',recordUsageEnabled:false});
  const r=await run(h);
  assert.equal(calls,0);
  assert.deepEqual(r.result,baseline.result);
  assert.deepEqual(r.routing,baseline.routing);
  assert.equal(r.shadow.production_graph_activated,false);
});

test('P44 isolated shadow exact retains Legacy output, single usage write and Quick isolation',async()=>{
  let probes=0,usage=0;
  const h=createP44IsolatedShadowRollbackHarness({shadowProbe:()=>{probes++;return exact;}});
  h.armForRehearsal(scope);
  const r=await run(h,{recordUsageEnabled:true,recordUsageFn:()=>usage++});
  const baseline=await runP11RuntimeQuery({records,patterns,request,now,
    graphMode:'legacy',recordUsageEnabled:false});
  assert.deepEqual(r.result,baseline.result);
  assert.equal(r.shadow.status,'exact');
  assert.equal(usage,1);
  assert.equal(probes,1);
  const quick=await run(h,{request:{...request,profile:'quick',limit:4}});
  assert.equal(quick.routing.authoritative_source,'legacy-control');
  assert.equal(quick.shadow.status,'off');
  assert.equal(probes,1);
});

test('P44 mismatch latches shadow off for all later Standard/Deep requests',async()=>{
  let probes=0;
  const h=createP44IsolatedShadowRollbackHarness({shadowProbe:()=>{
    probes++;return {...exact,pattern_order_exact:false};
  }});
  h.armForRehearsal(scope);
  const a=await run(h),b=await run(h);
  assert.equal(a.shadow.status,'blocked');
  assert.equal(a.shadow.reason,'parity-mismatch');
  assert.equal(a.shadow.local_kill_switch_latched,true);
  assert.equal(b.shadow.status,'off');
  assert.equal(probes,1);
  assert.throws(()=>h.armForRehearsal(scope),/cannot arm/);
});

test('P44 timeout, thrown secret error and manual revoke block without retry',async()=>{
  for(const mode of ['timeout','throw']){
    let probes=0;
    const h=createP44IsolatedShadowRollbackHarness({
      timeoutMs:20,
      shadowProbe:()=>{probes++;
        if(mode==='throw') throw Error('secret not for diagnostics');
        return new Promise(()=>{});
      },
    });
    h.armForRehearsal(scope);
    const r=await run(h);
    assert.equal(r.shadow.local_kill_switch_latched,true);
    assert.equal(r.shadow.reason,mode==='timeout'?'timeout':'http-error');
    assert.equal(JSON.stringify(r).includes('secret not for diagnostics'),false);
    await run(h);
    assert.equal(probes,1);
  }
  let probes=0;
  const h=createP44IsolatedShadowRollbackHarness({shadowProbe:()=>{probes++;return exact;}});
  h.armForRehearsal(scope);
  const revoked=h.revokeForRehearsal();
  await run(h);
  assert.equal(probes,0);
  assert.equal(revoked.activation_authorized,false);
  assert.equal(revoked.production_rollback_performed,false);
  assert.throws(()=>h.armForRehearsal(scope),/cannot arm/);
  assert.throws(()=>createP44IsolatedShadowRollbackHarness({
    shadowProbe:()=>exact,
  }).armForRehearsal({...scope,production_route_wiring:true}),/cannot arm/);
});


test('P44 manual revoke cancels an already running shadow and keeps Legacy output', async () => {
  let reached;
  const started = new Promise(resolve => { reached = resolve; });
  let aborts = 0, calls = 0;
  const h = createP44IsolatedShadowRollbackHarness({
    timeoutMs: 2000,
    shadowProbe: ({ signal }) => {
      calls++;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborts++;
          reject(new Error('cancelled'));
        }, { once: true });
        reached();
      });
    },
  });
  h.armForRehearsal(scope);
  const pending = run(h);
  await started;
  h.revokeForRehearsal();
  const result = await pending;
  assert.equal(calls, 1);
  assert.equal(aborts, 1);
  assert.equal(result.shadow.status, 'blocked');
  assert.equal(result.shadow.reason, 'manual-revoke');
  assert.equal(result.shadow.local_kill_switch_latched, true);
  assert.equal(result.routing.authoritative_source, 'legacy-control');
  await run(h);
  assert.equal(calls, 1);
});

test('P44 mismatch in one concurrent request cancels all other pending probes', async () => {
  let calls = 0, firstResolve, secondStarted;
  const started = new Promise(resolve => { secondStarted = resolve; });
  let aborts = 0;
  const h = createP44IsolatedShadowRollbackHarness({
    timeoutMs: 2000,
    shadowProbe: ({ signal }) => {
      calls++;
      if (calls === 1) return new Promise(resolve => { firstResolve = resolve; });
      secondStarted();
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborts++;
          reject(new Error('cancelled after mismatch'));
        }, { once: true });
      });
    },
  });
  h.armForRehearsal(scope);
  const one = run(h), two = run(h);
  await started;
  firstResolve({ ...exact, record_order_exact: false });
  const [a, b] = await Promise.all([one, two]);
  assert.equal(calls, 2);
  assert.equal(aborts, 1);
  assert.equal(a.shadow.status, 'blocked');
  assert.equal(b.shadow.status, 'blocked');
  assert.equal(h.status().local_kill_switch_latched, true);
  assert.equal(a.routing.authoritative_source, 'legacy-control');
  assert.equal(b.routing.authoritative_source, 'legacy-control');
});
