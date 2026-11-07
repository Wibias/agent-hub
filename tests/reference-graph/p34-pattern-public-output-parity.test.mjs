import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPatterns, loadRecords, stripInternal } from '../../knowledge/design-references/scripts/lib.mjs';
import { runP11RuntimeQuery } from '../../reference-graph/p11-runtime-router.mjs';
import { buildP28OfflineProfileCandidatePool } from '../../reference-graph/p28-profile-candidate-contract.mjs';
import { evaluateP27StandardDeepBaseline } from '../../reference-graph/p27-standard-deep-baseline.mjs';
import { auditP33PinnedProfileParity } from '../../reference-graph/p33-pinned-profile-parity.mjs';
import {
  P34PublicOutputParityError,
  auditP34PatternPublicOutputParity,
} from '../../reference-graph/p34-pattern-public-output-parity.mjs';

const date = '2026-11-07';
const now = new Date(date + 'T00:00:00.000Z');
const records = loadRecords();
const patterns = loadPatterns();
const templates = JSON.parse(readFileSync('reference-graph/shadow-cases.json', 'utf8'));
const candidates = buildP28OfflineProfileCandidatePool({ records, now });
const baseline = evaluateP27StandardDeepBaseline({ templates, records, patterns, now });
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const strings = {
  templatesJson: JSON.stringify(templates),
  baselineJson: JSON.stringify(baseline),
  recordsJson: JSON.stringify(records.map(stripInternal)),
  patternsJson: JSON.stringify(patterns.map(stripInternal)),
};
const sourceReceipt = {
  schema_version: 'reference-graph.p31-source-snapshot-receipt.v1',
  projection_version: 'reference-graph.profile-runtime.p30.v1',
  snapshot_date: date,
  refreshed_at: '2026-11-07T11:30:00.000Z',
  expected_candidate_count: candidates.length,
  expected_candidate_id_set_sha256: sha(candidates.map(row => row.legacy_id).sort().join('\n')),
  published_candidate_count: candidates.length,
  published_candidate_id_set_sha256: sha(candidates.map(row => row.legacy_id).sort().join('\n')),
  live_graph_parity_verified: false,
  pattern_parity_verified: false,
  repository_default_graph_enabled: false,
  activation_performed: false,
};
const receiptJson = JSON.stringify(sourceReceipt);
const responseRows = [...candidates]
  .sort((a, b) => a.asset_id.localeCompare(b.asset_id))
  .map(row => ({
    ...row,
    projection_version: sourceReceipt.projection_version,
    snapshot_date: date,
    refreshed_at: '2026-11-07T11:30:00+00:00',
  }));

const p33Report = await auditP33PinnedProfileParity({
  supabaseUrl: 'https://vrznfnxzlxaavpqbzbzd.supabase.co/',
  publishableKey: 'sb_publishable_p34_ci_only',
  asOf: '2026-11-07T12:00:00.000Z',
  baselineJson: strings.baselineJson,
  baselineSha256: sha(strings.baselineJson),
  templatesJson: strings.templatesJson,
  templatesSha256: sha(strings.templatesJson),
  sourceReceiptJson: receiptJson,
  sourceReceiptSha256: sha(receiptJson),
  fetchImpl: async () => ({ ok: true, json: async () => responseRows }),
});

let firstSelectedPatternId;
let firstSelectedRecordId;

async function publicControlFingerprints() {
  const cases = [];
  for (const template of [...templates].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const profile of ['standard', 'deep']) {
      const request = {
        profile, limit: profile === 'deep' ? 28 : 12,
        surface: template.surface, platform: template.platform,
        job: template.job, dimensions: template.dimensions,
      };
      const control = await runP11RuntimeQuery({
        records, patterns, request, graphMode: 'legacy',
        recordUsageEnabled: false, now,
      });
      assert.equal(control.routing.authoritative_source, 'legacy-control');
      firstSelectedPatternId ??= control.result.patterns[0]?.id;
      firstSelectedRecordId ??= control.result.records[0]?.id;
      cases.push({
        source_case_id: template.id, profile,
        public_output_sha256: sha(JSON.stringify(control.result)),
      });
    }
  }
  return {
    schema_version: 'reference-graph.p34-legacy-public-baseline.v1',
    reference_date: date, cases,
  };
}
const publicBaseline = await publicControlFingerprints();
const publicBaselineJson = JSON.stringify(publicBaseline);
const p33ReportJson = JSON.stringify(p33Report);
const input = {
  ...strings,
  templatesSha256: sha(strings.templatesJson),
  baselineSha256: sha(strings.baselineJson),
  recordsSha256: sha(strings.recordsJson),
  patternsSha256: sha(strings.patternsJson),
  publicBaselineJson,
  publicBaselineSha256: sha(publicBaselineJson),
  p33ReportJson,
  p33ReportSha256: sha(p33ReportJson),
  candidates,
};

test('P34 independently reconstructs exact legacy pattern order and full public JSON in all 48 cases', () => {
  const result = auditP34PatternPublicOutputParity(input);
  assert.equal(result.schema_version, 'reference-graph.p34-pattern-public-output-parity.v2');
  assert.equal(result.reference_date, date);
  assert.equal(result.evaluated_cases, 48);
  assert.equal(result.record_order_exact_cases, 48);
  assert.equal(result.pattern_exact_cases, 48);
  assert.equal(result.public_output_exact_cases, 48);
  assert.equal(result.mismatch_cases, 0);
  assert.equal(result.pattern_parity_verified, true);
  assert.equal(result.candidate_content_bound_to_p33, true);
  assert.equal(result.public_output_parity_verified, true);
  assert.equal(result.live_graph_parity_verified, false);
  assert.equal(result.deployment_authorized, false);
  assert.equal(result.repository_default_graph_enabled, false);
  assert.equal(result.activation_performed, false);
  assert.equal(result.eligible_for_activation, false);
  assert.doesNotMatch(JSON.stringify(result), /search_text|canonicalUrl|sb_publishable|source_case_id/);
});

