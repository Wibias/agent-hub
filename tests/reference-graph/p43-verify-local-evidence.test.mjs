import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { verifyP43LocalEvidence } from '../../reference-graph/cli/p43-verify-local-evidence.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const home = mkdtempSync(join(tmpdir(),'p43-'));
  const dir = join(home,'audit');
  mkdirSync(dir);
  const source = '3f8c14fcce10a836747237f5dacf0f85eac541d4';
  const date = '2026-11-09';
  const hash = 'b3037425ff08c7822f695ce28c6e5fb1dbd3e245255ab33a614e96995cf2a6a2';
  const report = {
    schema_version: 'reference-graph.p33-pinned-profile-parity.v2',
    evaluated_cases: 48, exact_order_cases: 48, mismatch_cases: 0,
    candidate_count: 275, candidate_id_set_sha256: hash,
    record_order_coverage_parity_exact: true,
  };
  const witness = {
    schema_version:'reference-graph.p40-readonly-source-witness.v1',
    project_ref:'vrznfnxzlxaavpqbzbzd',source_method:'p7-vs-p31-read-only',
    snapshot_date:date,refreshed_at:'2026-11-09T18:05:00.159Z',
    expected_candidate_count:275,published_candidate_count:275,
    expected_candidate_id_set_sha256:hash,published_candidate_id_set_sha256:hash,
    membership_mismatch_count:0,metadata_mismatch_count:0,
    refresh_instant_count:1,activation_authorized:false,
    repository_default_graph_enabled:false,
  };
  const p40Record = {
    schema_version:'reference-graph.p40-readonly-record-parity.v1',
    source_method:witness.source_method,reference_date:date,
    refreshed_at:witness.refreshed_at, witness_sha256:'',
    p33_compatible_report:report,activation_authorized:false,
  };
  const full = {
    schema_version:'reference-graph.p40-readonly-full-parity.v1',
    source_method:witness.source_method,reference_date:date,
    refreshed_at:witness.refreshed_at,p33_compatible_report:report,
    p34:{record_order_exact_cases:48,pattern_exact_cases:48,
      public_output_exact_cases:48,candidate_content_bound_to_p33:true},
    p40_record_report_pin_matched:true,activation_authorized:false,
    repository_default_graph_enabled:false,
  };
  const files = {
    baseline:'p27-baseline.json',publicBaseline:'p34-public-baseline.json',
    templates:'templates.json',records:'records.json',patterns:'patterns.json',
  };
  const indexFiles = {};
  for (const [key,name] of Object.entries(files)) {
    const value = '{"test":"synthetic"}\n';
    writeFileSync(join(dir,name),value);
    indexFiles[key] = {path:resolve(dir,name),sha256:sha(Buffer.from(value)),bytes:Buffer.byteLength(value)};
  }
  const witnessText = JSON.stringify(witness);
  p40Record.witness_sha256 = sha(Buffer.from(witnessText));
  const recordText = JSON.stringify(p40Record);
  const fullText = JSON.stringify(full);
  writeFileSync(join(dir,'p40-witness.json'),witnessText);
  writeFileSync(join(dir,'p40-record.json'),recordText);
  writeFileSync(join(dir,'p40-full.json'),fullText);
  const pins = {
    schema_version:'reference-graph.p43-operator-reported-pins.v1',
    source_checkout_sha:source,reference_date:date,
    project_ref:'vrznfnxzlxaavpqbzbzd',
    provenance:'operator-reported-not-independently-attested',
    witness_sha256:sha(Buffer.from(witnessText)),
    record_sha256:sha(Buffer.from(recordText)),
    full_sha256:sha(Buffer.from(fullText)),
  };
  const manifest = {
    schema_version:'reference-graph.p40-operator-manifest.v1',
    target_url:'https://vrznfnxzlxaavpqbzbzd.supabase.co/',
    approved_record_report_sha256:pins.record_sha256,
    files:{sourceWitness:{path:resolve(dir,'p40-witness.json'),sha256:pins.witness_sha256},
      ...Object.fromEntries(Object.entries(indexFiles).map(([key,file])=>
        [key,{path:file.path,sha256:file.sha256}]))},
  };
  const index = {
    schema_version:'reference-graph.p42-local-control-inputs.v1',
    source_checkout_sha:source,reference_date:date,
    legacy_control_sha:'83a3794cc54d2f2d129b83e8e672e18b35f11cff',
    project_ref:'vrznfnxzlxaavpqbzbzd',
    independent_source_attestation:false,activation_authorized:false,
    files:indexFiles,
  };
  writeFileSync(join(dir,'p42-local-index.json'),JSON.stringify(index));
  writeFileSync(join(dir,'p40-manifest-live.json'),JSON.stringify(manifest));
  return {home,dir,pins};
}

test('P43 validates independent re-read of 5 inputs and 3 exact operator hash pins without claiming attestation',()=>{
  const f=fixture();
  try {
    const r=verifyP43LocalEvidence({evidenceDir:f.dir,pins:f.pins});
    assert.equal(r.frozen_inputs_verified,5);
    assert.equal(r.record_exact_cases,48);
    assert.equal(r.p41_local_report_bytes_verified,false);
    assert.equal(r.independent_human_review_attested,false);
    assert.equal(r.stage_execution_window_independently_attested,false);
    assert.equal(r.activation_authorized,false);
  } finally {rmSync(f.home,{recursive:true,force:true});}
});

test('P43 fails closed for tampering, wrong expected pins and altered report content',()=>{
  const f=fixture();
  try{
    assert.throws(()=>verifyP43LocalEvidence({
      evidenceDir:f.dir,pins:{...f.pins,full_sha256:'a'.repeat(64)},
    }),/BLOCKED/);
    writeFileSync(join(f.dir,'p40-full.json'),'{}');
    assert.throws(()=>verifyP43LocalEvidence({evidenceDir:f.dir,pins:f.pins}),/BLOCKED/);
  }finally{rmSync(f.home,{recursive:true,force:true});}
});

test('P43 refuses a fabricated release claim even with repinned bytes',()=>{
  const f=fixture();
  try {
    const path=join(f.dir,'p40-record.json');
    const obj=JSON.parse(readFileSync(path,'utf8'));
    obj.activation_authorized=true;
    const changed=JSON.stringify(obj);
    writeFileSync(path,changed);
    const pins={...f.pins,record_sha256:sha(Buffer.from(changed))};
    const manifest=JSON.parse(readFileSync(join(f.dir,'p40-manifest-live.json'),'utf8'));
    manifest.approved_record_report_sha256=pins.record_sha256;
    writeFileSync(join(f.dir,'p40-manifest-live.json'),JSON.stringify(manifest));
    assert.throws(()=>verifyP43LocalEvidence({evidenceDir:f.dir,pins}),/BLOCKED/);
  }finally{rmSync(f.home,{recursive:true,force:true});}
});
