import {
  TAXONOMY, isFresh, overlap, recordSearchText, stripInternal, tokenize,
} from '../knowledge/design-references/scripts/lib.mjs';
import { hydrateP8LegacyIds } from './p8-cutover-review.mjs';
import { selectP29ProfileCandidateIds } from './p29-offline-profile-parity.mjs';

// Builds a real candidate-derived public response; never calls P11 or its selectors.
// Intentionally mirrors the separately tested P34 reconstruction for one request.
const STRATA = ['direct-domain', 'evidence-craft', 'adjacent-domain', 'outside-domain'];
const VISUAL = ['visual-world', 'visual', 'art-direction', 'palette', 'typography'];

function quotas(limit) {
  const out = Object.fromEntries(Object.entries(TAXONOMY.primaryStrata)
    .map(([name, policy]) => [name, policy.deepMin]));
  let left = limit - Object.values(out).reduce((a, b) => a + b, 0);
  while (left > 0) {
    let added = false;
    for (const name of STRATA) {
      if (!left) break;
      if (out[name] < TAXONOMY.primaryStrata[name].deepMax) {
        out[name]++; left--; added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

function baseScore(record, request) {
  const words = tokenize([request.job || '', request.dimensions || '', request.surface || ''].join(' '));
  let score = 0;
  if (request.surface && record.surfaceFamily === request.surface) score += 60;
  if (request.platform && record.platform === request.platform) score += 15;
  score += overlap(words, tokenize(recordSearchText(record))) * 5;
  if (record.multiStateFlow) score += 4;
  if (record.ordinaryOrFailureProne) score += 3;
  if (record.evidenceClass === 'TESTED') score += 3;
  if (record.accessStatus === 'AVAILABLE') score += 2;
  if (VISUAL.some(dim => String(request.dimensions || '').toLowerCase().includes(dim))) {
    if (Array.isArray(record.tags) && record.tags.includes('visual-verified')) score += 25;
    else if (/help|docs|guide|support|marketing/i.test(record.pageRole || '')) score -= 20;
  }
  return score;
}

function selectGraphPatterns(patterns, ids, request) {
  const chosen = new Set(ids);
  const words = tokenize([request.surface, request.job, request.dimensions].join(' '));
  const limit = request.profile === 'deep' ? 8 : 4;
  const ranked = [];
  for (const pattern of patterns) {
    if (pattern.reviewStatus !== 'reviewed') continue;
    const links = [...pattern.examples, ...pattern.counterexamples]
      .filter(id => chosen.has(id)).length;
    const search = [pattern.name, pattern.problem, ...pattern.worksWhen,
      ...pattern.failsWhen, ...pattern.tags].join(' ');
    const score = links * 20 + overlap(words, tokenize(search)) * 5;
    if (score > 0) ranked.push({ pattern, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.pattern.id.localeCompare(b.pattern.id));
  return ranked.slice(0, limit).map(({ pattern, score }) => ({
    ...stripInternal(pattern), selectionScore: score,
  }));
}

/**
 * Returns actual Graph-selected public JSON built from server-fetched P30
 * candidate IDs and pinned local source records. Rejects invalid hydration.
 * P66 must compare its complete output byte-for-byte to authentic P11 Legacy
 * before ever promoting this object inside an isolated rehearsal.
 */
export function constructP66GraphPublicResult({
  candidates, records, patterns, request, now,
} = {}) {
  if (!Array.isArray(records) || !Array.isArray(patterns)
    || !(now instanceof Date) || !Number.isFinite(now.valueOf())
    || !['standard', 'deep'].includes(request?.profile)) {
    throw new TypeError('P66 invalid Graph public reconstruction inputs');
  }
  const choice = selectP29ProfileCandidateIds({ candidates, request });
  const hydrated = hydrateP8LegacyIds({ records, legacyIds: choice.ids });
  if (hydrated.some(row => row.reviewStatus !== 'reviewed'
    || !['AVAILABLE', 'PAYWALLED'].includes(row.accessStatus)
    || !isFresh(row, now))) {
    throw new Error('P66 candidate hydration not eligible');
  }
  const selected = [], byStratum = {};
  const products = new Map(), sources = new Map(), topologies = new Map();
  for (const record of hydrated) {
    const score = baseScore(record, request)
      - (products.get(record.product) || 0) * 20
      - (sources.get(record.sourceFamily) || 0) * 8
      - (topologies.get(record.topology) || 0) * 6;
    selected.push({ ...stripInternal(record), selectionScore: score });
    byStratum[record.primaryStratum] = (byStratum[record.primaryStratum] || 0) + 1;
    products.set(record.product, (products.get(record.product) || 0) + 1);
    sources.set(record.sourceFamily, (sources.get(record.sourceFamily) || 0) + 1);
    topologies.set(record.topology, (topologies.get(record.topology) || 0) + 1);
  }
  const gaps = [];
  if (request.profile === 'deep') {
    for (const [name, quota] of Object.entries(quotas(request.limit))) {
      const count = byStratum[name] || 0;
      if (count < quota) gaps.push({ stratum: name, required: quota, selected: count });
    }
  }
  if (hydrated.length < request.limit) {
    gaps.push({ kind: 'total', required: request.limit, selected: hydrated.length });
  }
  const exactSurface = hydrated.filter(row => row.surfaceFamily === request.surface).length;
  const exactPlatform = hydrated.filter(row => row.platform === request.platform).length;
  const surfaceMinimum = request.profile === 'deep' ? 6 : 3;
  if (request.surface && exactSurface < surfaceMinimum) {
    gaps.push({ kind: 'surface', value: request.surface,
      required: surfaceMinimum, selected: exactSurface });
  }
  const platformMinimum = Math.ceil(request.limit / 2);
  if (request.platform && exactPlatform < platformMinimum) {
    gaps.push({ kind: 'platform', value: request.platform,
      required: platformMinimum, selected: exactPlatform });
  }
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
    records: selected,
    patterns: selectGraphPatterns(patterns, choice.ids, request),
  };
}
