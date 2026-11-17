#!/usr/bin/env node
/**
 * Inspect an ACTUAL local AgentHub stdio memory_recall exchange from one Git
 * project, without writing memory, changing Codex configuration or printing
 * private Claim values. This is an operator diagnostic, NOT protected Claim
 * approval or verified original Codex CLI/Desktop host integration.
 */
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry=join(fileURLToPath(new URL('..',import.meta.url)),
  'scripts','run-codex-memory-mcp.mjs');
const allowedStates=new Set([
  'found','no_current_authorized_match','memory_database_unavailable',
  'project_not_registered','scope_not_configured','scope_invalid',
  'project_context_unavailable','project_not_approved',
  'project_identity_changed','memory_read_failed',
]);
const readyStates=new Set(['found','no_current_authorized_match']);

export function parseDoctorArgs(argv) {
  if(!Array.isArray(argv))throw Error('invalid_args');
  let cwd=null,scopePath=null,query='project decision';
  for(let i=0;i<argv.length;i++){
    const a=argv[i],value=argv[++i];
    if(!['--cwd','--scope','--query'].includes(a)
      ||typeof value!=='string'||!value)
      throw Error('usage: --cwd ABS_PROJECT [--scope ABS_MANIFEST] [--query TEXT]');
    if(a==='--cwd'&&cwd===null&&isAbsolute(value))cwd=resolve(value);
    else if(a==='--scope'&&scopePath===null&&isAbsolute(value))
      scopePath=resolve(value);
    else if(a==='--query'&&typeof value==='string'
      &&value.trim().length>0&&value.length<=500&&query==='project decision')
      query=value;
    else throw Error('doctor_argument_invalid');
  }
  if(!cwd)throw Error('absolute_project_directory_required');
  return {cwd,scopePath,query};
}

export function diagnoseCodexMemory({
  cwd,scopePath=null,query='project decision',
  run=execFileSync,
}={}) {
  if(typeof cwd!=='string'||!isAbsolute(cwd)
    ||(scopePath!==null&&(typeof scopePath!=='string'||!isAbsolute(scopePath)))
    ||typeof query!=='string'||!query.trim()||query.length>500)
    throw Error('doctor_arguments_invalid');
  const calls=[
    {jsonrpc:'2.0',id:1,method:'initialize',params:{
      protocolVersion:'2025-06-18',capabilities:{},
      clientInfo:{name:'agenthub-local-read-doctor',version:'1.0.0'},
    }},
    {jsonrpc:'2.0',id:2,method:'tools/list',params:{}},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{
      name:'memory_recall',arguments:{query,max_items:1},
    }},
  ];
  const args=[entry,'--global'];
  if(scopePath)args.push('--scope',scopePath);
  // The server itself derives project identity from the ACTUAL cwd.
  // Passing project/branch IDs as MCP arguments would be an invalid test.
  const stdout=run(process.execPath,args,{
    cwd:resolve(cwd),
    input:calls.map(x=>JSON.stringify(x)).join('\n')+'\n',
    encoding:'utf8',timeout:15000,maxBuffer:256*1024,
    windowsHide:true,stdio:['pipe','pipe','pipe'],
  });
  const lines=String(stdout).trim().split(/\r?\n/u).map(x=>JSON.parse(x));
  if(lines.length!==3 || lines.some((r,i)=>r?.jsonrpc!=='2.0'||r?.id!==i+1)
    ||lines[0]?.result?.serverInfo?.name!=='agenthub-memory-readonly'
    ||lines[1]?.result?.tools?.length!==1
    ||lines[1]?.result?.tools?.[0]?.name!=='memory_recall'
    ||lines[1].result.tools[0].annotations?.readOnlyHint!==true
    ||lines[2]?.result?.content?.length!==1
    ||typeof lines[2].result.content[0]?.text!=='string')
    throw Error('doctor_stdio_protocol_invalid');
  const reply=JSON.parse(lines[2].result.content[0].text);
  if(!reply||typeof reply!=='object'||Array.isArray(reply)
    ||!allowedStates.has(reply.status)||reply.read_only!==true
    ||!Array.isArray(reply.items)||reply.items.length>1
    ||(reply.status==='found'&&reply.items.length!==1)
    ||(reply.status==='no_current_authorized_match'&&reply.items.length!==0))
    throw Error('doctor_readonly_reply_invalid');
  return {
    status:readyStates.has(reply.status)
      ?(reply.status==='found'?'ready_with_memory':'ready_no_matching_memory')
      :'not_ready',
    memory_status:reply.status,
    project_id:typeof reply.project_id==='string'?reply.project_id:null,
    branch:typeof reply.branch==='string'?reply.branch:null,
    matching_items:reply.items.length,
    stdio_mcp_ok:true,
    read_only:true,
    canonical_user_memory_only:true,
    protected_private_claim_release_enabled:false,
    original_codex_cli_desktop_verified:false,
    memory_db_modified:false,
  };
}

function main(){
  try{
    const result=diagnoseCodexMemory(parseDoctorArgs(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(result.status==='not_ready')process.exitCode=2;
  }catch{
    // No user query, Claim contents, SQLite paths or stderr in output.
    process.stderr.write('CODEX_MEMORY_DOCTOR_FAILED: local stdio read unavailable or invalid. No memory/config files changed.\n');
    process.exitCode=2;
  }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
  main();
