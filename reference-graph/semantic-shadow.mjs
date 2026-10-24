import { tokenize } from '../knowledge/design-references/scripts/lib.mjs';
import { retrieveReferenceBundle } from './retrieval.mjs';

function eligible(capture, filters = {}) {
  const metadata = capture?.asset?.metadata ?? {};
  if (filters.platform && metadata.platform !== filters.platform) return false;
  const surface = filters.surface_family ?? filters.surfaceFamily;
  if (surface && metadata.surface_family !== surface) return false;
  return true;
}

function overlapCount(left, right) {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) count += 1;
  }
  return count;
}

function validateVector(vector, name) {
  if (!Array.isArray(vector) || vector.length !== 384) {
    throw new TypeError(`${name} must be a 384-number array`);
  }
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new TypeError(`${name} must contain only finite numbers`);
  }
  return vector;
}

function cosineSimilarity(left, right) {
  validateVector(left, 'left vector');
  validateVector(right, 'right vector');
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < 384; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return -1;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function meanVectors(vectors) {
  if (vectors.length === 0) throw new Error('cannot average an empty embedding set');
  const output = Array(384).fill(0);
  for (const vector of vectors) {
    validateVector(vector, 'asset embedding');
    for (let index = 0; index < output.length; index += 1) {
      output[index] += vector[index];
    }
  }
  return output.map((value) => value / vectors.length);
}

function assetRow(capture) {
  return {
    ...capture.asset,
    id: capture.asset.id,
    surface_family: capture.asset.metadata?.surface_family ?? null,
    platform: capture.asset.metadata?.platform ?? null,
    tags: Array.isArray(capture.tags) ? capture.tags : [],
  };
}

function buildIndex({ captures, embeddingRows, provider }) {
  if (!Array.isArray(captures)) throw new TypeError('captures must be an array');
  if (!Array.isArray(embeddingRows)) throw new TypeError('embeddingRows must be an array');
  if (!provider || typeof provider.embed !== 'function') {
    throw new TypeError('provider.embed must be a function');
  }

  const chunkToAsset = new Map();
  const captureByAsset = new Map();
  const textTokensByAsset = new Map();
  for (const capture of captures) {
    const assetId = String(capture?.asset?.id ?? '').trim();
    if (!assetId) throw new TypeError('capture asset id must be non-empty');
    captureByAsset.set(assetId, capture);
    textTokensByAsset.set(
      assetId,
      tokenize((capture.chunks ?? []).map((chunk) => chunk.content).join(' ')),
    );
    for (const chunk of capture.chunks ?? []) {
      const chunkId = String(chunk?.id ?? '').trim();
      if (!chunkId) throw new TypeError('capture chunk id must be non-empty');
      if (chunkToAsset.has(chunkId)) throw new Error(`duplicate chunk id: ${chunkId}`);
      chunkToAsset.set(chunkId, assetId);
    }
  }

  const vectorsByAsset = new Map();
  const seenRows = new Set();
  for (const row of embeddingRows) {
    const chunkId = String(row?.chunk_id ?? '').trim();
    if (!chunkId || seenRows.has(chunkId)) {
      throw new Error(`duplicate or missing embedding chunk id: ${chunkId || 'missing'}`);
    }
    seenRows.add(chunkId);
    if (row.model_id !== provider.modelId) {
      throw new Error(`embedding model id mismatch: expected ${provider.modelId}, got ${row.model_id}`);
    }
    if (row.model_revision !== provider.modelRevision) {
      throw new Error(`embedding model revision mismatch: expected ${provider.modelRevision}, got ${row.model_revision}`);
    }
    const assetId = chunkToAsset.get(chunkId);
    if (!assetId) throw new Error(`embedding row references unknown chunk ${chunkId}`);
    const list = vectorsByAsset.get(assetId) ?? [];
    list.push(validateVector(row.embedding, `embedding ${chunkId}`));
    vectorsByAsset.set(assetId, list);
  }

  const entries = [];
  for (const [assetId, capture] of captureByAsset.entries()) {
    const vectors = vectorsByAsset.get(assetId);
    if (!vectors || vectors.length === 0) {
      throw new Error(`missing embeddings for asset ${assetId}`);
    }
    entries.push({
      capture,
      vector: meanVectors(vectors),
      textTokens: textTokensByAsset.get(assetId),
    });
  }
  return entries;
}

export function createOfflineEmbeddedRetriever({
  captures,
  embeddingRows,
  provider,
  mode = 'hybrid',
} = {}) {
  if (!['semantic', 'hybrid'].includes(mode)) {
    throw new TypeError('mode must be semantic or hybrid');
  }
  const entries = buildIndex({ captures, embeddingRows, provider });

  return async function embeddedRetrieve({ query, filters = {}, maxItems = 12 } = {}) {
    const queryText = String(query ?? '').trim();
    if (!queryText) throw new TypeError('query must be non-empty');
    const [queryVector] = await provider.embed([queryText]);
    validateVector(queryVector, 'query embedding');
    const queryTokens = tokenize(queryText);
    const eligibleEntries = entries.filter(({ capture }) => eligible(capture, filters));

    const semanticHits = eligibleEntries
      .map(({ capture, vector }) => ({
        id: capture.asset.id,
        score: cosineSimilarity(queryVector, vector),
      }))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .map(({ id }) => id);

    const lexicalHits = mode === 'hybrid'
      ? eligibleEntries
        .map(({ capture, textTokens }) => ({
          id: capture.asset.id,
          score: overlapCount(queryTokens, textTokens),
        }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
        .map(({ id }) => id)
      : [];

    const result = retrieveReferenceBundle({
      lexicalHits,
      semanticHits,
      assets: eligibleEntries.map(({ capture }) => assetRow(capture)),
      relations: [],
      filters,
      maxItems,
    });

    return {
      ...result,
      retrieval_mode: mode,
      semantic_enabled: true,
      model_id: provider.modelId,
      model_revision: provider.modelRevision,
    };
  };
}
