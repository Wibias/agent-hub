import { createHash } from 'node:crypto';

import {
  TAXONOMY, isFresh, overlap, recordSearchText, stripInternal, tokenize,
} from '../knowledge/design-references/scripts/lib.mjs';
import { auditP28ProfileCandidateContract } from './p28-profile-candidate-contract.mjs';
import { hashP33CandidateContent } from './p33-candidate-content-digest.mjs';
import {
  selectP29ProfileCandidateIds, compareP29OfflineProfileParity,
} from './p29-offline-profile-parity.mjs';

// P34 is an independent OFFLINE audit of supplied, previously verified
// P30/P33 candidate evidence. It is NOT a runtime router, a release authority,
// a new pattern selection path in production, or a live Supabase client.
const SHA256 = /^[0-9a-f]{64}$/;
const PROFILES = Object.freeze(['standard', 'deep']);
const STRATUM_ORDER = Object.freeze([
  'direct-domain', 'evidence-craft', 'adjacent-domain', 'outside-domain',
]);
const VISUAL_DIMENSIONS = Object.freeze([
  'visual-world', 'visual', 'art-direction', 'palette', 'typography',
]);
const P33_REPORT_KEYS = Object.freeze([
  'schema_version', 'reference_date', 'candidate_count',
  'candidate_id_set_sha256', 'candidate_content_sha256',
  'evaluated_cases', 'exact_order_cases',
  'mismatch_cases', 'mismatch_by_profile',
  'record_order_coverage_parity_exact', 'pinned_inputs_verified',
  'transport_contract_verified', 'pattern_parity_verified',
  'live_graph_parity_verified', 'repository_default_graph_enabled',
  'activation_performed', 'deployment_authorized', 'eligible_for_activation',
]);
const BASELINE_KEYS = Object.freeze([
  'schema_version', 'reference_date', 'cases',
]);
const PUBLIC_CASE_KEYS = Object.freeze([
  'source_case_id', 'profile', 'public_output_sha256',
]);

export class P34PublicOutputParityError extends Error {
  constructor(category) {
    super('P34 pattern/public output parity failed: ' + category);
    this.name = 'P34PublicOutputParityError';
    this.category = category;
  }
}

function fail(category) {
  throw new P34PublicOutputParityError(category);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
}

function hash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function pinnedJson(raw, expectedHash, maxBytes, category) {
  if (typeof raw !== 'string' || raw.length === 0
    || Buffer.byteLength(raw, 'utf8') > maxBytes
    || typeof expectedHash !== 'string' || !SHA256.test(expectedHash)
    || hash(raw) !== expectedHash) {
    fail(category);
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail(category);
  }
}

function orderedIdsHash(rows) {
  return hash(rows.join('\n'));
}

