import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  validateP50Report, buildP50Evidence,
} from '../../reference-graph/cli/p50-create-ci-evidence.mjs';

const sha = 'a'.repeat(40);
const img = 'a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8';
const report = {
  schema_version: 'reference-graph.p49-isolated-containers-rehearsal.v1',
  distinct_container_network_namespaces: 3,
  internal_bridge_network: true, host_ports_published: false,
  tls_version: 'TLSv1.3',
  runtime_image_digest_sha256: img,
  runtime_image_digest_pinned: true,
  runtime_image_supply_chain_attested: false,
  mutual_tls_and_leaf_pins_verified: true,
  worker_permit_cases: 2,
  wrong_client_cert_blocked: true,
  expired_signed_lease_blocked: true,
  valid_lease_in_flight_network_loss_blocked: true,
  valid_lease_cold_start_network_loss_blocked: true,
  valid_lease_after_reconnect_eligible: true,
  in_flight_revoke_blocked: true,
  coordinator_restart_revoke_blocked: true,
  coordinator_network_loss_blocked: true,
  production_deployment_performed: false,
  production_rollback_rehearsed: false,
  activation_authorized: false,
  repository_default_graph_enabled: false,
};
const env = {
  GITHUB_REPOSITORY: 'Wibias/agent-hub',
  GITHUB_WORKFLOW: 'Reference graph P49 isolated mTLS containers',
  GITHUB_SHA: sha, P50_PR_HEAD_SHA: 'b'.repeat(40),
  P50_BASE_SHA: 'c'.repeat(40),
  GITHUB_RUN_ID: '42500000000', GITHUB_RUN_ATTEMPT: '1',
  GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/276/merge',
  RUNNER_OS: 'Linux',
};
function build(r=report,e=env) {
  return buildP50Evidence({reportText:JSON.stringify(r),env:e,checkoutSha:sha});
}
test('P50 exact P49 report yields public provenance-bound CI subject with NO release flags',()=>{
  assert.deepEqual(validateP50Report(report),report);
  const out=build();
  assert.equal(out.schema_version,'reference-graph.p50-p49-ci-evidence.v1');
  assert.equal(out.source_checkout_sha,sha);
  assert.equal(out.pull_request_head_sha,'b'.repeat(40));
  assert.equal(out.base_sha_at_checkout,'c'.repeat(40));
  assert.notEqual(out.pull_request_head_sha,out.source_checkout_sha);
  assert.equal(out.github_signature_created_by_this_report,false);
  assert.equal(out.independent_original_source_attested,false);
  assert.equal(out.independent_human_review_attested,false);
  assert.equal(out.production_rollback_rehearsed,false);
  assert.equal(out.owner_activation_authorized,false);
  assert.equal(out.repository_default_graph_enabled,false);
  assert.match(out.p49_report_sha256,/^[0-9a-f]{64}$/);
});
test('P50 rejects forged success, activation or production claims and missing fields',()=>{
  const mutants=[
    {activation_authorized:true},
    {repository_default_graph_enabled:true},
    {production_rollback_rehearsed:true},
    {runtime_image_supply_chain_attested:true},
    {runtime_image_digest_pinned:false},
    {runtime_image_digest_sha256:'0'.repeat(64)},
    {valid_lease_in_flight_network_loss_blocked:false},
    {expired_signed_lease_blocked:false},
    {distinct_container_network_namespaces:2},
    {host_ports_published:true},
    {wrong_client_cert_blocked:false},
    {tls_version:'TLSv1.2'},
    {worker_permit_cases:1},
    {unexpected_authority:'release'},
  ];
  for(const change of mutants)assert.throws(()=>build({...report,...change}),/BLOCKED/);
  const partial={...report};
  delete partial.valid_lease_after_reconnect_eligible;
  assert.throws(()=>build(partial),/BLOCKED/);
});
test('P50 prevents forged checkout/PR SHA, workflow identity, runner or repository',()=>{
  const changes=[
    {GITHUB_REPOSITORY:'other/repo'},
    {GITHUB_WORKFLOW:'Release governance'},
    {GITHUB_SHA:'d'.repeat(40)},
    {P50_PR_HEAD_SHA:'not-a-sha'},
    {P50_BASE_SHA:undefined},
    {GITHUB_RUN_ID:'0'},
    {GITHUB_RUN_ATTEMPT:'0'},
    {RUNNER_OS:'Windows'},
    {GITHUB_REF:'refs/tags/v1'},
    {GITHUB_EVENT_NAME:'pull_request_target'},
  ];
  for(const change of changes)assert.throws(()=>build(report,{...env,...change}),/BLOCKED/);
});
test('P50 supports manual workflow dispatch but cannot infer an attestation from JSON',()=>{
  const out=build(report,{
    ...env,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',
    P50_PR_HEAD_SHA:sha,P50_BASE_SHA:sha,
  });
  assert.equal(out.github_event,'workflow_dispatch');
  assert.equal(out.github_signature_created_by_this_report,false);
  assert.equal(out.repository_default_graph_enabled,false);
});
test('P50 rejects invalid, huge and truncated report bytes',()=>{
  for(const reportText of ['not-json','{}','x'.repeat(16385)]) {
    assert.throws(()=>buildP50Evidence({reportText,env,checkoutSha:sha}),/BLOCKED/);
  }
});

test('P50 privileged and unprivileged workflow actions use exact approved commit pins',()=>{
  const workflow=readFileSync(new URL('../../.github/workflows/verify-reference-graph-p49.yml',import.meta.url),'utf8');
  // A mutable action tag can change the source executed in the privileged job.
  // This list is an allowlisted, independently resolved GitHub Actions v4 pin set.
  const expected=[
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
    'actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6',
  ].sort();
  const used=[...workflow.matchAll(/^\s*(?:-\s*)?uses:\s+([^\s#]+)/gm)].map(match=>match[1]).sort();
  assert.deepEqual(used,expected);
  assert.ok(used.every(action=>/^actions\/[a-z-]+@[a-f0-9]{40}$/.test(action)));
});
