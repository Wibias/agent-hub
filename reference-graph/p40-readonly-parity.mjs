import { createHash } from 'node:crypto';

import { fetchP30ProfileCandidateSnapshot } from './p30-profile-transport.mjs';
import { compareP29OfflineProfileParity } from './p29-offline-profile-parity.mjs';
import { hashP33CandidateContent } from './p33-candidate-content-digest.mjs';
import { auditP34PatternPublicOutputParity } from './p34-pattern-public-output-parity.mjs';
import { validateP40ReadOnlySourceWitness } from './p40-readonly-witness.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const TARGET = 'https://vrznfnxzlxaavpqbzbzd.supabase.co/';

export class P40ReadOnlyParityError extends Error {
  constructor(category) {
    super('P40 read-only parity rejected: ' + category);
    this.name = 'P40ReadOnlyParityError';
    this.category = category;
  }
}

function reject(category) {
  throw new P40ReadOnlyParityError(category);
}

function sha(raw) {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function pinned(raw, digest, maxBytes) {
  if (typeof raw !== 'string' || raw.length === 0
    || Buffer.byteLength(raw, 'utf8') > maxBytes
    || typeof digest !== 'string' || !SHA256.test(digest)
    || sha(raw) !== digest) {
    reject('offline-pin');
  }
  try {
    return JSON.parse(raw);
  } catch {
    reject('invalid-offline-json');
  }
}

/**
 * P40 is a NEW, separately versioned read-only parity lane, not a rewrite of
 * the historically pinned P33 or P37 modules.
 *
 * The P33-v2-compatible nested result is only a data contract for P34's
 * unchanged strict comparator. It does NOT assert that the P33 original
 * receipt exists or that an independent reviewer has attested the input.
 */
async function collectP40(input) {
  const {
    supabaseUrl, serviceKey, accessMode,
    asOf, sourceWitnessJson, sourceWitnessSha256,
    baselineJson, baselineSha256, templatesJson, templatesSha256,
    timeoutMs = 5000, fetchImpl = globalThis.fetch,
  } = input;

  if (supabaseUrl !== TARGET || accessMode !== 'server') reject('target-or-access');
  const witness = pinned(sourceWitnessJson, sourceWitnessSha256, 20_000);
  let expected;
  try {
    expected = validateP40ReadOnlySourceWitness(witness, { asOf });
  } catch {
    reject('source-witness-invalid');
  }
  const baseline = pinned(baselineJson, baselineSha256, 2_000_000);
  const templates = pinned(templatesJson, templatesSha256, 200_000);
  if (!baseline || baseline.schema_version !== 'reference-graph.p27-standard-deep-baseline.v1'
    || baseline.reference_date !== expected.snapshot_date
    || baseline.source_case_count !== 24 || baseline.total_profile_cases !== 48
    || !Array.isArray(baseline.cases) || baseline.cases.length !== 48
    || !Array.isArray(templates) || templates.length !== 24) {
    reject('legacy-baseline-invalid');
  }

  let remote;
  try {
    remote = await fetchP30ProfileCandidateSnapshot({
      supabaseUrl, serviceKey, accessMode: 'server',
      expectedDate: expected.snapshot_date, asOf,
      expectedCandidateCount: expected.expected_candidate_count,
      expectedCandidateIdSetSha256: expected.expected_candidate_id_set_sha256,
      timeoutMs, fetchImpl,
    });
  } catch {
    reject('p30-transport');
  }
  if (remote.transport.refreshed_at !== expected.refreshed_at) {
    reject('snapshot-refresh-mismatch');
  }

  let parity;
  try {
    parity = compareP29OfflineProfileParity({
      templates, candidates: remote.candidates,
      baseline, expectedReferenceDate: expected.snapshot_date,
    });
  } catch {
    reject('record-parity-invalid');
  }

  const compatibleReport = {
    schema_version: 'reference-graph.p33-pinned-profile-parity.v2',
    reference_date: expected.snapshot_date,
    candidate_count: remote.transport.candidate_count,
    candidate_id_set_sha256: remote.transport.candidate_id_set_sha256,
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

  const report = {
    schema_version: 'reference-graph.p40-readonly-record-parity.v1',
    source_method: 'p7-vs-p31-read-only',
    reference_date: expected.snapshot_date,
    refreshed_at: expected.refreshed_at,
    witness_sha256: sourceWitnessSha256,
    p33_compatible_report: compatibleReport,
    activation_authorized: false,
    repository_default_graph_enabled: false,
  };
  return { report, candidates: remote.candidates };
}

/**
 * First read-only stage: separately archive the exact compact JSON result and
 * independent SHA256 BEFORE any subsequent full-output parity request.
 */
export async function auditP40ReadOnlyRecordParity(input = {}) {
  const { report } = await collectP40(input);
  return report;
}

/**
 * Second read-only stage: require an independently pinned P40 stage-one
 * aggregate report, read ONE validated P30 snapshot, then compare P34
 * pattern and full Legacy JSON output over that SAME validated candidate set.
 * Zero writes/activation. Candidate arrays and keys never escape the report.
 */
export async function auditP40ReadOnlyFullParity(input = {}) {
  if (typeof input.expectedP40RecordReportSha256 !== 'string'
    || !SHA256.test(input.expectedP40RecordReportSha256)) {
    reject('record-report-pin');
  }
  // Reject all malformed local input pins before any privileged HTTP request.
  for (const [raw, digest, maxBytes] of [
    [input.recordsJson, input.recordsSha256, 16_000_000],
    [input.patternsJson, input.patternsSha256, 4_000_000],
    [input.publicBaselineJson, input.publicBaselineSha256, 100_000],
  ]) {
    pinned(raw, digest, maxBytes);
  }

  let requests = 0;
  const originalFetch = input.fetchImpl ?? globalThis.fetch;
  const fetchImpl = async (...args) => {
    requests++;
    return originalFetch(...args);
  };
  const { report, candidates } = await collectP40({ ...input, fetchImpl });
  if (sha(JSON.stringify(report)) !== input.expectedP40RecordReportSha256) {
    reject('record-report-pin');
  }
  const p33ReportJson = JSON.stringify(report.p33_compatible_report);
  let p34;
  try {
    p34 = auditP34PatternPublicOutputParity({
      templatesJson: input.templatesJson,
      templatesSha256: input.templatesSha256,
      baselineJson: input.baselineJson,
      baselineSha256: input.baselineSha256,
      recordsJson: input.recordsJson,
      recordsSha256: input.recordsSha256,
      patternsJson: input.patternsJson,
      patternsSha256: input.patternsSha256,
      publicBaselineJson: input.publicBaselineJson,
      publicBaselineSha256: input.publicBaselineSha256,
      p33ReportJson,
      p33ReportSha256: sha(p33ReportJson),
      candidates,
    });
  } catch {
    reject('p34-pattern-or-public-output');
  }
  return {
    schema_version: 'reference-graph.p40-readonly-full-parity.v1',
    source_method: 'p7-vs-p31-read-only',
    reference_date: report.reference_date,
    refreshed_at: report.refreshed_at,
    http_request_count: requests,
    p40_record_report_pin_matched: true,
    p33_compatible_report: report.p33_compatible_report,
    p34,
    live_graph_parity_verified: false,
    deployment_authorized: false,
    activation_authorized: false,
    eligible_for_activation: false,
    repository_default_graph_enabled: false,
  };
}
