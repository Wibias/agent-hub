import * as nodeFs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { validateRecallShadowReplayPacket } from './recall-shadow-replay-packet.mjs';

const STATES=['pending','processing','failed','review'];
const ID=/^[a-f0-9]{64}$/;
const PACKET=/^[a-f0-9]{64}\.json$/;

function id(v){ if(typeof v!=='string'||!ID.test(v)) throw new TypeError('invalid replay packet id'); return v; }
function age(v,n){ if(!Number.isFinite(v)||v<0) throw new RangeError(`${n} must be non-negative`); return Math.trunc(v); }
function safe(v,n='metadata'){
  try{const s=JSON.stringify(v); if(s===undefined) throw new Error(); return JSON.parse(s)}
  catch{throw new TypeError(`${n} must be JSON-safe and non-cyclic`)}
}
function canonical(p){return JSON.stringify(validateRecallShadowReplayPacket(p))}

export class RecallShadowReplayStore{
  constructor({rootDir,clock=()=>new Date(),fsOps=nodeFs}={}){
    if(typeof rootDir!=='string'||!rootDir.trim()) throw new TypeError('rootDir must be non-empty');
    if(typeof clock!=='function') throw new TypeError('clock must be a function');
    this.rootDir=path.resolve(rootDir); this.clock=clock; this.fs=fsOps;
  }
  dir(s){if(!STATES.includes(s))throw new TypeError('unsupported replay state');return path.join(this.rootDir,s)}
  file(s,i){return path.join(this.dir(s),`${id(i)}.json`)}
  ensure(){this.fs.mkdirSync(this.rootDir,{recursive:true});for(const s of STATES)this.fs.mkdirSync(this.dir(s),{recursive:true})}
  entries(s){this.ensure();return this.fs.readdirSync(this.dir(s),{withFileTypes:true}).filter(e=>e.isFile()&&PACKET.test(e.name)).map(e=>e.name).sort()}
  read(p){return validateRecallShadowReplayPacket(JSON.parse(this.fs.readFileSync(p,'utf8')))}
  atomic(finalPath,value){
    const tmp=path.join(path.dirname(finalPath),`.${path.basename(finalPath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
    let fd=null;
    try{
      fd=this.fs.openSync(tmp,'wx');
      this.fs.writeFileSync(fd,`${JSON.stringify(value,null,2)}\n`,'utf8');
      if(typeof this.fs.fsyncSync==='function')this.fs.fsyncSync(fd);
      this.fs.closeSync(fd); fd=null;
      this.fs.renameSync(tmp,finalPath);
    }catch(e){
      if(fd!==null){try{this.fs.closeSync(fd)}catch{}}
      try{this.fs.unlinkSync(tmp)}catch{}
      throw e;
    }
  }
  capture(packet){
    const p=validateRecallShadowReplayPacket(packet); this.ensure();
    const target=this.file('pending',p.id);
    if(this.fs.existsSync(target)){
      if(canonical(this.read(target))!==canonical(p))throw new Error(`replay packet id collision: different packet for ${p.id}`);
      return {status:'exists',id:p.id,path:target};
    }
    try{this.atomic(target,p)}
    catch(e){
      if(this.fs.existsSync(target)&&canonical(this.read(target))===canonical(p))return {status:'exists',id:p.id,path:target};
      throw e;
    }
    return {status:'captured',id:p.id,path:target};
  }
  claimNext(){
    for(const name of this.entries('pending')){
      const i=name.slice(0,-5), from=this.file('pending',i), to=this.file('processing',i);
      try{this.fs.renameSync(from,to)}
      catch(e){if(['ENOENT','EEXIST','EPERM'].includes(e?.code))continue;throw e}
      try{return {id:i,packet:this.read(to),error:null,path:to}}
      catch(e){return {id:i,packet:null,error:e instanceof Error?e.message:String(e),path:to}}
    }
    return null;
  }
  releaseToPending(i){
    this.ensure(); i=id(i); const from=this.file('processing',i),to=this.file('pending',i);
    if(!this.fs.existsSync(from))throw new Error(`processing replay packet does not exist: ${i}`);
    if(this.fs.existsSync(to))throw new Error(`pending replay packet already exists: ${i}`);
    this.fs.renameSync(from,to); return {id:i,state:'pending',path:to};
  }
  complete(i){
    this.ensure(); i=id(i); const f=this.file('processing',i);
    if(!this.fs.existsSync(f))throw new Error(`processing replay packet does not exist: ${i}`);
    this.fs.unlinkSync(f); return {id:i,state:'completed'};
  }
  moveToReview(i,m={}){return this.move(i,'review','.result.json',m)}
  moveToFailed(i,m={}){return this.move(i,'failed','.failure.json',m)}
  move(i,state,suffix,meta){
    this.ensure(); i=id(i); const m=safe(meta);
    const from=this.file('processing',i),to=this.file(state,i),side=path.join(this.dir(state),`${i}${suffix}`);
    if(!this.fs.existsSync(from))throw new Error(`processing replay packet does not exist: ${i}`);
    if(this.fs.existsSync(to))throw new Error(`${state} replay packet already exists: ${i}`);
    this.fs.renameSync(from,to);
    try{this.atomic(side,m)}catch(e){try{this.fs.renameSync(to,from)}catch{};throw e}
    return {id:i,state,path:to,sidecar:side};
  }
  nowMs(){const v=this.clock();const n=v instanceof Date?v.getTime():Number(v);if(!Number.isFinite(n))throw new TypeError('clock must return valid time');return n}
  recoverStaleProcessing({olderThanMs}={}){
    olderThanMs=age(olderThanMs,'olderThanMs');const now=this.nowMs();let recovered=0,skipped=0;
    for(const name of this.entries('processing')){
      const i=name.slice(0,-5),from=this.file('processing',i),to=this.file('pending',i);
      if(now-this.fs.statSync(from).mtimeMs<olderThanMs||this.fs.existsSync(to)){skipped++;continue}
      try{this.fs.renameSync(from,to);recovered++}catch(e){if(e?.code==='ENOENT'){skipped++;continue}throw e}
    }
    return {recovered,skipped};
  }
  cleanupFailed({olderThanMs}={}){
    olderThanMs=age(olderThanMs,'olderThanMs');const now=this.nowMs();let deleted=0,skipped=0;
    for(const name of this.entries('failed')){
      const i=name.slice(0,-5),f=this.file('failed',i);
      if(now-this.fs.statSync(f).mtimeMs<olderThanMs){skipped++;continue}
      this.fs.unlinkSync(f);
      try{this.fs.unlinkSync(path.join(this.dir('failed'),`${i}.failure.json`))}catch(e){if(e?.code!=='ENOENT')throw e}
      deleted++;
    }
    return {deleted,skipped};
  }
  counts(){return Object.fromEntries(STATES.map(s=>[s,this.entries(s).length]))}
}