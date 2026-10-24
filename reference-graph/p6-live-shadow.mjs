import {
  selectP6GuardedHybridResults,
  selectP6LexicalResults,
  selectP6SemanticResults,
} from './retrieval-policy.mjs';

const MODES = new Set(['lexical', 'semantic', 'hybrid']);

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function requireMode(value) {
  const mode = requireString(value, 'mode');
  if (!MODES.has(mode)) {
    throw new TypeError('mode must be lexical, semantic, or hybrid');
  }
  return mode;
}

function boundedCandidateLimit(value = 24) {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new TypeError('candidateLimit must be an integer between 1 and 100');
  }
  return value;
}

function candidateId(row) {
  if (typeof row === 'string' && row.length > 0) return row;
  if (row && typeof row === 'object') return row.asset_id ?? row.id ?? null;
  return null;
}

function validateQueryVector(value) {
  if (!Array.isArray(value) || value.length !== 384) {
    throw new TypeError('query embedding must be a 384-number array');
  }
  if (value.some((entry) => !Number.isFinite(entry))) {
    throw new TypeError('query embedding must contain only finite numbers');
  }
  return value;
}

async function embedQuery(queryProvider, query) {
  requireObject(queryProvider, 'queryProvider');
  if (typeof queryProvider.embed !== 'function') {
    throw new TypeError('queryProvider.embed must be a function');
  }
  const vectors = await queryProvider.embed([String(query ?? '')]);
  if (!Array.isArray(vectors) || vectors.length !== 1) {
    throw new TypeError('queryProvider must return exactly one query embedding');
  }
  return validateQueryVector(vectors[0]);
}

function uniqueCandidateIds(...candidateSets) {
  const ids = [];
  const seen = new Set();
  for (const rows of candidateSets) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = candidateId(row);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function bundleFromSelection(context, selection) {
  const assets = Array.isArray(context?.assets) ? context.assets : [];
  const byId = new Map(assets.map((asset) => [asset?.id, asset]));
  const items = selection.ids.map((id) => {
    const asset = byId.get(id);
    if (!asset) throw new Error(`missing selected asset context for ${id}`);
    return asset;
  });
  const selectedIds = new Set(selection.ids);
  const relations = (Array.isArray(context?.relations) ? context.relations : []).filter((relation) => {
    const from = relation?.from ?? relation?.from_asset_id;
    const to = relation?.to ?? relation?.to_asset_id;
    return selectedIds.has(from) && selectedIds.has(to);
  });
  return {
    items,
    relations,
    policy_diagnostics: selection.diagnostics,
  };
}

export function createP6SupabaseShadowRetriever({
  store,
  queryProvider = null,
  mode,
  modelId = null,
  modelRevision = null,
  candidateLimit = 24,
} = {}) {
  requireObject(store, 'store');
  const resolvedMode = requireMode(mode);
  const resolvedCandidateLimit = boundedCandidateLimit(candidateLimit);

  if (typeof store.candidateContextP6 !== 'function') {
    throw new TypeError('store.candidateContextP6 must be a function');
  }
  if (resolvedMode !== 'semantic' && typeof store.lexicalCandidatesP6 !== 'function') {
    throw new TypeError('store.lexicalCandidatesP6 must be a function');
  }
  if (resolvedMode !== 'lexical' && typeof store.semanticCandidatesP6 !== 'function') {
    throw new TypeError('store.semanticCandidatesP6 must be a function');
  }

  const resolvedModelId = resolvedMode === 'lexical' ? null : requireString(modelId, 'modelId');
  const resolvedModelRevision = resolvedMode === 'lexical'
    ? null
    : requireString(modelRevision, 'modelRevision');

  return async ({ request, query, filters = {}, maxItems = 12 } = {}) => {
    requireObject(request, 'request');
    if (!Number.isInteger(maxItems) || maxItems < 1) {
      throw new TypeError('maxItems must be a positive integer');
    }

    let lexicalCandidates = [];
    let semanticCandidates = [];

    if (resolvedMode !== 'semantic') {
      lexicalCandidates = await store.lexicalCandidatesP6(
        query,
        filters,
        resolvedCandidateLimit,
      );
    }

    if (resolvedMode !== 'lexical') {
      const embedding = await embedQuery(queryProvider, query);
      semanticCandidates = await store.semanticCandidatesP6(
        embedding,
        resolvedModelId,
        resolvedModelRevision,
        filters,
        resolvedCandidateLimit,
      );
    }

    const seedIds = uniqueCandidateIds(lexicalCandidates, semanticCandidates);
    const context = seedIds.length === 0
      ? { assets: [], relations: [] }
      : await store.candidateContextP6(seedIds, filters);
    const assets = Array.isArray(context?.assets) ? context.assets : [];

    let selection;
    if (resolvedMode === 'lexical') {
      selection = selectP6LexicalResults({
        lexicalCandidates,
        assets,
        request,
        maxItems,
      });
    } else if (resolvedMode === 'semantic') {
      selection = selectP6SemanticResults({
        semanticCandidates,
        assets,
        request,
        maxItems,
      });
    } else {
      selection = selectP6GuardedHybridResults({
        lexicalCandidates,
        semanticCandidates,
        assets,
        request,
        maxItems,
      });
    }

    return bundleFromSelection(context, selection);
  };
}
