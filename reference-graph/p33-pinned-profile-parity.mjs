import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  P30ProfileTransportError,
  fetchP30ProfileCandidateSnapshot,
} from './p30-profile-transport.mjs';
import { compareP29OfflineProfileParity } from './p29-offline-profile-parity.mjs';
import { hashP33CandidateContent } from './p33-candidate-content-digest.mjs';

const TARGET = JSON.parse(readFileSync(new URL('./target.json', import.meta.url), 'utf8'));
const PROJECT_REF = 'vrznfnxzlxaavpqbzbzd';
const PROJECTION_VERSION = 'reference-graph.profile-runtime.p30.v1';
const RECEIPT_VERSION = 'reference-graph.p31-source-snapshot-receipt.v1';
const SHA256 = /^[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_AGE_MS = 4 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 60 * 1000;
const RECEIPT_KEYS = Object.freeze([
  'schema_version', 'projection_version', 'snapshot_date', 'refreshed_at',
  'expected_candidate_count', 'expected_candidate_id_set_sha256',
  'published_candidate_count', 'published_candidate_id_set_sha256',
  'live_graph_parity_verified', 'pattern_parity_verified',
  'repository_default_graph_enabled', 'activation_performed',
]);

export class P33PinnedProfileParityError extends Error {
  constructor(category) {
    super('P33 pinned profile parity failed: ' + category);
    this.name = 'P33PinnedProfileParityError';
    this.category = category;
  }
}

function fail(category) {
  throw new P33PinnedProfileParityError(category);
}

function ownExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
    === JSON.stringify([...keys].sort());
}

function validInstant(value) {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString() === value;
}

function verifyPinnedJson(raw, sha, maxBytes, category) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > maxBytes
    || raw.length === 0 || typeof sha !== 'string' || !SHA256.test(sha)) {
    fail(category);
  }
  const actual = createHash('sha256').update(raw, 'utf8').digest('hex');
  if (actual !== sha) fail(category);
  try {
    return JSON.parse(raw);
  } catch {
    fail(category);
  }
}

function verifyReceipt(receipt, asOf) {
  if (!ownExactKeys(receipt, RECEIPT_KEYS)
    || receipt.schema_version !== RECEIPT_VERSION
    || receipt.projection_version !== PROJECTION_VERSION
    || typeof receipt.snapshot_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(receipt.snapshot_date)
    || !validInstant(receipt.refreshed_at)
    || !Number.isInteger(receipt.expected_candidate_count)
    || receipt.expected_candidate_count < 1
    || receipt.expected_candidate_count > 5000
    || receipt.published_candidate_count !== receipt.expected_candidate_count
    || typeof receipt.expected_candidate_id_set_sha256 !== 'string'
    || !SHA256.test(receipt.expected_candidate_id_set_sha256)
    || receipt.published_candidate_id_set_sha256
      !== receipt.expected_candidate_id_set_sha256
    || receipt.live_graph_parity_verified !== false
    || receipt.pattern_parity_verified !== false
    || receipt.repository_default_graph_enabled !== false
    || receipt.activation_performed !== false) {
    fail('source-receipt-invalid');
  }
  if (!validInstant(asOf) || asOf.slice(0, 10) !== receipt.snapshot_date
    || receipt.refreshed_at.slice(0, 10) !== receipt.snapshot_date) {
    fail('source-receipt-invalid');
  }
  const age = Date.parse(asOf) - Date.parse(receipt.refreshed_at);
  if (age > MAX_AGE_MS || age < -FUTURE_SKEW_MS) {
    fail('source-receipt-invalid');
  }
}

function requireBoundTarget(url) {
  if (!ownExactKeys(TARGET, ['purpose', 'project_ref', 'project_name', 'region'])
    || TARGET.purpose !== 'agent-hub-reference-graph'
    || TARGET.project_ref !== PROJECT_REF
    || TARGET.project_name !== 'agent-hub-reference-graph'
    || TARGET.region !== 'eu-central-1'
    || url !== 'https://' + PROJECT_REF + '.supabase.co/') {
    fail('target-binding');
  }
}

