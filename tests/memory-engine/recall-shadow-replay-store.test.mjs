import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRecallShadowReplayPacket } from '../../memory-engine/recall-shadow-replay-packet.mjs';
import { RecallShadowReplayStore } from '../../memory-engine/recall-shadow-replay-store.mjs';

function root(){ return fs.mkdtempSync(path.join(os.tmpdir(),'agent-hub-shadow-store-')); }
function pkt(overrides={}){
  return createRecallShadowReplayPacket({
    projectId:'github.com/Wibias/agent-hub', branch:'main',
    sessionId:'s1', turnId:'t1', query:'memory health?',
    candidates:[{claim:{id:'c1',value:'doctor',state:'active'},authority:'user_direct',state:'active'}],
    fastResult:{route:'fast_v1',selected_ids:['c1'],duration_ms:20,failed:false},
    retrievalTelemetry:null,maxSelected:8,createdAt:'2026-10-14T00:30:00.000Z',
    ...overrides,
  });
}
function use(fn){
  const r=root();
  try{return fn(r)}finally{fs.rmSync(r,{recursive:true,force:true})}
}

test('capture creates all state dirs atomically and is idempotent',()=>{
  use(r=>{
    const s=new RecallShadowReplayStore({rootDir:r});
    const p=pkt();
    assert.equal(s.capture(p).status,'captured');
    assert.equal(s.capture(p).status,'exists');
    for(const d of ['pending','processing','failed','review'])
      assert.equal(fs.statSync(path.join(r,d)).isDirectory(),true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r,'pending',`${p.id}.json`),'utf8')),p);
    assert.equal(fs.readdirSync(path.join(r,'pending')).some(x=>x.endsWith('.tmp')),false);
    assert.deepEqual(s.counts(),{pending:1,processing:0,failed:0,review:0});
  });
});

test('same deterministic id with different content is rejected',()=>{
  use(r=>{
    const s=new RecallShadowReplayStore({rootDir:r});
    const p=pkt();
    s.capture(p);
    assert.throws(()=>s.capture({...p,query:'tampered'}),/collision|different packet/i);
  });
});

test('publish failure leaves no partial pending packet or temp file',()=>{
  use(r=>{
    const bad={...fs,renameSync(a,b){
      if(String(b).includes(`${path.sep}pending${path.sep}`)){
        const e=new Error('synthetic rename failure'); e.code='EACCES'; throw e;
      }
      return fs.renameSync(a,b);
    }};
    const s=new RecallShadowReplayStore({rootDir:r,fsOps:bad});
    const p=pkt();
    assert.throws(()=>s.capture(p),/synthetic rename failure/);
    assert.equal(fs.existsSync(path.join(r,'pending',`${p.id}.json`)),false);
    assert.equal(fs.readdirSync(path.join(r,'pending')).some(x=>x.includes('.tmp')),false);
  });
});

test('only one store instance can claim a packet',()=>{
  use(r=>{
    const a=new RecallShadowReplayStore({rootDir:r});
    const b=new RecallShadowReplayStore({rootDir:r});
    const p=pkt();
    a.capture(p);
    const claim=a.claimNext();
    assert.equal(claim.id,p.id);
    assert.deepEqual(claim.packet,p);
    assert.equal(claim.error,null);
    assert.equal(b.claimNext(),null);
    assert.deepEqual(a.counts(),{pending:0,processing:1,failed:0,review:0});
  });
});

test('release, complete, failed and review transitions work',()=>{
  use(r=>{
    const s=new RecallShadowReplayStore({rootDir:r});
    const a=pkt();
    s.capture(a); s.claimNext(); s.releaseToPending(a.id);
    assert.equal(s.counts().pending,1);
    s.claimNext(); s.moveToReview(a.id,{status:'fast_v1_mismatch'});
    assert.equal(s.counts().review,1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r,'review',`${a.id}.result.json`),'utf8')),{status:'fast_v1_mismatch'});

    const b=pkt({sessionId:'s2',turnId:'t2'});
    s.capture(b); s.claimNext(); s.moveToFailed(b.id,{status:'judge_unavailable'});
    assert.equal(s.counts().failed,1);

    const c=pkt({sessionId:'s3',turnId:'t3'});
    s.capture(c); s.claimNext(); s.complete(c.id);
    assert.equal(s.counts().processing,0);
  });
});

