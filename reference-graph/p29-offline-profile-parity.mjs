import { createHash } from 'node:crypto';

import { TAXONOMY, tokenize, overlap } from '../knowledge/design-references/scripts/lib.mjs';
import { auditP28ProfileCandidateContract } from './p28-profile-candidate-contract.mjs';

const PROFILES = Object.freeze(['standard', 'deep']);
const REQUEST_KEYS = Object.freeze([
  'profile', 'limit', 'surface', 'platform', 'job', 'dimensions',
]);
const STRATUM_ORDER = Object.freeze([
  'direct-domain', 'evidence-craft', 'adjacent-domain', 'outside-domain',
]);
const VISUAL_DIMENSIONS = Object.freeze([
  'visual-world', 'visual', 'art-direction', 'palette', 'typography',
]);

function exactKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const left = Object.keys(value).sort();
  const right = [...allowed].sort();
  return left.length === right.length
    && left.every((key, index) => key === right[index]);
}

function validateRequest(request) {
  if (!exactKeys(request, REQUEST_KEYS)) {
    throw new TypeError('P29 request contains missing or unexpected fields');
  }
  if (!PROFILES.includes(request.profile)) {
    throw new Error('P29 profile must be standard or deep');
  }
  const limits = TAXONOMY.profiles[request.profile];
  if (!Number.isInteger(request.limit)
      || request.limit < limits.min || request.limit > limits.max) {
    throw new Error('P29 profile limit is invalid');
  }
  if (!Object.hasOwn(TAXONOMY.surfaceFamilies, request.surface)
      || !Object.hasOwn(TAXONOMY.platformTargets, request.platform)
      || typeof request.job !== 'string' || !request.job.trim()
      || typeof request.dimensions !== 'string' || !request.dimensions.trim()) {
    throw new Error('P29 request contains invalid metadata');
  }
}

