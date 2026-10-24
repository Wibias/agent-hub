import { retrieveReferenceBundle } from './retrieval.mjs';

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

function candidateId(row) {
  if (typeof row === 'string' && row.length > 0) return row;
  if (row && typeof row === 'object') {
    return row.asset_id ?? row.id ?? null;
  }
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

export function createSupabaseShadowRetriever({
  store,
  queryProvider = null,
  mode,
  modelId = null,
  modelRevision = null,
} = {}) {
  requireObject(store, 'store');
  const resolvedMode = requireMode(mode);

  if (resolvedMode === 'lexical') {
    if (typeof store.retrieve !== 'function') {
      throw new TypeError('store.retrieve must be a function');
    }
    return async ({ query, filters = {}, maxItems = 12 } = {}) => store.retrieve({
      query,
      filters,
      maxItems,
    });
  }

  const resolvedModelId = requireString(modelId, 'modelId');
  const resolvedModelRevision = requireString(modelRevision, 'modelRevision');

  if (resolvedMode === 'hybrid') {
    if (typeof store.retrieve !== 'function') {
      throw new TypeError('store.retrieve must be a function');
    }
    return async ({ query, filters = {}, maxItems = 12 } = {}) => {
      const embedding = await embedQuery(queryProvider, query);
      return store.retrieve({
        query,
        embedding,
        modelId: resolvedModelId,
        modelRevision: resolvedModelRevision,
        filters,
        maxItems,
      });
    };
  }

  if (typeof store.semanticCandidates !== 'function') {
    throw new TypeError('store.semanticCandidates must be a function');
  }
  if (typeof store.candidateContext !== 'function') {
    throw new TypeError('store.candidateContext must be a function');
  }

  return async ({ query, filters = {}, maxItems = 12 } = {}) => {
    const embedding = await embedQuery(queryProvider, query);
    const candidateLimit = Math.min(100, Math.max(24, maxItems * 4));
    const rows = await store.semanticCandidates(
      embedding,
      resolvedModelId,
      resolvedModelRevision,
      filters,
      candidateLimit,
    );
    const semanticHits = (Array.isArray(rows) ? rows : [])
      .map(candidateId)
      .filter(Boolean);
    const context = semanticHits.length === 0
      ? { assets: [], relations: [] }
      : await store.candidateContext(semanticHits, filters);

    return retrieveReferenceBundle({
      lexicalHits: [],
      semanticHits,
      assets: Array.isArray(context?.assets) ? context.assets : [],
      relations: Array.isArray(context?.relations) ? context.relations : [],
      filters,
      maxItems,
    });
  };
}

export async function probeCompatibleEmbeddings({
  store,
  queryProvider,
  modelId,
  modelRevision,
} = {}) {
  requireObject(store, 'store');
  if (typeof store.semanticCandidates !== 'function') {
    throw new TypeError('store.semanticCandidates must be a function');
  }
  const resolvedModelId = requireString(modelId, 'modelId');
  const resolvedModelRevision = requireString(modelRevision, 'modelRevision');
  const embedding = await embedQuery(
    queryProvider,
    'reference graph compatibility probe',
  );
  const rows = await store.semanticCandidates(
    embedding,
    resolvedModelId,
    resolvedModelRevision,
    {},
    1,
  );
  const candidateCount = Array.isArray(rows) ? rows.length : 0;
  return {
    status: candidateCount > 0 ? 'available' : 'unavailable',
    model_id: resolvedModelId,
    model_revision: resolvedModelRevision,
    candidate_count: candidateCount,
  };
}
