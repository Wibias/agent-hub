#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST = 'a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8';
const WORKFLOW = 'Reference graph P49 isolated mTLS containers';
const SCHEMA = 'reference-graph.p50-p49-ci-evidence.v1';
const P49 = 'reference-graph.p49-isolated-containers-rehearsal.v1';
const POSITIVE = [
  'internal_bridge_network','runtime_image_digest_pinned',
  'mutual_tls_and_leaf_pins_verified','wrong_client_cert_blocked',
  'expired_signed_lease_blocked','valid_lease_in_flight_network_loss_blocked',
  'valid_lease_cold_start_network_loss_blocked',
  'valid_lease_after_reconnect_eligible','in_flight_revoke_blocked',
  'coordinator_restart_revoke_blocked','coordinator_network_loss_blocked',
];
const NEGATIVE = [
  'host_ports_published','runtime_image_supply_chain_attested',
  'production_deployment_performed','production_rollback_rehearsed',
  'activation_authorized','repository_default_graph_enabled',
];
const KEYS = [
  'schema_version','distinct_container_network_namespaces',
  'internal_bridge_network','host_ports_published','tls_version',
  'runtime_image_digest_sha256','runtime_image_digest_pinned',
  'runtime_image_supply_chain_attested','mutual_tls_and_leaf_pins_verified',
  'worker_permit_cases','wrong_client_cert_blocked',
  'expired_signed_lease_blocked','valid_lease_in_flight_network_loss_blocked',
  'valid_lease_cold_start_network_loss_blocked',
  'valid_lease_after_reconnect_eligible','in_flight_revoke_blocked',
  'coordinator_restart_revoke_blocked','coordinator_network_loss_blocked',
  'production_deployment_performed','production_rollback_rehearsed',
  'activation_authorized','repository_default_graph_enabled',
];
function blocked() { throw new Error('P50 CI evidence BLOCKED'); }
function exact(value, keys) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
export function validateP50Report(report) {
  if (!exact(report,KEYS) || report.schema_version !== P49
    || report.distinct_container_network_namespaces !== 3
    || report.worker_permit_cases !== 2 || report.tls_version !== 'TLSv1.3'
    || report.runtime_image_digest_sha256 !== DIGEST
    || !POSITIVE.every(k => report[k] === true)
    || !NEGATIVE.every(k => report[k] === false)) blocked();
  return report;
}
/**
 * GitHub context is bound to the actual checkout SHA (the PR synthetic merge
 * checkout, NOT necessarily the PR branch head SHA). Never asserts source
 * provenance, independent review or production rollback.
 */
export function buildP50Evidence({ reportText, env, checkoutSha } = {}) {
  if (typeof reportText !== 'string'
    || Buffer.byteLength(reportText) < 30 || Buffer.byteLength(reportText) > 16384
    || !env || env.GITHUB_REPOSITORY !== 'Wibias/agent-hub'
    || env.GITHUB_WORKFLOW !== WORKFLOW
    || !SHA40.test(checkoutSha ?? '') || env.GITHUB_SHA !== checkoutSha
    || !SHA40.test(env.P50_PR_HEAD_SHA ?? '')
    || !SHA40.test(env.P50_BASE_SHA ?? '')
    || !/^[1-9][0-9]{0,18}$/.test(env.GITHUB_RUN_ID ?? '')
    || !/^[1-9][0-9]{0,6}$/.test(env.GITHUB_RUN_ATTEMPT ?? '')
    || !['pull_request','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)
    || typeof env.GITHUB_REF !== 'string'
    || !/^refs\/(?:pull\/[0-9]+\/merge|heads\/[A-Za-z0-9._/-]+)$/.test(env.GITHUB_REF)
    || env.RUNNER_OS !== 'Linux') blocked();
  let report;
  try { report = JSON.parse(reportText); } catch { blocked(); }
  validateP50Report(report);
  return {
    schema_version: 'reference-graph.p50-p49-ci-evidence.v1',
    repository: 'Wibias/agent-hub',
    source_checkout_sha: checkoutSha,
    pull_request_head_sha: env.P50_PR_HEAD_SHA,
    base_sha_at_checkout: env.P50_BASE_SHA,
    workflow: WORKFLOW,
    workflow_file: '.github/workflows/verify-reference-graph-p49.yml',
    github_run_id: env.GITHUB_RUN_ID,
    github_run_attempt: Number(env.GITHUB_RUN_ATTEMPT),
    github_event: env.GITHUB_EVENT_NAME,
    github_ref: env.GITHUB_REF,
    runner_os: env.RUNNER_OS,
    p49_report_sha256: createHash('sha256').update(reportText).digest('hex'),
    p49_report: report,
    github_signature_created_by_this_report: false,
    independent_original_source_attested: false,
    independent_human_review_attested: false,
    production_rollback_rehearsed: false,
    owner_activation_authorized: false,
    repository_default_graph_enabled: false,
  };
}
export function writeP50Evidence({ reportPath, outputPath, env = process.env } = {}) {
  if (typeof reportPath !== 'string' || !isAbsolute(reportPath)
    || typeof outputPath !== 'string' || !isAbsolute(outputPath)
    || reportPath === outputPath) blocked();
  let reportText, checkoutSha;
  try {
    reportText = readFileSync(reportPath,'utf8');
    checkoutSha = execFileSync('git',['rev-parse','HEAD'],{
      encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000,
    }).trim();
  } catch { blocked(); }
  const evidence = buildP50Evidence({reportText,env,checkoutSha});
  const bytes = JSON.stringify(evidence) + '\n';
  try {
    writeFileSync(outputPath,bytes,{flag:'wx',mode:0o600,encoding:'utf8'});
  } catch { blocked(); }
  return {
    schema_version: SCHEMA,
    subject_sha256: createHash('sha256').update(bytes).digest('hex'),
    source_checkout_sha: checkoutSha,
    activation_authorized: false,
  };
}
const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const a = process.argv.slice(2);
    if(a.length !== 4 || a[0] !== '--p49-report' || a[2] !== '--output') blocked();
    process.stdout.write(JSON.stringify(writeP50Evidence({
      reportPath: a[1], outputPath: a[3],
    })) + '\n');
  } catch {
    process.stderr.write('P50 CI evidence BLOCKED\n');
    process.exitCode = 2;
  }
}