function quotaFor(profile, limit) {
  if (profile !== 'deep') {
    return Object.fromEntries(
      Object.keys(TAXONOMY.primaryStrata).map(key => [key, limit]),
    );
  }
  const quotas = Object.fromEntries(
    Object.entries(TAXONOMY.primaryStrata).map(([key, policy]) => [key, policy.deepMin]),
  );
  let remaining = limit - Object.values(quotas).reduce((sum, item) => sum + item, 0);
  while (remaining > 0) {
    let changed = false;
    for (const stratum of STRATUM_ORDER) {
      if (remaining === 0) break;
      if (quotas[stratum] < TAXONOMY.primaryStrata[stratum].deepMax) {
        quotas[stratum] += 1;
        remaining--;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return quotas;
}

function scoreCandidate(row, request, words, visual) {
  const candidateWords = tokenize(
    [row.search_text, row.surface_family, row.motion].join(' '),
  );
  let score = 0;
  if (request.surface === row.surface_family) score += 60;
  if (request.platform === row.platform) score += 15;
  score += overlap(words, candidateWords) * 5;
  if (row.multi_state_flow) score += 4;
  if (row.ordinary_or_failure_prone) score += 3;
  if (row.evidence_class === 'TESTED') score += 3;
  if (row.access_status === 'AVAILABLE') score += 2;
  if (visual) {
    if (row.tags.includes('visual-verified')) score += 25;
    else if (/help|docs|guide|support|marketing/i.test(row.page_role || '')) score -= 20;
  }
  return score;
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function hashOrderedIds(ids) {
  return createHash('sha256').update(ids.join('\n'), 'utf8').digest('hex');
}

/**
 * Independent, deterministic candidate-only Standard/Deep selection.
 * Does not import or call legacy selectRecords, hydrate graph to source
 * records, write usage, or use any network/activation functionality.
 */
export function selectP29ProfileCandidateIds({ candidates, request } = {}) {
  validateRequest(request);
  const contract = auditP28ProfileCandidateContract({ candidates });
  if (!contract.metadata_contract_complete) {
    throw new Error('P29 candidate metadata contract is not complete');
  }

  const words = tokenize(
    [request.job, request.dimensions, request.surface].join(' '),
  );
  const visual = VISUAL_DIMENSIONS.some(dim =>
    request.dimensions.toLowerCase().includes(dim));
  const quotas = quotaFor(request.profile, request.limit);
  const pool = candidates.map(row => ({
    row,
    score: scoreCandidate(row, request, words, visual),
  }));

  const selected = [];
  const chosenIds = new Set();
  const selectedByStratum = {};
  const products = new Map();
  const sources = new Map();
  const topologies = new Map();

  while (selected.length < request.limit) {
    const remaining = pool
      .filter(item => !chosenIds.has(item.row.legacy_id))
      .filter(item => (selectedByStratum[item.row.primary_stratum] || 0)
        < quotas[item.row.primary_stratum])
      .map(item => {
        const row = item.row;
        return {
          row,
          rank: item.score
            - (products.get(row.product) || 0) * 20
            - (sources.get(row.source_family) || 0) * 8
            - (topologies.get(row.topology) || 0) * 6,
        };
      })
      .sort((a, b) => b.rank - a.rank
        || a.row.legacy_id.localeCompare(b.row.legacy_id));
    if (remaining.length === 0) break;

    const chosen = remaining[0].row;
    selected.push(chosen);
    chosenIds.add(chosen.legacy_id);
    selectedByStratum[chosen.primary_stratum] =
      (selectedByStratum[chosen.primary_stratum] || 0) + 1;
    increment(products, chosen.product);
    increment(sources, chosen.source_family);
    increment(topologies, chosen.topology);
  }

  const gapKinds = [];
  if (request.profile === 'deep') {
    for (const [stratum, quota] of Object.entries(quotas)) {
      if ((selectedByStratum[stratum] || 0) < quota) gapKinds.push('stratum');
    }
  }
  if (selected.length < request.limit) gapKinds.push('total');
  const exactSurface = selected.filter(row => row.surface_family === request.surface).length;
  const exactPlatform = selected.filter(row => row.platform === request.platform).length;
  const requiredSurface = request.profile === 'deep' ? 6 : 3;
  if (exactSurface < requiredSurface) gapKinds.push('surface');
  if (exactPlatform < Math.ceil(request.limit / 2)) gapKinds.push('platform');

  return {
    profile: request.profile,
    limit: request.limit,
    ids: selected.map(row => row.legacy_id),
    selected_by_stratum: selectedByStratum,
    coverage_gap_kinds: gapKinds,
  };
}

function validateBaseline(baseline, templates) {
  if (!baseline || baseline.schema_version !== 'reference-graph.p27-standard-deep-baseline.v1'
      || baseline.repository_default_graph_enabled !== false
      || baseline.activation_performed !== false
      || typeof baseline.reference_date !== 'string'
      || !/^\\d{4}-\\d{2}-\\d{2}$/.test(baseline.reference_date)
      || !Array.isArray(baseline.cases)
      || baseline.source_case_count !== templates.length
      || baseline.total_profile_cases !== templates.length * 2
      || baseline.cases.length !== templates.length * 2) {
    throw new Error('P29 baseline case count, profile binding or date is invalid');
  }

  const expected = new Set();
  const ids = new Set();
  for (const template of templates) {
    if (!template || typeof template.id !== 'string' || ids.has(template.id)
        || template.profile !== 'quick') {
      throw new Error('P29 invalid or duplicate source case id');
    }
    ids.add(template.id);
    for (const profile of PROFILES) expected.add(template.id + ':' + profile);
  }
  const byKey = new Map();
  for (const row of baseline.cases) {
    const key = row.source_case_id + ':' + row.profile;
    if (!expected.has(key) || byKey.has(key)
        || !Array.isArray(row.coverage_gap_kinds)
        || !/^[0-9a-f]{64}$/.test(row.ordered_record_ids_sha256)
        || row.limit !== TAXONOMY.profiles[row.profile]?.default
        || !Number.isInteger(row.selected_count)
        || row.selected_count < 0 || row.selected_count > row.limit) {
      throw new Error('P29 invalid or duplicated baseline case');
    }
    byKey.set(key, row);
  }
  if (byKey.size !== expected.size) {
    throw new Error('P29 baseline is missing expected cases');
  }
  return byKey;
}

/**
 * Compare local candidate-only Standard/Deep order and coverage to a
 * separately supplied P27 baseline. Does not assert live Graph parity,
 * pattern parity, production freshness or activation readiness.
 */
export function compareP29OfflineProfileParity({
  templates,
  candidates,
  baseline,
} = {}) {
  if (!Array.isArray(templates) || templates.length === 0) {
    throw new TypeError('P29 templates must be non-empty');
  }
  const byKey = validateBaseline(baseline, templates);
  let exactOrderCases = 0;
  let mismatchCases = 0;
  const mismatchByProfile = { standard: 0, deep: 0 };
  for (const template of [...templates].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const profile of PROFILES) {
      const source = byKey.get(template.id + ':' + profile);
      const request = {
        profile,
        limit: TAXONOMY.profiles[profile].default,
        surface: template.surface,
        platform: template.platform,
        job: template.job,
        dimensions: template.dimensions,
      };
      const result = selectP29ProfileCandidateIds({ candidates, request });
      const orderedMatch = hashOrderedIds(result.ids) === source.ordered_record_ids_sha256;
      if (orderedMatch) exactOrderCases++;
      const coverageMatch = JSON.stringify(result.coverage_gap_kinds)
        === JSON.stringify(source.coverage_gap_kinds);
      if (!orderedMatch || !coverageMatch || result.ids.length !== source.selected_count) {
        mismatchCases++;
        mismatchByProfile[profile]++;
      }
    }
  }
  return {
    schema_version: 'reference-graph.p29-offline-profile-parity.v1',
    reference_date: baseline.reference_date,
    evaluated_cases: templates.length * 2,
    exact_order_cases: exactOrderCases,
    mismatch_cases: mismatchCases,
    mismatch_by_profile: mismatchByProfile,
    legacy_record_selection_invoked: false,
    pattern_parity_verified: false,
    live_graph_parity_verified: false,
    repository_default_graph_enabled: false,
    activation_performed: false,
  };
}
