const FROZEN_POLICY = Object.freeze({
  surfaceBonus: 60,
  platformBonus: 15,
  lexicalMultiplier: 5,
  multiStateBonus: 4,
  ordinaryFailureBonus: 3,
  testedEvidenceBonus: 3,
  availableAccessBonus: 2,
  visualVerifiedBonus: 25,
  visualTextPenalty: 20,
  productPenalty: 20,
  sourceFamilyPenalty: 8,
  topologyPenalty: 6,
});

const VISUAL_DIMENSIONS = Object.freeze([
  'visual-world',
  'visual',
  'art-direction',
  'palette',
  'typography',
]);

function nonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function requireQuickRequest(request, maxItems) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('request must be an object');
  }
  if (request.profile !== 'quick') {
    throw new Error('P7 parity policy supports quick requests only');
  }
  if (!Number.isInteger(maxItems) || maxItems < 1) {
    throw new TypeError('maxItems must be a positive integer');
  }
  return { ...request, limit: maxItems };
}

function tokenize(value) {
  return new Set(
    String(value ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1),
  );
}

function overlap(left, right) {
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count;
}

function normalizeCandidate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('candidate must be an object');
  }
  const assetId = nonEmptyString(raw.asset_id, 'candidate.asset_id');
  const legacyId = nonEmptyString(raw.legacy_id, 'candidate.legacy_id');
  return {
    asset_id: assetId,
    legacy_id: legacyId,
    search_text: String(raw.search_text ?? ''),
    product: raw.product ?? null,
    surface_family: raw.surface_family ?? null,
    platform: raw.platform ?? null,
    page_role: raw.page_role ?? null,
    motion: raw.motion ?? null,
    source_family: raw.source_family ?? null,
    topology: raw.topology ?? null,
    access_status: raw.access_status ?? null,
    evidence_class: raw.evidence_class ?? null,
    ordinary_or_failure_prone: raw.ordinary_or_failure_prone === true,
    multi_state_flow: raw.multi_state_flow === true,
    tags: Array.isArray(raw.tags) ? [...raw.tags] : [],
  };
}

function normalizeCandidates(candidates) {
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');
  const assetIds = new Set();
  const legacyIds = new Set();
  return candidates.map((raw) => {
    const row = normalizeCandidate(raw);
    if (assetIds.has(row.asset_id)) throw new Error(`duplicate asset id: ${row.asset_id}`);
    if (legacyIds.has(row.legacy_id)) throw new Error(`duplicate legacy_id: ${row.legacy_id}`);
    assetIds.add(row.asset_id);
    legacyIds.add(row.legacy_id);
    return row;
  });
}

function queryTokens(request) {
  return tokenize([request.job || '', request.dimensions || '', request.surface || ''].join(' '));
}

function candidateSearchTokens(candidate) {
  return tokenize([
    candidate.search_text,
    candidate.surface_family || '',
    candidate.motion || '',
  ].join(' '));
}

function isVisualRequest(request) {
  const dimensions = String(request.dimensions ?? '').toLowerCase();
  return VISUAL_DIMENSIONS.some((value) => dimensions.includes(value));
}

function baseScore(candidate, request, requestTokens) {
  const overlapCount = overlap(requestTokens, candidateSearchTokens(candidate));
  let score = 0;
  if (request.surface && candidate.surface_family === request.surface) {
    score += FROZEN_POLICY.surfaceBonus;
  }
  if (request.platform && candidate.platform === request.platform) {
    score += FROZEN_POLICY.platformBonus;
  }
  score += overlapCount * FROZEN_POLICY.lexicalMultiplier;
  if (candidate.multi_state_flow) score += FROZEN_POLICY.multiStateBonus;
  if (candidate.ordinary_or_failure_prone) score += FROZEN_POLICY.ordinaryFailureBonus;
  if (candidate.evidence_class === 'TESTED') score += FROZEN_POLICY.testedEvidenceBonus;
  if (candidate.access_status === 'AVAILABLE') score += FROZEN_POLICY.availableAccessBonus;
  if (isVisualRequest(request)) {
    if (candidate.tags.includes('visual-verified')) {
      score += FROZEN_POLICY.visualVerifiedBonus;
    } else if (/help|docs|guide|support|marketing/i.test(candidate.page_role || '')) {
      score -= FROZEN_POLICY.visualTextPenalty;
    }
  }
  return { score, overlapCount };
}

function coverageRequirements(request) {
  return {
    minimumSurface: request.surface ? 1 : 0,
    minimumPlatform: request.platform ? Math.ceil(request.limit / 2) : 0,
  };
}

