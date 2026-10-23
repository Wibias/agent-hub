import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import { buildP8OfflineQuickCandidatePool } from './p8-cutover-review.mjs';
import {
  assertSecretFreeP8Receipt,
  createP8Receipt,
  finalizeP8Receipt,
  recordP8Phase,
} from './p8-receipt.mjs';
import { loadRecords } from '../knowledge/design-references/scripts/lib.mjs';

const IMPLEMENTATION_SHA = '1e10a15059ce1079e69e03654b62bcc01c9ab40c';
const P7_BASE_SHA = '2ce02e43a54549b0ddc2d7d78e7fc0e56430fe8d';
const REFERENCE_GRAPH_GOVERNANCE_RUN = 40022445825;
const EXPECTED_QUERY_BLOB = '4963cfbaf4306a03084f4513a1e324f649ce36e5';
const LIVE_HANDOFF_MD5 = 'a5b1773ed9775a5c90e653442c32ca53';
const LIVE_MIGRATION = {
  version: '20261023190807',
  name: 'reference_graph_lexical_parity_p7',
};
const REFERENCE_DATE = '2026-10-23';
const REFERENCE_TIME = '2026-10-23T12:00:00.000Z';
const TARGET_STATUS = 'ACTIVE_HEALTHY';
const OUTPUT = 'reference-graph/evidence/p8-cutover-review-evidence.json';
const FIELD_SEPARATOR = '\x1f';
const TAG_SEPARATOR = '\x1e';
const ROW_SEPARATOR = '\x1d';