function validatePinnedSource({
  templates, baseline, records, patterns, publicBaseline, p33Report,
  candidates,
}) {
  if (!exactKeys(p33Report, P33_REPORT_KEYS)
    || p33Report.schema_version !== 'reference-graph.p33-pinned-profile-parity.v2'
    || p33Report.evaluated_cases !== 48
    || p33Report.exact_order_cases !== 48
    || p33Report.mismatch_cases !== 0
    || !exactKeys(p33Report.mismatch_by_profile, PROFILES)
    || p33Report.mismatch_by_profile.standard !== 0
    || p33Report.mismatch_by_profile.deep !== 0
    || p33Report.record_order_coverage_parity_exact !== true
    || p33Report.pinned_inputs_verified !== true
    || p33Report.transport_contract_verified !== true
    || p33Report.pattern_parity_verified !== false
    || p33Report.live_graph_parity_verified !== false
    || p33Report.repository_default_graph_enabled !== false
    || p33Report.activation_performed !== false
    || p33Report.deployment_authorized !== false
    || p33Report.eligible_for_activation !== false
    || typeof p33Report.reference_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(p33Report.reference_date)
    || !SHA256.test(p33Report.candidate_id_set_sha256)
    || !SHA256.test(p33Report.candidate_content_sha256)
    || !Number.isInteger(p33Report.candidate_count)
    || p33Report.candidate_count < 1
    || p33Report.candidate_count > 5000) {
    fail('p33-report-invalid');
  }

  const day = new Date(p33Report.reference_date + 'T00:00:00.000Z');
  if (!Number.isFinite(day.valueOf())
    || day.toISOString().slice(0, 10) !== p33Report.reference_date) {
    fail('p33-report-invalid');
  }

  if (!Array.isArray(templates) || templates.length !== 24
    || !baseline || baseline.schema_version !== 'reference-graph.p27-standard-deep-baseline.v1'
    || baseline.reference_date !== p33Report.reference_date
    || baseline.total_profile_cases !== 48
    || baseline.source_case_count !== 24
    || !Array.isArray(baseline.cases) || baseline.cases.length !== 48
    || baseline.activation_performed !== false
    || baseline.repository_default_graph_enabled !== false
    || !exactKeys(publicBaseline, BASELINE_KEYS)
    || publicBaseline.schema_version !== 'reference-graph.p34-legacy-public-baseline.v1'
    || publicBaseline.reference_date !== p33Report.reference_date
    || !Array.isArray(publicBaseline.cases)
    || publicBaseline.cases.length !== 48
    || !Array.isArray(records) || records.length === 0
    || !Array.isArray(patterns) || patterns.length === 0) {
    fail('input-contract');
  }

  const expectedCases = new Set();
  for (const source of templates) {
    if (!source || typeof source.id !== 'string'
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.id)
      || source.profile !== 'quick'
      || source.limit !== TAXONOMY.profiles.quick.default) {
      fail('input-contract');
    }
    for (const profile of PROFILES) {
      const key = source.id + ':' + profile;
      if (expectedCases.has(key)) fail('input-contract');
      expectedCases.add(key);
    }
  }
  const publicHashes = new Map();
  for (const row of publicBaseline.cases) {
    if (!exactKeys(row, PUBLIC_CASE_KEYS)
      || !PROFILES.includes(row.profile)
      || !SHA256.test(row.public_output_sha256)) fail('input-contract');
    const key = row.source_case_id + ':' + row.profile;
    if (!expectedCases.has(key) || publicHashes.has(key)) {
      fail('input-contract');
    }
    publicHashes.set(key, row.public_output_sha256);
  }
  if (publicHashes.size !== 48) fail('input-contract');

  const recordById = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || typeof record.id !== 'string' || !record.id.trim()
      || recordById.has(record.id)) {
      fail('input-contract');
    }
    recordById.set(record.id, record);
  }
  const patternIds = new Set();
  for (const pattern of patterns) {
    if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern)
      || typeof pattern.id !== 'string' || !pattern.id.trim()
      || patternIds.has(pattern.id)
      || !Array.isArray(pattern.examples)
      || !Array.isArray(pattern.counterexamples)
      || !Array.isArray(pattern.worksWhen)
      || !Array.isArray(pattern.failsWhen)
      || !Array.isArray(pattern.tags)) {
      fail('input-contract');
    }
    patternIds.add(pattern.id);
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    fail('candidate-invalid');
  }
  let audit;
  try {
    audit = auditP28ProfileCandidateContract({ candidates });
  } catch {
    fail('candidate-invalid');
  }
  if (!audit.metadata_contract_complete
    || audit.candidate_count !== p33Report.candidate_count
    || audit.candidate_id_set_sha256 !== p33Report.candidate_id_set_sha256) {
    fail('candidate-invalid');
  }

  // Exact metadata provenance is required. Same candidate IDs alone are
  // insufficient: valid but changed tags/search_text/motion could otherwise
  // pass every P34 selected-order test despite coming from a different
  // P30 snapshot than the one P33 actually audited.
  let actualContentHash;
  try {
    actualContentHash = hashP33CandidateContent(candidates);
  } catch {
    fail('candidate-invalid');
  }
  if (actualContentHash !== p33Report.candidate_content_sha256) {
    fail('candidate-snapshot-binding');
  }

  return { day, publicHashes, recordById };
}