test('P34 detects changed pattern output when record IDs and pattern IDs stay identical', () => {
  const mutated = patterns.map(stripInternal);
  const first = mutated.find(row => row.id === firstSelectedPatternId);
  assert.ok(first, 'Expected a P11-selected control pattern');
  first.problem += ' extra copy';
  const patternsJson = JSON.stringify(mutated);
  const result = auditP34PatternPublicOutputParity({
    ...input, patternsJson, patternsSha256: sha(patternsJson),
  });
  assert.equal(result.record_order_exact_cases, 48);
  assert.ok(result.public_output_exact_cases < 48);
  assert.equal(result.public_output_parity_verified, false);
  assert.equal(result.deployment_authorized, false);
});

test('P34 detects changes to record content even with identical graph candidate identity', () => {
  const changed = records.map(stripInternal);
  const first = changed.find(row => row.id === firstSelectedRecordId);
  assert.ok(first, 'Expected a P11-selected control record');
  first.title += ' changed';
  const recordsJson = JSON.stringify(changed);
  const result = auditP34PatternPublicOutputParity({
    ...input, recordsJson, recordsSha256: sha(recordsJson),
  });
  assert.ok(result.public_output_exact_cases < 48);
  assert.equal(result.live_graph_parity_verified, false);
});

test('P34 detects separately pinned P27 pattern-ID divergence without hiding record parity', () => {
  const changed = structuredClone(baseline);
  changed.cases[0].ordered_pattern_ids_sha256 = '0'.repeat(64);
  const baselineJson = JSON.stringify(changed);
  const result = auditP34PatternPublicOutputParity({
    ...input, baselineJson, baselineSha256: sha(baselineJson),
  });
  assert.equal(result.record_order_exact_cases, 48);
  assert.ok(result.pattern_exact_cases < 48);
  assert.equal(result.pattern_parity_verified, false);
});

test('P34 binds the exact candidate metadata seen by P33, not only their identity set', () => {
  // This extra tag is P28-valid but is not used in P29 ranking: legacy
  // 48/48 record/pattern/public results would still match without binding.
  const changed = candidates.map((candidate, i) => i === 0
    ? { ...candidate, tags: [...candidate.tags, 'p33-hash-probe'] }
    : candidate);
  assert.throws(
    () => auditP34PatternPublicOutputParity({ ...input, candidates: changed }),
    error => error instanceof P34PublicOutputParityError
      && error.category === 'candidate-snapshot-binding',
  );
});

test('P34 rejects an altered reported candidate-content fingerprint even with valid JSON byte pin', () => {
  const changed = {
    ...p33Report, candidate_content_sha256: '0'.repeat(64),
  };
  const p33ReportJson = JSON.stringify(changed);
  assert.throws(
    () => auditP34PatternPublicOutputParity({
      ...input, p33ReportJson, p33ReportSha256: sha(p33ReportJson),
    }),
    error => error instanceof P34PublicOutputParityError
      && error.category === 'candidate-snapshot-binding',
  );
});

test('P34 fails closed on missing or self-inconsistent pins and untrusted P33 report', () => {
  const variants = [
    { baselineSha256: undefined },
    { patternsSha256: undefined },
    { recordsSha256: '0'.repeat(64) },
    { publicBaselineSha256: '0'.repeat(64) },
    { p33ReportSha256: undefined },
    { p33ReportJson: JSON.stringify({ ...p33Report, deployment_authorized: true }) },
    { p33ReportJson: JSON.stringify({ ...p33Report, live_graph_parity_verified: true }) },
    { p33ReportJson: JSON.stringify({ ...p33Report, candidate_count: 1 }) },
    { candidates: [{ ...candidates[0] }] },
  ];
  for (const patch of variants) {
    assert.throws(() => auditP34PatternPublicOutputParity({ ...input, ...patch }),
      P34PublicOutputParityError);
  }
});

test('P34 cannot silently accept an altered expected public-output case', () => {
  const baselineOutput = structuredClone(publicBaseline);
  baselineOutput.cases[0].public_output_sha256 = '0'.repeat(64);
  const publicBaselineJson = JSON.stringify(baselineOutput);
  const result = auditP34PatternPublicOutputParity({
    ...input, publicBaselineJson,
    publicBaselineSha256: sha(publicBaselineJson),
  });
  assert.equal(result.public_output_exact_cases, 47);
  assert.equal(result.public_output_parity_verified, false);
});

test('P34 remains offline, has its own pattern decision procedure and makes no production changes', () => {
  const src = readFileSync('reference-graph/p34-pattern-public-output-parity.mjs', 'utf8');
  assert.match(src, /selectP29ProfileCandidateIds/);
  assert.match(src, /ordered_pattern_ids_sha256/);
  assert.match(src, /public_output_sha256/);
  assert.doesNotMatch(src, /import.*selectPatterns|import.*selectRecords|runP11RuntimeQuery|fetchP30ProfileCandidateSnapshot|recordUsage|SUPABASE_SERVICE_ROLE_KEY|writeFile|process\.env|apply_migration/i);
  const router = readFileSync('reference-graph/p11-runtime-router.mjs', 'utf8');
  assert.doesNotMatch(router, /p34-pattern-public-output-parity/);
});