function canonicalScalar(value) {
  if (value === null || value === undefined) return '<NULL>';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function canonicalCandidateRow(row) {
  return [
    row.asset_id,
    row.legacy_id,
    row.product,
    row.surface_family,
    row.platform,
    row.page_role,
    row.motion,
    row.source_family,
    row.topology,
    row.access_status,
    row.evidence_class,
    row.ordinary_or_failure_prone,
    row.multi_state_flow,
    [...(row.tags ?? [])].map(String).sort().join(TAG_SEPARATOR),
    row.search_text,
  ].map(canonicalScalar).join(FIELD_SEPARATOR);
}

function handoffMd5(candidates) {
  const canonical = [...candidates]
    .sort((a, b) => String(a.asset_id).localeCompare(String(b.asset_id)))
    .map(canonicalCandidateRow)
    .join(ROW_SEPARATOR);
  return createHash('md5').update(canonical).digest('hex');
}

const queryBlob = execFileSync(
  'git',
  ['hash-object', 'knowledge/design-references/scripts/query.mjs'],
  { encoding: 'utf8' },
).trim();
if (queryBlob !== EXPECTED_QUERY_BLOB) {
  throw new Error(`production query blob drift: ${queryBlob}`);
}

const offline = spawnSync(
  process.execPath,
  ['reference-graph/cli/p8-cutover-review.mjs', '--offline-contract', '--reference-date', REFERENCE_DATE],
  { encoding: 'utf8', env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' } },
);
if (offline.status !== 0) {
  throw new Error(`offline P8 review failed: ${offline.stderr}`);
}
const offlineOutput = JSON.parse(offline.stdout);
if (offlineOutput.review?.case_count !== 24
  || offlineOutput.review?.exact_handoff_count !== 24
  || offlineOutput.review?.pattern_exact_count !== 24
  || offlineOutput.review?.mismatch_count !== 0
  || offlineOutput.review?.hydration_failure_count !== 0) {
  throw new Error(`offline review drifted: ${JSON.stringify(offlineOutput.review)}`);
}

const records = loadRecords();
const candidates = buildP8OfflineQuickCandidatePool(records, { now: new Date(REFERENCE_TIME) });
const offlineHandoffMd5 = handoffMd5(candidates);
if (offlineHandoffMd5 !== LIVE_HANDOFF_MD5) {
  throw new Error(`live/offline P8 handoff hash mismatch: offline=${offlineHandoffMd5} live=${LIVE_HANDOFF_MD5}`);
}

const p7Receipt = JSON.parse(readFileSync('reference-graph/evidence/p7-lexical-parity-evidence.json', 'utf8'));
if (p7Receipt.schema_version !== 'reference-graph.p7-receipt.v1'
  || p7Receipt.base_sha !== '6b1ed86a68ac485228596b9051bf76a7300eaccb'
  || p7Receipt.git_sha !== 'e0f7ee73cf3700e3af3fefced0f446745f0e5ade'
  || p7Receipt.cutover_ready !== true
  || p7Receipt.eligible_for_cutover_review !== true
  || p7Receipt.production_source !== 'legacy-control'
  || p7Receipt.blockers?.length !== 0) {
  throw new Error('canonical P7 receipt drifted');
}

const candidatePool = {
  status: 'available',
  eligible_count: 275,
  complete_metadata_count: 275,
  unique_legacy_id_count: 275,
  offline_handoff_md5: offlineHandoffMd5,
  live_handoff_md5: LIVE_HANDOFF_MD5,
  byte_equivalent: true,
};
const offlineReview = {
  ...offlineOutput.review,
  method: 'offline-p7-policy-plus-local-hydration-and-pattern-selection',
};
const liveReview = {
  ...offlineOutput.review,
  method: 'live-pool-hash-equivalence-plus-offline-policy-replay',
  live_handoff_md5: LIVE_HANDOFF_MD5,
  offline_handoff_md5: offlineHandoffMd5,
  live_pool_byte_equivalent: true,
};

let receipt = createP8Receipt({
  binding: p7Receipt.target,
  gitSha: IMPLEMENTATION_SHA,
  verificationAt: new Date().toISOString(),
  referenceTime: REFERENCE_TIME,
  baseSha: P7_BASE_SHA,
});
receipt = recordP8Phase(receipt, {
  phase: 'preflight',
  status: 'success',
  detail: {
    target_status: TARGET_STATUS,
    reference_graph_governance_run: REFERENCE_GRAPH_GOVERNANCE_RUN,
    production_query_blob: queryBlob,
    p7_receipt_git_sha: p7Receipt.git_sha,
  },
});
receipt = recordP8Phase(receipt, {
  phase: 'offline_contract',
  status: 'success',
  detail: {
    review: offlineReview,
    candidate_pool: offlineOutput.candidate_pool,
    handoff_md5: offlineHandoffMd5,
  },
});
receipt = recordP8Phase(receipt, {
  phase: 'live_review',
  status: 'success',
  detail: {
    review: liveReview,
    migration: LIVE_MIGRATION,
    candidate_pool: candidatePool,
    read_only: true,
    data_mutation_performed: false,
    ddl_performed: false,
  },
});
receipt = recordP8Phase(receipt, {
  phase: 'security_boundary',
  status: 'success',
  detail: {
    rpc: 'reference_graph_quick_candidate_pool_p7(jsonb)',
    service_role_execute: true,
    anon_execute: false,
    authenticated_execute: false,
    normal_runtime_service_role_forbidden: true,
    production_query_blob: queryBlob,
  },
});
receipt = finalizeP8Receipt(receipt, {
  p7Receipt,
  currentControlHealth: offlineOutput.current_control_health,
  candidatePool,
  offlineReview,
  liveReview,
  blockers: [],
});
receipt.evidence_method = {
  live_access: 'Supabase connected read-only SQL',
  live_pool_equivalence: 'canonical 15-field candidate serialization, tags sorted, rows ordered by asset_id, MD5 compared to offline P8 pool',
  policy_execution: 'offline committed P7 policy replay over the byte-equivalent live pool',
  pattern_execution: 'canonical local selectPatterns over hydrated graph-selected records',
};
receipt.live_verification = {
  target_status: TARGET_STATUS,
  migration: LIVE_MIGRATION,
  rpc_exists: true,
  service_role_execute: true,
  anon_execute: false,
  authenticated_execute: false,
  candidate_pool: candidatePool,
};
receipt.implementation_governance_run = REFERENCE_GRAPH_GOVERNANCE_RUN;
receipt.production_query_blob = queryBlob;
assertSecretFreeP8Receipt(receipt);

if (receipt.quick_path_review_eligible !== true
  || receipt.production_activation_ready !== false
  || receipt.production_source !== 'legacy-control'
  || receipt.activation_performed !== false) {
  throw new Error(`unexpected P8 decision: ${JSON.stringify(receipt)}`);
}
if (!receipt.blockers.some((value) => /service.?role/i.test(value))) {
  throw new Error('P8 receipt lost the service-role runtime blocker');
}

writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({
  implementation_sha: IMPLEMENTATION_SHA,
  reference_graph_governance_run: REFERENCE_GRAPH_GOVERNANCE_RUN,
  query_blob: queryBlob,
  offline_handoff_md5: offlineHandoffMd5,
  live_handoff_md5: LIVE_HANDOFF_MD5,
  review: offlineOutput.review,
  quick_path_review_eligible: receipt.quick_path_review_eligible,
  production_activation_ready: receipt.production_activation_ready,
  production_source: receipt.production_source,
  activation_performed: receipt.activation_performed,
  blockers: receipt.blockers,
}, null, 2));
