const FROZEN_POLICY = Object.freeze({
  surfaceBonus: 60,
  platformBonus: 15,
  lexicalMultiplier: 5,
  productPenalty: 20,
  sourceFamilyPenalty: 8,
  topologyPenalty: 6,
});

function candidateId(candidate) {
  const id = candidate?.id ?? candidate?.asset_id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('candidate id must be a non-empty string');
  }
  return id;
}

function finiteScore(value, name) {
  const score = Number(value);
  if (!Number.isFinite(score)) throw new TypeError(`${name} must be finite`);
  return score;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function requireQuickRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('request must be an object');
  }
  if (request.profile !== 'quick') {
    throw new Error('P6 retrieval policy currently supports quick requests only');
  }
  return request;
}

function normalizeAsset(asset) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
    throw new TypeError('asset must be an object');
  }
  if (typeof asset.id !== 'string' || asset.id.length === 0) {
    throw new TypeError('asset id must be a non-empty string');
  }
  const metadata = asset.metadata ?? {};
  return {
    id: asset.id,
    product: metadata.product ?? null,
    surface: asset.surface_family ?? asset.surfaceFamily ?? metadata.surface_family ?? null,
    platform: asset.platform ?? metadata.platform ?? null,
    sourceFamily: asset.source_family ?? asset.sourceFamily ?? null,
    topology: asset.topology ?? null,
  };
}

function buildAssetMap(assets) {
  if (!Array.isArray(assets)) throw new TypeError('assets must be an array');
  const map = new Map();
  for (const raw of assets) {
    const asset = normalizeAsset(raw);
    if (map.has(asset.id)) throw new Error(`duplicate asset id: ${asset.id}`);
    map.set(asset.id, asset);
  }
  return map;
}

function normalizeCandidates(candidates, assetMap, { lexical = false } = {}) {
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');
  const seen = new Set();
  const rows = [];
  for (const raw of candidates) {
    const id = candidateId(raw);
    if (seen.has(id)) throw new Error(`duplicate candidate id: ${id}`);
    seen.add(id);
    const asset = assetMap.get(id);
    if (!asset) throw new Error(`missing asset context for candidate ${id}`);
    const score = finiteScore(raw.score, `candidate ${id} score`);
    if (lexical && score <= 0) continue;
    const rank = Number.isInteger(raw.rank) && raw.rank > 0
      ? raw.rank
      : Number.MAX_SAFE_INTEGER;
    rows.push({ id, score, rank, asset });
  }
  return rows;
}

function coverageRequirements(request, maxItems) {
  return {
    minimumSurface: request.surface ? 1 : 0,
    minimumPlatform: request.platform ? Math.ceil(maxItems / 2) : 0,
  };
}

function matchFlags(asset, request) {
  return {
    surface: Boolean(request.surface) && asset.surface === request.surface,
    platform: Boolean(request.platform) && asset.platform === request.platform,
  };
}

function coverageCounts(selected, request) {
  let exactSurface = 0;
  let exactPlatform = 0;
  for (const row of selected) {
    const flags = matchFlags(row.asset, request);
    if (flags.surface) exactSurface += 1;
    if (flags.platform) exactPlatform += 1;
  }
  return { exactSurface, exactPlatform };
}

function canCompleteCoverage({ selected, remaining, request, maxItems }) {
  const slots = maxItems - selected.length;
  if (slots < 0 || remaining.length < slots) return false;

  const { minimumSurface, minimumPlatform } = coverageRequirements(request, maxItems);
  const { exactSurface, exactPlatform } = coverageCounts(selected, request);
  const surfaceDeficit = Math.max(0, minimumSurface - exactSurface);
  const platformDeficit = Math.max(0, minimumPlatform - exactPlatform);

  let both = 0;
  let surfaceOnly = 0;
  let platformOnly = 0;
  for (const row of remaining) {
    const flags = matchFlags(row.asset, request);
    if (flags.surface && flags.platform) both += 1;
    else if (flags.surface) surfaceOnly += 1;
    else if (flags.platform) platformOnly += 1;
  }

  const maxBoth = Math.min(both, slots);
  for (let chosenBoth = 0; chosenBoth <= maxBoth; chosenBoth += 1) {
    const surfaceNeed = Math.max(0, surfaceDeficit - chosenBoth);
    const platformNeed = Math.max(0, platformDeficit - chosenBoth);
    if (surfaceNeed > surfaceOnly || platformNeed > platformOnly) continue;
    if (chosenBoth + surfaceNeed + platformNeed <= slots) return true;
  }
  return false;
}

