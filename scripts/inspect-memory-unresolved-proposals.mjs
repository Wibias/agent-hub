#!/usr/bin/env node
/**
 * D12.3 read-only inventory of unresolved evidence-bound Memory proposals.
 * Default output never includes proposal text, source text, evidence IDs or
 * filesystem paths. Review and final decisions remain human-only.
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const STATUSES = new Set(['pending','needs_confirmation','failed']);
const KINDS = new Set(['preference','procedure','knowledge']);
const RELATIONS = new Set(['same','update','contradict','unrelated']);
const STATUS_ORDER = ['pending','needs_confirmation','failed','ignored','promoted','superseded'];
const proposalRef = id => '~p' + createHash('sha256').update(id,'utf8').digest('hex').slice(0,12);

export function parseUnresolvedProposalAuditArgs(argv=[]) {
  const args = {
    dbPath:null,projectId:null,branch:null,limit:100,showLocalFacts:false,
  };
  const seen = new Set();
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];
    if(seen.has(flag))throw new Error('duplicate argument');
    seen.add(flag);
    if(flag==='--show-local-facts'){
      args.showLocalFacts=true;
      continue;
    }
    if(!['--db-path','--project-id','--branch','--limit'].includes(flag)){
      throw new Error('unsupported argument');
    }
    const value=argv[++i];
    if(typeof value!=='string'||!value.trim())throw new Error('missing argument value');
    if(flag==='--db-path')args.dbPath=resolve(value);
    else if(flag==='--project-id')args.projectId=value.trim();
    else if(flag==='--branch')args.branch=value.trim();
    else if(/^(?:[1-9]|[1-9][0-9]|100)$/u.test(value))args.limit=Number(value);
    else throw new Error('limit must be 1..100');
  }
  if(!args.dbPath||!args.projectId||!args.branch)throw new Error('exact project, branch and DB required');
  return args;
}

function tablePresent(db,name) {
  return Boolean(db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?",
  ).get(name));
}

function classifySources(rows,projectId,branch) {
  let missing=0,wrongScope=0,secret=0,userDirect=0,nonUser=0;
  for(const row of rows) {
    if(!row.evidence_exists)missing++;
    else {
      if(row.project_id!==projectId||row.branch!==branch)wrongScope++;
      if(row.sensitivity!=='normal')secret++;
      if(row.authority_class==='user_direct')userDirect++;
      else nonUser++;
    }
  }
  const invalid=rows.length===0||missing>0||wrongScope>0||secret>0;
  const issue=rows.length===0?'no_linked_evidence'
    :missing?'missing_source_evidence'
      :wrongScope?'cross_scope_evidence'
        :secret?'non_normal_sensitivity'
          :nonUser>0?'requires_authority_review'
            :'requires_manual_meaning_review';
  return {
    linkedEvidence:rows.length,
    userDirectEvidence:userDirect,
    otherAuthorityEvidence:nonUser,
    provenanceIssue:issue,
    structurallyReviewable:!invalid,
  };
}

export function inspectUnresolvedMemoryProposals({
  dbPath,projectId,branch,limit=100,showLocalFacts=false,
  openDb=path=>new DatabaseSync(path,{readOnly:true,timeout:5000}),
}={}) {
  if([dbPath,projectId,branch].some(v=>typeof v!=='string'||!v.trim())
    ||!Number.isInteger(limit)||limit<1||limit>100
    ||typeof showLocalFacts!=='boolean'){
    throw new TypeError('exact scope and bounded read-only options required');
  }
  const db=openDb(dbPath);
  try {
    const baseline={
      type:'agent_hub_memory_unresolved_proposal_inventory_v1',
      readOnly:true,writesToSource:false,modelInvocations:0,
      contentIncluded:showLocalFacts,
      decisionsApplied:0,claimsCreated:0,
      scope:{projectId,branch},
    };
    if(!tablePresent(db,'memory_evidence_proposals')){
      return {...baseline,status:'proposal_ledger_missing',
        statusCounts:Object.fromEntries(STATUS_ORDER.map(s=>[s,0])),
        unresolvedTotal:null,returned:0,truncated:false,items:[]};
    }
    if(!tablePresent(db,'memory_evidence_proposal_evidence')
      ||!tablePresent(db,'evidence')){
      return {...baseline,status:'proposal_evidence_ledger_missing',
        statusCounts:Object.fromEntries(STATUS_ORDER.map(s=>[s,0])),
        unresolvedTotal:null,returned:0,truncated:false,items:[]};
    }
    const statusCounts=Object.fromEntries(STATUS_ORDER.map(s=>[s,0]));
    for(const row of db.prepare(
      'SELECT status, COUNT(*) AS n FROM memory_evidence_proposals '
      + 'WHERE project_id=? AND branch=? GROUP BY status',
    ).all(projectId,branch)) {
      if(Object.hasOwn(statusCounts,row.status))statusCounts[row.status]=row.n;
    }
    const unresolvedTotal=STATUSES.values().reduce(
      (n,s)=>n+statusCounts[s],0,
    );
    const rows=db.prepare(
      'SELECT id,kind,status,canonical_fact,importance_evaluated_at,'
      + 'support_evaluated_at FROM memory_evidence_proposals '
      + "WHERE project_id=? AND branch=? AND status IN ('pending','needs_confirmation','failed') "
      + 'ORDER BY created_at ASC,id ASC LIMIT ?',
    ).all(projectId,branch,limit);
    const relationAvailable=tablePresent(db,'memory_evidence_proposal_relations');
    const promotionAvailable=tablePresent(db,'memory_evidence_proposal_promotions');
    const evidenceQuery=db.prepare(
      'SELECT l.evidence_id, e.id AS evidence_exists, e.project_id, e.branch, '
      + 'e.authority_class,e.sensitivity '
      + 'FROM memory_evidence_proposal_evidence l '
      + 'LEFT JOIN evidence e ON e.id=l.evidence_id '
      + 'WHERE l.proposal_id=? ORDER BY l.evidence_id',
    );
    const relationQuery=relationAvailable
      ?db.prepare('SELECT relation FROM memory_evidence_proposal_relations WHERE proposal_id=?')
      :null;
    const promotionQuery=promotionAvailable
      ?db.prepare('SELECT status FROM memory_evidence_proposal_promotions WHERE proposal_id=?')
      :null;
    const items=rows.map(row=>{
      const source=classifySources(evidenceQuery.all(row.id),projectId,branch);
      const relation=relationQuery?.get(row.id)?.relation ?? null;
      const promotion=promotionQuery?.get(row.id)?.status ?? null;
      return {
        proposalRef:proposalRef(row.id),
        kind:KINDS.has(row.kind)?row.kind:'unknown',
        status:STATUSES.has(row.status)?row.status:'unknown',
        ...source,
        importanceEvaluated:row.importance_evaluated_at!==null,
        supportEvaluated:row.support_evaluated_at!==null,
        relation:RELATIONS.has(relation)?relation:null,
        promotionState:['promoted','superseded','needs_confirmation'].includes(promotion)
          ?promotion:null,
        decision:'manual_review_required',
        ...(showLocalFacts?{localCanonicalFact:row.canonical_fact}:{}),
      };
    });
    return {
      ...baseline,status:'ok',statusCounts,unresolvedTotal,
      returned:items.length,truncated:unresolvedTotal>items.length,
      reviewableFromMetadataOnly:false,
      items,
    };
  } finally {
    db.close();
  }
}

const isCli=process.argv[1]
  ?pathToFileURL(resolve(process.argv[1])).href===import.meta.url:false;
if(isCli){
  try{
    const report=inspectUnresolvedMemoryProposals(
      parseUnresolvedProposalAuditArgs(process.argv.slice(2)),
    );
    console.log(JSON.stringify(report,null,2));
    if(report.status!=='ok')process.exitCode=1;
  } catch {
    console.error('Read-only proposal inventory unavailable: verify scope, schema and flags.');
    process.exitCode=1;
  }
}
