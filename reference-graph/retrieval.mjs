const DEFAULT_RRF_K = 60;
const MAX_ITEMS = 16;
const GRAPH_WEIGHT = 0.25;

function positiveLimit(value, fallback) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > MAX_ITEMS) {
    throw new RangeError(`maxItems must be an integer between 1 and ${MAX_ITEMS}`);
  }
  return resolved;
}

function hitId(hit) {
  if (typeof hit === 'string' && hit.length > 0) return hit;
  if (hit && typeof hit === 'object' && typeof hit.id === 'string' && hit.id.length > 0) {
    return hit.id;
  }
  return null;
}

function uniqueRanked(hits) {
  const ranked = [];
  const seen = new Set();
  for (let index = 0; index < hits.length; index += 1) {
    const id = hitId(hits[index]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ranked.push({ id, rank: index + 1 });
  }
  return ranked;
}

function normalizedTags(asset) {
  return Array.isArray(asset?.tags)
    ? asset.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)
    : [];
}

function eligibleAsset(asset, filters = {}) {
  if (!asset) return false;

  const platform = filters.platform;
  if (platform && asset.platform !== platform && asset.metadata?.platform !== platform) {
    return false;
  }

  const surface = filters.surfaceFamily ?? filters.surface_family;
  if (
    surface
    && asset.surface_family !== surface
    && asset.surfaceFamily !== surface
    && asset.metadata?.surface_family !== surface
  ) {
    return false;
  }

  const requiredTags = Array.isArray(filters.tags)
    ? filters.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)
    : [];
  if (requiredTags.length > 0) {
    const tags = new Set(normalizedTags(asset));
    if (!requiredTags.every((tag) => tags.has(tag))) return false;
  }

  return true;
}

function rankedScores({ lexicalHits, semanticHits, eligibleIds, k }) {
  const scores = new Map();
  const channels = new Map();

  const add = (entries, channel) => {
    for (const { id, rank } of entries) {
      if (!eligibleIds.has(id)) continue;
      scores.set(id, (scores.get(id) ?? 0) + (1 / (k + rank)));
      const row = channels.get(id) ?? {};
      row[channel] = rank;
      channels.set(id, row);
    }
  };

  add(uniqueRanked(lexicalHits), 'lexical_rank');
  add(uniqueRanked(semanticHits), 'semantic_rank');

  return { scores, channels };
}

function sortedIds(scores) {
  return [...scores.entries()]
    .sort((left, right) => {
      const scoreOrder = right[1] - left[1];
      if (scoreOrder !== 0) return scoreOrder;
      return left[0].localeCompare(right[0]);
    })
    .map(([id]) => id);
}

export function retrieveReferenceBundle({
  lexicalHits = [],
  semanticHits = [],
  assets = [],
  relations = [],
  filters = {},
  maxItems = 12,
  rrfK = DEFAULT_RRF_K,
} = {}) {
  if (!Array.isArray(lexicalHits) || !Array.isArray(semanticHits)) {
    throw new TypeError('lexicalHits and semanticHits must be arrays');
  }
  if (!Array.isArray(assets) || !Array.isArray(relations)) {
    throw new TypeError('assets and relations must be arrays');
  }
  if (!Number.isInteger(rrfK) || rrfK < 1) {
    throw new RangeError('rrfK must be a positive integer');
  }

  const limit = positiveLimit(maxItems, 12);
  const assetById = new Map(
    assets
      .filter((asset) => asset && typeof asset.id === 'string' && asset.id.length > 0)
      .map((asset) => [asset.id, asset]),
  );
  const eligibleIds = new Set(
    [...assetById.entries()]
      .filter(([, asset]) => eligibleAsset(asset, filters))
      .map(([id]) => id),
  );

  const { scores, channels } = rankedScores({
    lexicalHits,
    semanticHits,
    eligibleIds,
    k: rrfK,
  });

  const seedIds = sortedIds(scores).slice(0, Math.min(limit, 8));
  const seedRank = new Map(seedIds.map((id, index) => [id, index + 1]));
  let expanded = false;

  for (const relation of relations) {
    if (!relation || typeof relation !== 'object') continue;
    const from = relation.from;
    const to = relation.to;
    const weight = Number.isFinite(relation.weight) ? relation.weight : 1;
    if (weight <= 0) continue;

    let seedId = null;
    let neighborId = null;
    if (seedRank.has(from)) {
      seedId = from;
      neighborId = to;
    } else if (seedRank.has(to)) {
      seedId = to;
      neighborId = from;
    }

    if (!seedId || !neighborId || !eligibleIds.has(neighborId)) continue;
    const seedScore = scores.get(seedId) ?? 0;
    if (seedScore <= 0) continue;

    const graphScore = seedScore * GRAPH_WEIGHT * Math.max(0, Math.min(1, weight));
    scores.set(neighborId, (scores.get(neighborId) ?? 0) + graphScore);
    const row = channels.get(neighborId) ?? {};
    row.graph_from = seedId;
    row.graph_relation = relation.type ?? null;
    row.graph_score = (row.graph_score ?? 0) + graphScore;
    channels.set(neighborId, row);
    expanded = true;
  }

  const items = sortedIds(scores)
    .slice(0, limit)
    .map((id) => ({
      ...assetById.get(id),
      retrieval_score: scores.get(id),
      retrieval_channels: channels.get(id) ?? {},
    }));

  return {
    retrieval: 'reference-graph',
    graph_hops: expanded ? 1 : 0,
    max_items: limit,
    items,
  };
}

function hasItems(bundle) {
  return Boolean(bundle && Array.isArray(bundle.items) && bundle.items.length > 0);
}

export function selectReferenceBundle({
  mode = 'shadow',
  graphBundle,
  legacyBundle,
} = {}) {
  if (!['shadow', 'active'].includes(mode)) {
    throw new TypeError('mode must be shadow or active');
  }

  const graphAvailable = hasItems(graphBundle);
  const legacyAvailable = hasItems(legacyBundle);

  if (mode === 'shadow') {
    if (legacyAvailable) {
      return {
        mode,
        source: 'legacy-control',
        bundle: legacyBundle,
        graph_bundle: graphBundle ?? null,
        legacy_bundle: legacyBundle,
      };
    }
    return {
      mode,
      source: graphAvailable ? 'reference-graph-no-control' : 'none',
      bundle: graphAvailable ? graphBundle : { items: [] },
      graph_bundle: graphBundle ?? null,
      legacy_bundle: legacyBundle ?? null,
    };
  }

  if (graphAvailable) {
    return {
      mode,
      source: 'reference-graph',
      bundle: graphBundle,
      graph_bundle: graphBundle,
      legacy_bundle: legacyBundle ?? null,
    };
  }

  return {
    mode,
    source: legacyAvailable ? 'legacy-fallback' : 'none',
    bundle: legacyAvailable ? legacyBundle : { items: [] },
    graph_bundle: graphBundle ?? null,
    legacy_bundle: legacyBundle ?? null,
  };
}