function canCompleteCoverage({ selected, remaining, request }) {
  const slotsRemaining = request.limit - selected.length;
  if (slotsRemaining < 0 || remaining.length < slotsRemaining) return false;

  const { minimumSurface, minimumPlatform } = coverageRequirements(request);
  const selectedSurface = request.surface
    ? selected.filter((row) => row.surface_family === request.surface).length
    : 0;
  const selectedPlatform = request.platform
    ? selected.filter((row) => row.platform === request.platform).length
    : 0;
  const surfaceNeed = Math.max(0, minimumSurface - selectedSurface);
  const platformNeed = Math.max(0, minimumPlatform - selectedPlatform);
  const surfaceAvailable = request.surface
    ? remaining.filter((row) => row.surface_family === request.surface).length
    : 0;
  const platformAvailable = request.platform
    ? remaining.filter((row) => row.platform === request.platform).length
    : 0;
  const bothAvailable = request.surface && request.platform
    ? remaining.filter(
        (row) => row.surface_family === request.surface && row.platform === request.platform,
      ).length
    : 0;

  if (surfaceAvailable < surfaceNeed || platformAvailable < platformNeed) return false;
  const minimumSlotsNeeded = surfaceNeed
    + platformNeed
    - Math.min(bothAvailable, surfaceNeed, platformNeed);
  return minimumSlotsNeeded <= slotsRemaining;
}

function coverageDiagnostics(selected, allRows, request) {
  const { minimumSurface, minimumPlatform } = coverageRequirements(request);
  const exactSurface = request.surface
    ? selected.filter((row) => row.surface_family === request.surface).length
    : 0;
  const exactPlatform = request.platform
    ? selected.filter((row) => row.platform === request.platform).length
    : 0;
  const feasible = canCompleteCoverage({ selected: [], remaining: allRows, request });
  const gaps = [];
  if (selected.length < request.limit) {
    gaps.push({ kind: 'total', required: request.limit, selected: selected.length });
  }
  if (request.surface && exactSurface < minimumSurface) {
    gaps.push({
      kind: 'surface',
      value: request.surface,
      required: minimumSurface,
      selected: exactSurface,
    });
  }
  if (request.platform && exactPlatform < minimumPlatform) {
    gaps.push({
      kind: 'platform',
      value: request.platform,
      required: minimumPlatform,
      selected: exactPlatform,
    });
  }
  return {
    feasible,
    exact_surface: exactSurface,
    exact_platform: exactPlatform,
    minimum_surface: minimumSurface,
    minimum_platform: minimumPlatform,
    gaps,
  };
}

function increment(map, key) {
  if (key === null || key === undefined || key === '') return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function diversityPenalty(row, counts) {
  return (row.product ? (counts.products.get(row.product) ?? 0) * FROZEN_POLICY.productPenalty : 0)
    + (row.source_family ? (counts.sources.get(row.source_family) ?? 0) * FROZEN_POLICY.sourceFamilyPenalty : 0)
    + (row.topology ? (counts.topologies.get(row.topology) ?? 0) * FROZEN_POLICY.topologyPenalty : 0);
}

export function selectP7ParityLexicalResults({ candidates, request, maxItems } = {}) {
  const resolvedRequest = requireQuickRequest(request, maxItems);
  const rows = normalizeCandidates(candidates);
  const requestTokenSet = queryTokens(resolvedRequest);
  const scored = rows.map((row) => {
    const base = baseScore(row, resolvedRequest, requestTokenSet);
    return {
      ...row,
      base_score: base.score,
      overlap_count: base.overlapCount,
    };
  });
  const initiallyFeasible = canCompleteCoverage({
    selected: [],
    remaining: scored,
    request: resolvedRequest,
  });
  const selected = [];
  const selectedIds = new Set();
  const trace = [];
  const counts = {
    products: new Map(),
    sources: new Map(),
    topologies: new Map(),
  };

  while (selected.length < resolvedRequest.limit) {
    const remaining = scored.filter((row) => !selectedIds.has(row.legacy_id));
    if (remaining.length === 0) break;

    const evaluated = remaining
      .map((row) => {
        const penalty = diversityPenalty(row, counts);
        return {
          row,
          diversity_penalty: penalty,
          adjusted_score: row.base_score - penalty,
        };
      })
      .sort((left, right) => (
        right.adjusted_score - left.adjusted_score
        || left.row.legacy_id.localeCompare(right.row.legacy_id)
      ));

    let chosen = evaluated[0];
    if (initiallyFeasible) {
      chosen = evaluated.find((entry) => {
        const nextSelected = [...selected, entry.row];
        const nextIds = new Set(nextSelected.map((row) => row.legacy_id));
        const nextRemaining = scored.filter((row) => !nextIds.has(row.legacy_id));
        return canCompleteCoverage({
          selected: nextSelected,
          remaining: nextRemaining,
          request: resolvedRequest,
        });
      }) ?? chosen;
    }

    selected.push(chosen.row);
    selectedIds.add(chosen.row.legacy_id);
    trace.push({
      legacy_id: chosen.row.legacy_id,
      asset_id: chosen.row.asset_id,
      base_score: chosen.row.base_score,
      overlap_count: chosen.row.overlap_count,
      diversity_penalty: chosen.diversity_penalty,
      adjusted_score: chosen.adjusted_score,
    });
    increment(counts.products, chosen.row.product);
    increment(counts.sources, chosen.row.source_family);
    increment(counts.topologies, chosen.row.topology);
  }

  return {
    ids: selected.map((row) => row.legacy_id),
    diagnostics: {
      coverage: coverageDiagnostics(selected, scored, resolvedRequest),
      selection_trace: trace,
      candidate_count: scored.length,
    },
  };
}
