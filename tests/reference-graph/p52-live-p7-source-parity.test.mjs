import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../reference-graph/',import.meta.url));
const evidence = JSON.parse(readFileSync(root+'/evidence/p52-live-p7-vs-p31-20261109.json','utf8'));
const sql = readFileSync(root+'/ops/p52-p7-p31-full-content.sql','utf8');
const memberSql = readFileSync(root+'/ops/p52-p7-p31-member-set.sql','utf8');
const FULL='a48ad0da557a18fc2b5a25fea0dc02348ba64fdc56ad469bee14ea1934ba1513';
const MEMBERS='b3037425ff08c7822f695ce28c6e5fb1dbd3e245255ab33a614e96995cf2a6a2';

test('P52 direct-source 16-field parity is exact for the recorded current date',()=>{
  assert.equal(evidence.schema_version,'reference-graph.p52-direct-live-p7-vs-p31-full-content.v1');
  assert.equal(evidence.project_ref,'vrznfnxzlxaavpqbzbzd');
  assert.equal(evidence.observed_snapshot_date,'2026-11-09');
  assert.equal(evidence.p7_candidate_count,275);
  assert.equal(evidence.p31_candidate_count,275);
  assert.equal(evidence.p7_distinct_asset_ids,275);
  assert.equal(evidence.p31_distinct_asset_ids,275);
  assert.equal(evidence.candidate_field_count_including_asset_id,16);
  for(const n of ['missing_p7_current_assets','invalid_primary_strata',
    'p7_only_assets','p31_only_assets','mismatched_source_profile_fields']) {
    assert.equal(evidence[n],0,n);
  }
  assert.equal(evidence.p7_current_candidate_sha256,FULL);
  assert.equal(evidence.p31_current_candidate_sha256,FULL);
  assert.equal(evidence.p31_distinct_snapshot_dates,1);
  assert.equal(evidence.p31_distinct_refresh_instants,1);
  assert.equal(evidence.p31_distinct_projection_versions,1);
});

test('P52 source/member hashes remain distinct from historic content provenance',()=>{
  assert.equal(evidence.sorted_legacy_id_set_sha256,MEMBERS);
  assert.equal(evidence.historical_p33_id_set_sha256_equal,true);
  assert.equal(evidence.matching_historical_id_set_proves_historical_content,false);
  assert.equal(evidence.historical_2026_11_08_source_bytes_attested,false);
  assert.equal(evidence.original_p31_refresh_receipt_recovered,false);
  assert.match(evidence.p31_refreshed_at_utc,/^2026-11-09T20:05:00/);
});
test('P52 source functions are service-role-only, and no refresh function was invoked',()=>{
  for(const k of ['p7_function','p31_refresh_function']) {
    assert.equal(evidence[k].security_definer,true);
    assert.equal(evidence[k].anon_execute,false);
    assert.equal(evidence[k].authenticated_execute,false);
    assert.equal(evidence[k].service_role_execute,true);
  }
  assert.equal(evidence.p7_function.volatility,'stable');
  assert.equal(evidence.p31_refresh_function.executed_by_this_audit,false);
});

test('P52 live check cannot be interpreted as independently signed release authority',()=>{
  for(const k of [
    'source_database_response_independently_signed',
    'independent_human_review_attested',
    'historical_2026_11_08_source_bytes_attested',
    'original_p31_refresh_receipt_recovered',
    'matching_historical_id_set_proves_historical_content',
    'production_multi_host_rollback_rehearsed',
    'owner_activation_authorized',
    'repository_default_graph_enabled',
  ]) assert.equal(evidence[k],false,k);
  assert.equal(evidence.supabase_security_advisor.error_count,0);
  assert.equal(evidence.supabase_security_advisor.warn_count,0);
  assert.equal(evidence.supabase_security_advisor.info_count,12);
  assert.equal(evidence.supabase_performance_advisor.info_count,4);
});
test('P52 reproducibility files contain only read-only SQL queries',()=>{
  for(const [name,raw] of [['content',sql],['membership',memberSql]]) {
    const cleaned=raw.replace(/--[^\n]*/g,'').trim();
    assert.match(cleaned,/^WITH\s+/i,name);
    assert.equal((cleaned.match(/;/g)||[]).length,1,name);
    assert.match(cleaned,/sha256\s*\(/i,name);
    assert.doesNotMatch(cleaned,/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|COPY|CALL)\b/i,name);
  }
  assert.match(sql,/reference_graph_quick_candidate_pool_p7/);
  assert.match(sql,/reference_graph_profile_runtime_projection_p30_v1/);
  assert.match(sql,/current_assets/);
  assert.match(sql,/primary_stratum/);
  assert.match(sql,/IS DISTINCT FROM/);
  assert.match(memberSql,/legacy_id COLLATE "C"/);
});