/**
 * Compare the actual P30-fetched candidate rows against *externally pinned*
 * P27 baseline and P31 source-receipt bytes. The caller must obtain trusted
 * hashes independently; self-hashing all untrusted inputs is NOT evidence.
 *
 * A match validates only record order and coverage in 48 supplied cases.
 * It never verifies pattern output, target authorization, source provenance
 * independently of the operator, live rollout or operational quality.
 *
 * No writes, no token logs, no calls to the production router/collector.
 */
export async function auditP33PinnedProfileParity({
  supabaseUrl,
  publishableKey,
  asOf,
  baselineJson,
  baselineSha256,
  templatesJson,
  templatesSha256,
  sourceReceiptJson,
  sourceReceiptSha256,
  fetchImpl = globalThis.fetch,
  timeoutMs = 1500,
} = {}) {
  requireBoundTarget(supabaseUrl);

  // Byte pins and basic baseline shape are verified BEFORE network access.
  const baseline = verifyPinnedJson(baselineJson, baselineSha256, 2_000_000, 'baseline-pin');
  const templates = verifyPinnedJson(templatesJson, templatesSha256, 200_000, 'templates-pin');
  const receipt = verifyPinnedJson(sourceReceiptJson, sourceReceiptSha256, 20_000, 'source-receipt-pin');
  verifyReceipt(receipt, asOf);

  if (!Array.isArray(templates) || templates.length !== 24
    || !baseline || typeof baseline !== 'object' || Array.isArray(baseline)
    || baseline.schema_version !== 'reference-graph.p27-standard-deep-baseline.v1'
    || baseline.source_case_count !== 24
    || baseline.total_profile_cases !== 48
    || !Array.isArray(baseline.cases) || baseline.cases.length !== 48
    || baseline.reference_date !== receipt.snapshot_date
    || baseline.repository_default_graph_enabled !== false
    || baseline.activation_performed !== false) {
    fail('baseline-contract');
  }

  let remote;
  try {
    remote = await fetchP30ProfileCandidateSnapshot({
      supabaseUrl,
      publishableKey,
      expectedDate: receipt.snapshot_date,
      asOf,
      expectedCandidateCount: receipt.expected_candidate_count,
      expectedCandidateIdSetSha256: receipt.expected_candidate_id_set_sha256,
      fetchImpl,
      timeoutMs,
    });
  } catch (error) {
    if (error instanceof P30ProfileTransportError) {
      fail('transport-' + error.category);
    }
    fail('transport-unexpected');
  }
  if (remote.transport.refreshed_at !== receipt.refreshed_at) {
    fail('snapshot-binding');
  }

  let parity;
  try {
    parity = compareP29OfflineProfileParity({
      templates,
      candidates: remote.candidates,
      baseline,
      expectedReferenceDate: receipt.snapshot_date,
    });
  } catch {
    fail('baseline-contract');
  }

  // Only aggregate data can escape. No candidate content/IDs, receipts,
  // raw HTTP bodies or credentials are returned or printed.
  return {
    schema_version: 'reference-graph.p33-pinned-profile-parity.v2',
    reference_date: receipt.snapshot_date,
    candidate_count: remote.transport.candidate_count,
    candidate_id_set_sha256: remote.transport.candidate_id_set_sha256,
    // Exact content of the P30-verified HTTP candidate snapshot. P34 must
    // compare this to its supplied candidates before running any parity.
    candidate_content_sha256: hashP33CandidateContent(remote.candidates),
    evaluated_cases: parity.evaluated_cases,
    exact_order_cases: parity.exact_order_cases,
    mismatch_cases: parity.mismatch_cases,
    mismatch_by_profile: parity.mismatch_by_profile,
    record_order_coverage_parity_exact: parity.evaluated_cases === 48
      && parity.mismatch_cases === 0,
    pinned_inputs_verified: true,
    transport_contract_verified: true,
    pattern_parity_verified: false,
    live_graph_parity_verified: false,
    repository_default_graph_enabled: false,
    activation_performed: false,
    deployment_authorized: false,
    eligible_for_activation: false,
  };
}