function coverageDiagnostics(selected, allRows, request, maxItems) {
  const { minimumSurface, minimumPlatform } = coverageRequirements(request, maxItems);
  const { exactSurface, exactPlatform } = coverageCounts(selected, request);
  const feasible = canCompleteCoverage({
    selected: [],
    remaining: allRows,
    request,
    maxItems,
  });
  const gaps = [];
  if (selected.length < maxItems) {
    gaps.push({ kind: 'total', required: maxItems, selected: selected.length });
  }
  if (minimumSurface > 0 && exactSurface < minimumSurface) {
    gaps.push({
      kind: 'surface',
      value: request.surface,
      required: minimumSurface,
      selected: exactSurface,
    });
  }
  if (minimumPlatform > 0 && exactPlatform < minimumPlatform) {
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
  const { asset } = row;
  return (asset.product ? (counts.products.get(asset.product) ?? 0) * FROZEN_POLICY.productPenalty : 0)
    + (asset.sourceFamily ? (counts.sources.get(asset.sourceFamily) ?? 0) * FROZEN_POLICY.sourceFamilyPenalty : 0)
    + (asset.topology ? (counts.topologies.get(asset.topology) ?? 0) * FROZEN_POLICY.topologyPenalty : 0);
}

function lexicalBaseScore(row, request) {
  const flags = matchFlags(row.asset, request);
  return row.score * FROZEN_POLICY.lexicalMultiplier
    + (flags.surface ? FROZEN_POLICY.surfaceBonus : 0)
    + (flags.platform ? FROZEN_POLICY.platformBonus : 0);
}

function chooseWithCoverage({ rows, request, maxItems, compareRows, onSelect }) {
  const selected = [];
  const selectedIds = new Set();
  const initiallyFeasible = canCompleteCoverage({
    selected: [],
    remaining: rows,
    request,
    maxItems,
  });

  while (selected.length < maxItems) {
    const remaining = rows.filter((row) => !selectedIds.has(row.id));
    if (remaining.length === 0) break;
    const ordered = [...remaining].sort(compareRows);
    let chosen = ordered[0];

    if (initiallyFeasible) {
      chosen = ordered.find((candidate) => {
        const nextSelected = [...selected, candidate];
        const nextIds = new Set(nextSelected.map((row) => row.id));
        const nextRemaining = rows.filter((row) => !nextIds.has(row.id));
        return canCompleteCoverage({
          selected: nextSelected,
          remaining: nextRemaining,
          request,
          maxItems,
        });
      }) ?? chosen;
    }

    selected.push(chosen);
    selectedIds.add(chosen.id);
    onSelect?.(chosen);
  }
  return selected;
}

function resultEnvelope(selected, allRows, request, maxItems, selectedCounts) {
  return {
    ids: selected.map((row) => row.id),
    diagnostics: {
      coverage: coverageDiagnostics(selected, allRows, request, maxItems),
      selected_counts: selectedCounts,
    },
  };
}

function semanticRankMap(rows) {
  return new Map(rows.map((row) => [row.id, row.rank]));
}

function selectLexicalCore({ lexicalRows, request, maxItems, semanticRanks = new Map() }) {
  const counts = {
    products: new Map(),
    sources: new Map(),
    topologies: new Map(),
  };
  const adjusted = (row) => lexicalBaseScore(row, request) - diversityPenalty(row, counts);
  const selected = chooseWithCoverage({
    rows: lexicalRows,
    request,
    maxItems,
    compareRows: (left, right) => {
      const scoreDiff = adjusted(right) - adjusted(left);
      if (scoreDiff !== 0) return scoreDiff;
      const leftSemantic = semanticRanks.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightSemantic = semanticRanks.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftSemantic !== rightSemantic) return leftSemantic - rightSemantic;
      return left.id.localeCompare(right.id);
    },
    onSelect: (row) => {
      increment(counts.products, row.asset.product);
      increment(counts.sources, row.asset.sourceFamily);
      increment(counts.topologies, row.asset.topology);
    },
  });
  return selected;
}

