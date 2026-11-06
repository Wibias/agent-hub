#!/usr/bin/env node
/**
 * D12.3 explicit, read-only promotion eligibility check.
 * No claims, stages, candidates or user data are written or printed.
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectAtomicPromotionPreflight } from '../memory-engine/memory-atomic-promotion-preflight.mjs';

export function parseAtomicPromotionPreflightArgs(argv = []) {
  const parsed={dbPath:null,projectId:null,branch:null,stageId:null};
  const seen=new Set();
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];
    if(!['--db-path','--project-id','--branch','--stage-id'].includes(flag)
      || seen.has(flag)) throw new Error('unsupported or duplicate argument');
    seen.add(flag);
    const value=argv[++i];
    if(typeof value!=='string' || !value.trim())throw new Error('missing argument');
    if(flag==='--db-path')parsed.dbPath=resolve(value);
    else if(flag==='--project-id')parsed.projectId=value.trim();
    else if(flag==='--branch')parsed.branch=value.trim();
    else if(!/^atomic-stage-[0-9a-f]{24}$/u.test(value)){
      throw new Error('invalid staged rule reference');
    }else parsed.stageId=value;
  }
  if(Object.values(parsed).some(v=>v===null))throw new Error('exact scope and stage are required');
  return parsed;
}

export function runAtomicPromotionPreflight({
  dbPath,projectId,branch,stageId,
  openDb=path=>new DatabaseSync(path,{readOnly:true,timeout:5000}),
}={}) {
  if([dbPath,projectId,branch,stageId].some(v=>typeof v!=='string'||!v.trim())){
    throw new Error('exact scope required');
  }
  const db=openDb(dbPath);
  try{
    return inspectAtomicPromotionPreflight({db,projectId,branch,stageId});
  }finally{
    db.close();
  }
}

const main=process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if(main===import.meta.url){
  try{
    const report=runAtomicPromotionPreflight(
      parseAtomicPromotionPreflightArgs(process.argv.slice(2)),
    );
    console.log(JSON.stringify(report,null,2));
    if(report.status==='blocked')process.exitCode=1;
  }catch{
    console.error('Read-only atomic promotion preflight unavailable: check exact scope.');
    process.exitCode=1;
  }
}
