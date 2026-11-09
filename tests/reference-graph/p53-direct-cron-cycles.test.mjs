import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { evaluateP38Soak } from '../../reference-graph/p39-p38-monitor.mjs';

const root = fileURLToPath(new URL('../../reference-graph/',import.meta.url));
const evidence = JSON.parse(readFileSync(root+'/evidence/p53-live-cron-20261109.json','utf8'));
const sql = readFileSync(root+'/ops/p53-live-cron-24h.sql','utf8');

test('P53 direct cron source records 12/12 actual cycles and 24/24 executions',()=>{
  assert.equal(evidence.schema_version,'reference-graph.p53-direct-live-p31-cron-soak.v1');
  assert.equal(evidence.project_ref,'vrznfnxzlxaavpqbzbzd');
  assert.equal(evidence.cron_job_id,2);
  assert.equal(evidence.window_hours,24);
  assert.equal(evidence.cycle_hours,2);
  assert.deepEqual(evidence.expected_cycle_invocations_utc_minutes,[0,5]);
  assert.equal(evidence.observed_cycles,12);
  assert.equal(evidence.qualifying_cycles,12);
  assert.equal(evidence.deficient_cycles,0);
  assert.equal(evidence.attempts,24);
  assert.equal(evidence.succeeded,24);
  assert.equal(evidence.failed,0);
  assert.equal(evidence.missing_end_times,0);
  assert.equal(evidence.max_inter_run_gap_seconds,6900.115);
  assert.equal(evidence.max_inter_run_gap_seconds<8100,true);
  assert.equal(evidence.cron_execution_p95_seconds,0.842);
  assert.equal(Date.parse(evidence.window_end_utc)-Date.parse(evidence.window_start_utc),24*3600*1000);
});
test('P53 matches the existing P38 12-cycle, 24-hour source execution evaluator',()=>{
  assert.equal(evidence.cycles.length,12);
  assert.deepEqual(evidence.cycles.map(x=>x.invocations),Array(12).fill(2));
  assert.deepEqual(evidence.cycles.map(x=>x.succeeded),Array(12).fill(2));
  const result=evaluateP38Soak(evidence.cycles);
  assert.equal(result.eligible,true);
  assert.equal(result.healthy_cycles,12);
  assert.equal(result.observed_cycles,12);
  assert.equal(result.span_hours,24);
  assert.deepEqual(result.blockers,[]);
  assert.equal(result.activation_performed,false);
  assert.equal(evidence.p38_cycle_count_evaluator_eligible,true);
});
test('P53 would block inadequate historical cycles, gaps and failed cycles',()=>{
  const clones=evidence.cycles.map(c=>({...c}));
  assert.equal(evaluateP38Soak(clones.slice(1)).eligible,false);
  const failed=clones.map(c=>({...c}));
  failed[4].succeeded=0;
  assert.equal(evaluateP38Soak(failed).eligible,false);
  const missing=clones.map(c=>({...c}));
  missing[7].invocations=1;
  missing[7].succeeded=1;
  assert.equal(evaluateP38Soak(missing).eligible,false);
  const delayed=clones.map(c=>({...c}));
  delayed[3].cycle_start=new Date(Date.parse(delayed[3].cycle_start)+20*60*1000).toISOString();
  assert.equal(evaluateP38Soak(delayed).eligible,false);
});
test('P53 cron health never authorizes the operational monitor or graph release',()=>{
  for(const name of [
    'full_p38_operational_soak_attested',
    'data_api_p95_measured',
    'per_cycle_p7_p31_full_content_parity_attested',
    'monitor_alert_delivery_verified',
    'independent_cron_log_origin_signed',
    'source_original_p31_receipt_recovered',
    'separate_human_review_attested',
    'production_multi_host_rollback_rehearsed',
    'owner_merge_authorization_for_276',
    'owner_activation_authorization',
    'repository_default_graph_enabled',
  ]) assert.equal(evidence[name],false,name);
});
test('P53 exact-window source query is SELECT-only and checks :00 + :05 independently',()=>{
  const cleaned=sql.replace(/--[^\n]*/g,'').trim();
  assert.match(cleaned,/^WITH bounds AS/);
  assert.match(cleaned,/cron\.job_run_details/);
  assert.match(cleaned,/jobid=2/);
  assert.match(cleaned,/on_the_hour_success/);
  assert.match(cleaned,/five_minutes_later_success/);
  assert.match(cleaned,/interval '5 minutes'/);
  assert.match(cleaned,/percentile_cont\(0\.95\)/);
  assert.equal((cleaned.match(/;/g)||[]).length,1);
  assert.doesNotMatch(cleaned,/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|COPY|CALL)\b/i);
});