function deepQuotas(limit) {
  // Reimplementation of the profile policy, not an invocation of the
  // legacy record selector or of P29's private quota helper.
  const quotas = Object.fromEntries(Object.entries(TAXONOMY.primaryStrata)
    .map(([name, settings]) => [name, settings.deepMin]));
  let remaining = limit - Object.values(quotas)
    .reduce((sum, value) => sum + value, 0);
  while (remaining > 0) {
    let progressed = false;
    for (const stratum of STRATUM_ORDER) {
      if (remaining === 0) break;
      if (quotas[stratum] < TAXONOMY.primaryStrata[stratum].deepMax) {
        quotas[stratum]++;
        remaining--;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return quotas;
}

function recordBaseScore(record, request) {
  const terms = tokenize([
    request.job || '', request.dimensions || '', request.surface || '',
  ].join(' '));
  let score = 0;
  if (request.surface && record.surfaceFamily === request.surface) score += 60;
  if (request.platform && record.platform === request.platform) score += 15;
  score += overlap(terms, tokenize(recordSearchText(record))) * 5;
  if (record.multiStateFlow) score += 4;
  if (record.ordinaryOrFailureProne) score += 3;
  if (record.evidenceClass === 'TESTED') score += 3;
  if (record.accessStatus === 'AVAILABLE') score += 2;
  if (VISUAL_DIMENSIONS.some(dim =>
    String(request.dimensions || '').toLowerCase().includes(dim))) {
    if (Array.isArray(record.tags) && record.tags.includes('visual-verified')) {
      score += 25;
    } else if (/help|docs|guide|support|marketing/i.test(record.pageRole || '')) {
      score -= 20;
    }
  }
  return score;
}

function independentPatterns(patterns, selectedRecordIds, request) {
  // Separate decision loop from legacy selectPatterns. It consumes only the
  // frozen pattern catalog, graph-selected record IDs and request metadata.
  const chosenIds = new Set(selectedRecordIds);
  const words = tokenize([request.surface, request.job, request.dimensions].join(' '));
  const limit = request.profile === 'deep' ? 8 : 4;
  const ranked = [];
  for (const pattern of patterns) {
    if (pattern.reviewStatus !== 'reviewed') continue;
    const linked = [...pattern.examples, ...pattern.counterexamples]
      .filter(id => chosenIds.has(id)).length;
    const searchable = [
      pattern.name, pattern.problem, ...pattern.worksWhen,
      ...pattern.failsWhen, ...pattern.tags,
    ].join(' ');
    const score = linked * 20 + overlap(words, tokenize(searchable)) * 5;
    if (score > 0) ranked.push({ pattern, score });
  }
  ranked.sort((a, b) => b.score - a.score
    || a.pattern.id.localeCompare(b.pattern.id));
  return ranked.slice(0, limit).map(({ pattern, score }) => ({
    ...stripInternal(pattern), selectionScore: score,
  }));
}

function constructPublicOutput({ ids, request, recordById, patterns, now }) {
  const hydrated = ids.map(id => {
    const record = recordById.get(id);
    if (!record
      || record.reviewStatus !== 'reviewed'
      || !['AVAILABLE', 'PAYWALLED'].includes(record.accessStatus)
      || !isFresh(record, now)) fail('hydration-invalid');
    return record;
  });
  const selectedRecords = [];
  const byStratum = {};
  const productCounts = new Map();
  const sourceCounts = new Map();
  const topologyCounts = new Map();
  for (const record of hydrated) {
    const score = recordBaseScore(record, request)
      - (productCounts.get(record.product) || 0) * 20
      - (sourceCounts.get(record.sourceFamily) || 0) * 8
      - (topologyCounts.get(record.topology) || 0) * 6;
    selectedRecords.push({ ...stripInternal(record), selectionScore: score });
    byStratum[record.primaryStratum] = (byStratum[record.primaryStratum] || 0) + 1;
    productCounts.set(record.product, (productCounts.get(record.product) || 0) + 1);
    sourceCounts.set(record.sourceFamily, (sourceCounts.get(record.sourceFamily) || 0) + 1);
    topologyCounts.set(record.topology, (topologyCounts.get(record.topology) || 0) + 1);
  }

  const gaps = [];
  if (request.profile === 'deep') {
    for (const [stratum, quota] of Object.entries(deepQuotas(request.limit))) {
      const count = byStratum[stratum] || 0;
      if (count < quota) gaps.push({ stratum, required: quota, selected: count });
    }
  }
  if (hydrated.length < request.limit) {
    gaps.push({ kind: 'total', required: request.limit, selected: hydrated.length });
  }
  const exactSurface = hydrated.filter(record =>
    record.surfaceFamily === request.surface).length;
  const exactPlatform = hydrated.filter(record =>
    record.platform === request.platform).length;
  const surfaceMinimum = request.profile === 'deep' ? 6 : 3;
  if (request.surface && exactSurface < surfaceMinimum) {
    gaps.push({
      kind: 'surface', value: request.surface,
      required: surfaceMinimum, selected: exactSurface,
    });
  }
  const platformMinimum = Math.ceil(request.limit / 2);
  if (request.platform && exactPlatform < platformMinimum) {
    gaps.push({
      kind: 'platform', value: request.platform,
      required: platformMinimum, selected: exactPlatform,
    });
  }

  const selectedPatterns = independentPatterns(patterns, ids, request);
  // The exact P11 public JSON shape, but built without P11 or either legacy
  // selector. The frozen P11 control is supplied as a separate SHA-256 pin.
  return {
    profile: request.profile,
    requested: {
      surface: request.surface || null,
      platform: request.platform || null,
      job: request.job || null,
      dimensions: request.dimensions
        ? String(request.dimensions).split(',').filter(Boolean) : [],
      limit: request.limit,
    },
    countsByStratum: byStratum,
    coverage: { exactSurface, exactPlatform },
    coverageGaps: gaps,
    requiresTargetedResearch: gaps.length > 0,
    usageWarning: null,
    records: selectedRecords,
    patterns: selectedPatterns,
  };
}

/**
 * Offline read-only comparison over *already validated* P30 candidate DTOs.
 * All P27, P33 and public-control evidence must be externally hash-pinned.
 * Tests can generate local pins for regression, but that is not live proof.
 *
 * This function never calls Supabase, legacy selectors, the runtime query,
 * the usage recorder or any filesystem write. Only aggregate data escapes.
 */
export function auditP34PatternPublicOutputParity({
  templatesJson, templatesSha256,
  baselineJson, baselineSha256,
  recordsJson, recordsSha256,
  patternsJson, patternsSha256,
  publicBaselineJson, publicBaselineSha256,
  p33ReportJson, p33ReportSha256,
  candidates,
} = {}) {
  const templates = pinnedJson(templatesJson, templatesSha256, 200_000, 'pin-invalid');
  const baseline = pinnedJson(baselineJson, baselineSha256, 2_000_000, 'pin-invalid');
  const records = pinnedJson(recordsJson, recordsSha256, 16_000_000, 'pin-invalid');
  const patterns = pinnedJson(patternsJson, patternsSha256, 4_000_000, 'pin-invalid');
  const publicBaseline = pinnedJson(
    publicBaselineJson, publicBaselineSha256, 100_000, 'pin-invalid');
  const p33Report = pinnedJson(p33ReportJson, p33ReportSha256, 20_000, 'pin-invalid');
  const { day, publicHashes, recordById } = validatePinnedSource({
    templates, baseline, records, patterns, publicBaseline, p33Report, candidates,
  });

  let p29;
  try {
    p29 = compareP29OfflineProfileParity({
      templates, candidates, baseline,
      expectedReferenceDate: p33Report.reference_date,
    });
  } catch {
    fail('input-contract');
  }

  const baselineByCase = new Map(baseline.cases.map(row =>
    [row.source_case_id + ':' + row.profile, row]));
  let recordExact = 0;
  let patternExact = 0;
  let publicExact = 0;
  let mismatches = 0;
  const mismatchByProfile = { standard: 0, deep: 0 };
  for (const template of [...templates].sort((a, b) =>
    a.id.localeCompare(b.id))) {
    for (const profile of PROFILES) {
      const key = template.id + ':' + profile;
      const expected = baselineByCase.get(key);
      const request = {
        profile,
        limit: TAXONOMY.profiles[profile].default,
        surface: template.surface,
        platform: template.platform,
        job: template.job,
        dimensions: template.dimensions,
      };
      let choice;
      try {
        choice = selectP29ProfileCandidateIds({ candidates, request });
      } catch {
        fail('candidate-invalid');
      }
      const actualPublic = constructPublicOutput({
        ids: choice.ids, request, recordById, patterns, now: day,
      });
      const orderMatch = expected
        && expected.selected_count === choice.ids.length
        && expected.ordered_record_ids_sha256 === orderedIdsHash(choice.ids)
        && JSON.stringify(expected.coverage_gap_kinds)
          === JSON.stringify(actualPublic.coverageGaps.map(gap => gap.kind ?? 'stratum'));
      const patternMatch = expected
        && actualPublic.patterns.length === expected.pattern_count
        && orderedIdsHash(actualPublic.patterns.map(row => row.id))
          === expected.ordered_pattern_ids_sha256;
      const outputMatch = hash(JSON.stringify(actualPublic)) === publicHashes.get(key);
      if (orderMatch) recordExact++;
      if (patternMatch) patternExact++;
      if (outputMatch) publicExact++;
      if (!(orderMatch && patternMatch && outputMatch)) {
        mismatches++;
        mismatchByProfile[profile]++;
      }
    }
  }

  // P29's aggregate parity is an additional consistency check, never
  // substituted for independently recomputing pattern and public output.
  if (p29.exact_order_cases !== recordExact
    || p29.mismatch_cases > mismatches) fail('candidate-invalid');

  return {
    schema_version: 'reference-graph.p34-pattern-public-output-parity.v2',
    reference_date: p33Report.reference_date,
    evaluated_cases: 48,
    record_order_exact_cases: recordExact,
    pattern_exact_cases: patternExact,
    public_output_exact_cases: publicExact,
    mismatch_cases: mismatches,
    mismatch_by_profile: mismatchByProfile,
    pattern_parity_verified: recordExact === 48 && patternExact === 48,
    public_output_parity_verified: recordExact === 48
      && patternExact === 48 && publicExact === 48,
    pinned_inputs_verified: true,
    candidate_identity_bound_to_p33: true,
    candidate_content_bound_to_p33: true,
    live_graph_parity_verified: false,
    repository_default_graph_enabled: false,
    activation_performed: false,
    deployment_authorized: false,
    eligible_for_activation: false,
  };
}