test('malformed claimed packet is surfaced without crashing later enumeration',()=>{
  use(r=>{
    const s=new RecallShadowReplayStore({rootDir:r}); s.counts();
    const bad='a'.repeat(64);
    fs.writeFileSync(path.join(r,'pending',`${bad}.json`),'{"broken":true}');

    const first=s.claimNext();
    assert.equal(first.id,bad);
    assert.equal(first.packet,null);
    assert.ok(first.error);
    s.moveToFailed(first.id,{status:'malformed_packet',error:first.error});

    const good=pkt({sessionId:'good',turnId:'good'});
    s.capture(good);
    const second=s.claimNext();
    assert.equal(second.id,good.id);
    assert.deepEqual(second.packet,good);
  });
});

test('stale processing recovery returns only old claims to pending',()=>{
  use(r=>{
    const now=Date.parse('2026-10-14T01:00:00.000Z');
    const s=new RecallShadowReplayStore({rootDir:r,clock:()=>new Date(now)});
    const a=pkt({sessionId:'a',turnId:'a'}), b=pkt({sessionId:'b',turnId:'b'});
    s.capture(a); s.capture(b);
    const ca=s.claimNext(), cb=s.claimNext();
    fs.utimesSync(path.join(r,'processing',`${ca.id}.json`),new Date(now-120000),new Date(now-120000));
    fs.utimesSync(path.join(r,'processing',`${cb.id}.json`),new Date(now-5000),new Date(now-5000));
    assert.deepEqual(s.recoverStaleProcessing({olderThanMs:60000}),{recovered:1,skipped:1});
    assert.deepEqual(s.counts(),{pending:1,processing:1,failed:0,review:0});
  });
});

test('failed cleanup deletes only old failed packets and never review',()=>{
  use(r=>{
    const now=Date.parse('2026-10-14T01:00:00.000Z');
    const s=new RecallShadowReplayStore({rootDir:r,clock:()=>new Date(now)});
    const old=pkt({sessionId:'old',turnId:'old'}), fresh=pkt({sessionId:'fresh',turnId:'fresh'}), rev=pkt({sessionId:'rev',turnId:'rev'});
    s.capture(old); s.claimNext(); s.moveToFailed(old.id,{error:'old'});
    s.capture(fresh); s.claimNext(); s.moveToFailed(fresh.id,{error:'fresh'});
    s.capture(rev); s.claimNext(); s.moveToReview(rev.id,{status:'fast_v1_mismatch'});
    for(const suffix of ['.json','.failure.json']){
      const oldPath=path.join(r,'failed',`${old.id}${suffix}`);
      fs.utimesSync(oldPath,new Date(now-120000),new Date(now-120000));

      const freshPath=path.join(r,'failed',`${fresh.id}${suffix}`);
      fs.utimesSync(freshPath,new Date(now-5000),new Date(now-5000));
    }
    assert.deepEqual(s.cleanupFailed({olderThanMs:60000}),{deleted:1,skipped:1});
    assert.equal(s.counts().failed,1);
    assert.equal(s.counts().review,1);
  });
});

test('counts ignores sidecars, temp files and unrelated files',()=>{
  use(r=>{
    const s=new RecallShadowReplayStore({rootDir:r}); s.counts();
    fs.writeFileSync(path.join(r,'pending','junk.txt'),'x');
    fs.writeFileSync(path.join(r,'pending','partial.tmp'),'x');
    fs.writeFileSync(path.join(r,'failed',`${'b'.repeat(64)}.failure.json`),'{}');
    assert.deepEqual(s.counts(),{pending:0,processing:0,failed:0,review:0});
  });
});