export function selectP6LexicalResults({ lexicalCandidates, assets, request, maxItems } = {}) {
  requireQuickRequest(request);
  positiveInteger(maxItems, 'maxItems');
  const assetMap = buildAssetMap(assets);
  const lexicalRows = normalizeCandidates(lexicalCandidates, assetMap, { lexical: true });
  const selected = selectLexicalCore({ lexicalRows, request, maxItems });
  return resultEnvelope(selected, lexicalRows, request, maxItems, {
    lexical: selected.length,
    semantic_only: 0,
  });
}

export function selectP6SemanticResults({ semanticCandidates, assets, request, maxItems } = {}) {
  requireQuickRequest(request);
  positiveInteger(maxItems, 'maxItems');
  const assetMap = buildAssetMap(assets);
  const semanticRows = normalizeCandidates(semanticCandidates, assetMap);
  const selected = chooseWithCoverage({
    rows: semanticRows,
    request,
    maxItems,
    compareRows: (left, right) => (
      right.score - left.score
      || left.rank - right.rank
      || left.id.localeCompare(right.id)
    ),
  });
  return resultEnvelope(selected, semanticRows, request, maxItems, {
    lexical: 0,
    semantic_only: selected.length,
  });
}

export function selectP6GuardedHybridResults({
  lexicalCandidates,
  semanticCandidates,
  assets,
  request,
  maxItems,
} = {}) {
  requireQuickRequest(request);
  positiveInteger(maxItems, 'maxItems');
  const assetMap = buildAssetMap(assets);
  const lexicalRows = normalizeCandidates(lexicalCandidates, assetMap, { lexical: true });
  const semanticRows = normalizeCandidates(semanticCandidates, assetMap);
  const semanticRanks = semanticRankMap(semanticRows);

  const lexicalCanFill = lexicalRows.length >= maxItems && canCompleteCoverage({
    selected: [],
    remaining: lexicalRows,
    request,
    maxItems,
  });

  if (lexicalCanFill) {
    const selected = selectLexicalCore({ lexicalRows, request, maxItems, semanticRanks });
    return resultEnvelope(selected, lexicalRows, request, maxItems, {
      lexical: selected.length,
      semantic_only: 0,
    });
  }

  const lexicalById = new Map(lexicalRows.map((row) => [row.id, row]));
  const semanticById = new Map(semanticRows.map((row) => [row.id, row]));
  const unionIds = new Set([...lexicalById.keys(), ...semanticById.keys()]);
  const unionRows = [...unionIds].map((id) => {
    const lexical = lexicalById.get(id);
    const semantic = semanticById.get(id);
    const base = lexical ?? semantic;
    return {
      ...base,
      channel: lexical ? 'lexical' : 'semantic-only',
      semanticRank: semantic?.rank ?? Number.MAX_SAFE_INTEGER,
    };
  });

  const counts = {
    products: new Map(),
    sources: new Map(),
    topologies: new Map(),
  };
  const adjusted = (row) => lexicalBaseScore(row, request) - diversityPenalty(row, counts);
  const selected = chooseWithCoverage({
    rows: unionRows,
    request,
    maxItems,
    compareRows: (left, right) => {
      if (left.channel !== right.channel) return left.channel === 'lexical' ? -1 : 1;
      if (left.channel === 'lexical') {
        const scoreDiff = adjusted(right) - adjusted(left);
        if (scoreDiff !== 0) return scoreDiff;
      } else {
        const scoreDiff = right.score - left.score;
        if (scoreDiff !== 0) return scoreDiff;
      }
      if (left.semanticRank !== right.semanticRank) return left.semanticRank - right.semanticRank;
      return left.id.localeCompare(right.id);
    },
    onSelect: (row) => {
      if (row.channel !== 'lexical') return;
      increment(counts.products, row.asset.product);
      increment(counts.sources, row.asset.sourceFamily);
      increment(counts.topologies, row.asset.topology);
    },
  });

  return resultEnvelope(selected, unionRows, request, maxItems, {
    lexical: selected.filter((row) => row.channel === 'lexical').length,
    semantic_only: selected.filter((row) => row.channel === 'semantic-only').length,
  });
}

export { FROZEN_POLICY };
