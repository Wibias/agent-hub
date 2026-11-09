import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const evidence = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../reference-graph/evidence/p51-live-readonly-supabase-20261109.json', import.meta.url)),
  'utf8',
));
const sql = readFileSync(
  fileURLToPath(new URL('../../reference-graph/ops/p51-live-source-fingerprint.sql', import.meta.url)),
  'utf8',
);
const EXPECTED = 'ce4c875e5029b764587dfa2b65124c42908875c89ce12bece68713bb602647db';

test('P51 records same 275-row live fingerprint, but not an identical refresh', () => {
  assert.equal(evidence.schema_version,'reference-graph.p51-connector-direct-live-source-parity.v1');
  assert.equal(evidence.project_ref,'vrznfnxzlxaavpqbzbzd');
  assert.equal(evidence.shared_field_count,15);
  assert.equal(evidence.p10.rows,275);
  assert.equal(evidence.p30.rows,275);
  assert.equal(evidence.p10.distinct_assets,275);
  assert.equal(evidence.p30.distinct_assets,275);
  assert.equal(evidence.p10.shared_fields_sha256,EXPECTED);
  assert.equal(evidence.p30.shared_fields_sha256,EXPECTED);
  assert.equal(evidence.asset_id_set_mismatches,0);
  assert.equal(evidence.legacy_id_mismatches,0);
  assert.equal(evidence.shared_field_mismatches,0);
  assert.notEqual(evidence.p10.refreshed_at,evidence.p30.refreshed_at);
  assert.equal(evidence.refresh_timestamps_identical,false);
});
test('P51 protects the server-only and public metadata view boundary',()=>{
  assert.equal(evidence.p30_server_view.rows,275);
  assert.equal(evidence.p30_server_view.anon_can_select,false);
  assert.equal(evidence.p30_server_view.authenticated_can_select,false);
  assert.equal(evidence.p30_server_view.service_role_can_select,true);
  assert.equal(evidence.p30_server_view.security_invoker,true);
  assert.equal(evidence.p30_public_view.anon_can_select,true);
  assert.equal(evidence.p30_public_view.authenticated_can_select,true);
  assert.deepEqual(evidence.p30_public_view.columns,[
    'projection_version','snapshot_date','refreshed_at',
  ]);
});
test('P51 cannot be misread as signed upstream, independent review or activation',()=>{
  for(const key of [
    'full_source_acquisition_independently_attested',
    'independent_human_review_attested',
    'historic_p31_receipt_recovered',
    'source_run_cryptographically_signed',
    'production_rollback_rehearsed',
    'owner_activation_authorized',
    'repository_default_graph_enabled',
  ])assert.equal(evidence[key],false,key);
  assert.equal(evidence.direct_live_read_only_query_reported,true);
});
test('P51 fingerprint SQL is bounded to SELECT and returns aggregates, not candidate data',()=>{
  const cleaned=sql.replace(/--[^\n]*/g,'').trim();
  assert.match(cleaned,/^WITH fingerprint_rows AS\s*\(/);
  assert.match(cleaned,/jsonb_build_array/);
  assert.match(cleaned,/sha256\s*\(/i);
  assert.match(cleaned,/string_agg\(canonical_row,\s*E'\\n'\s+ORDER BY asset_id\)/i);
  assert.match(cleaned,/FROM summarized ORDER BY source;\s*$/);
  assert.equal((cleaned.match(/;/g)||[]).length,1);
  assert.doesNotMatch(cleaned,/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|COPY|CALL)\b/i);
});
