import { createHash } from 'node:crypto';

function positiveInteger(value, name, fallback) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return resolved;
}

function requireProvider(provider) {
  if (!provider || typeof provider !== 'object') {
    throw new TypeError('provider must be an object');
  }
  if (typeof provider.embed !== 'function') {
    throw new TypeError('provider.embed must be a function');
  }
  if (typeof provider.modelId !== 'string' || provider.modelId.trim().length === 0) {
    throw new TypeError('provider.modelId must be a non-empty string');
  }
  if (typeof provider.modelRevision !== 'string' || provider.modelRevision.trim().length === 0) {
    throw new TypeError('provider.modelRevision must be a non-empty string');
  }
}

function validateVector(vector, index) {
  if (!Array.isArray(vector) || vector.length !== 384) {
    throw new TypeError(`embedding[${index}] must be a 384-number array`);
  }
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new TypeError(`embedding[${index}] must contain only finite numbers`);
  }
  return [...vector];
}

function textHash(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function flattenChunks(captures) {
  if (!Array.isArray(captures)) throw new TypeError('captures must be an array');
  const chunks = [];
  const seen = new Set();

  for (let captureIndex = 0; captureIndex < captures.length; captureIndex += 1) {
    const capture = captures[captureIndex];
    const rows = Array.isArray(capture?.chunks) ? capture.chunks : [];
    for (let chunkIndex = 0; chunkIndex < rows.length; chunkIndex += 1) {
      const chunk = rows[chunkIndex];
      const id = String(chunk?.id ?? '').trim();
      const content = typeof chunk?.content === 'string' ? chunk.content : '';
      if (!id) throw new TypeError(`captures[${captureIndex}].chunks[${chunkIndex}].id must be non-empty`);
      if (!content.trim()) {
        throw new TypeError(`captures[${captureIndex}].chunks[${chunkIndex}].content must be non-empty`);
      }
      if (seen.has(id)) throw new Error(`duplicate chunk id: ${id}`);
      seen.add(id);
      chunks.push({ id, content });
    }
  }
  return chunks;
}

function requireProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new TypeError('profile must be an object');
  }
  const modelTag = String(profile.modelTag ?? '').trim();
  const modelRevision = String(profile.modelRevision ?? '').trim();
  if (!modelTag) throw new TypeError('profile.modelTag must be non-empty');
  if (!modelRevision) throw new TypeError('profile.modelRevision must be non-empty');
  if (profile.dimensions !== 384) throw new TypeError('profile dimensions must be 384');
  return {
    modelId: `ollama/${modelTag}`,
    modelRevision,
    dimensions: profile.dimensions,
  };
}

function validateExpectedRows(rows, profile) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  const expected = requireProfile(profile);
  const seenChunks = new Set();
  const textHashes = new Set();

  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new TypeError(`rows[${index}] must be an object`);
    }
    const chunkId = String(row.chunk_id ?? '').trim();
    if (!chunkId) throw new TypeError(`rows[${index}].chunk_id must be non-empty`);
    if (seenChunks.has(chunkId)) throw new Error(`duplicate embedding chunk id: ${chunkId}`);
    seenChunks.add(chunkId);
    if (row.model_id !== expected.modelId) {
      throw new Error(`embedding profile model id mismatch: expected ${expected.modelId}, got ${row.model_id}`);
    }
    if (row.model_revision !== expected.modelRevision) {
      throw new Error(`embedding profile revision mismatch: expected ${expected.modelRevision}, got ${row.model_revision}`);
    }
    const hash = String(row.text_hash ?? '').trim();
    if (!hash) throw new TypeError(`rows[${index}].text_hash must be non-empty`);
    textHashes.add(hash);
    validateVector(row.embedding, index);
  });

  return { expected, textHashes };
}

export function summarizeExpectedEmbeddingRows(rows, profile) {
  const { expected, textHashes } = validateExpectedRows(rows, profile);
  return {
    row_count: rows.length,
    model_id: expected.modelId,
    model_revision: expected.modelRevision,
    dimensions: expected.dimensions,
    text_hash_count: textHashes.size,
  };
}

export function createEmbeddingExportArtifact({ rows, profile } = {}) {
  const summary = summarizeExpectedEmbeddingRows(rows, profile);
  const sortedRows = [...rows]
    .sort((left, right) => String(left.chunk_id).localeCompare(String(right.chunk_id)))
    .map((row) => ({
      chunk_id: row.chunk_id,
      model_id: row.model_id,
      model_revision: row.model_revision,
      text_hash: row.text_hash,
      embedding: [...row.embedding],
    }));
  return {
    schema_version: 'reference-graph.embedding-export.v1',
    profile: {
      id: String(profile.id),
      model_id: summary.model_id,
      model_revision: summary.model_revision,
      dimensions: summary.dimensions,
      quality_status: profile.qualityStatus,
      cutover_approved: profile.cutoverApproved === true,
    },
    summary,
    rows: sortedRows,
  };
}

export function assertCompleteEmbeddingCoverage(coverage) {
  if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) {
    throw new TypeError('embedding coverage must be an object');
  }
  const eligible = Number(coverage.eligible_chunk_count);
  const compatible = Number(coverage.compatible_count);
  const missing = Number(coverage.missing_count);
  const mismatch = Number(coverage.text_hash_mismatch_count);
  const rate = Number(coverage.coverage_rate);
  if (![eligible, compatible, missing, mismatch, rate].every(Number.isFinite)) {
    throw new TypeError('embedding coverage fields must be finite numbers');
  }
  if (eligible < 1) throw new Error('embedding coverage is incomplete: no eligible chunks');
  if (compatible !== eligible || missing !== 0 || mismatch !== 0 || rate !== 1) {
    throw new Error(
      `embedding coverage is incomplete: compatible=${compatible}/${eligible}, missing=${missing}, text_hash_mismatch=${mismatch}, rate=${rate}`,
    );
  }
  return true;
}

export async function buildEmbeddingRows({
  captures,
  provider,
  batchSize = 32,
  onProgress = null,
} = {}) {
  requireProvider(provider);
  if (onProgress !== null && typeof onProgress !== 'function') {
    throw new TypeError('onProgress must be a function when supplied');
  }
  const size = positiveInteger(batchSize, 'batchSize', 32);
  const chunks = flattenChunks(captures);
  const rows = [];

  for (let offset = 0; offset < chunks.length; offset += size) {
    const batch = chunks.slice(offset, offset + size);
    const vectors = await provider.embed(batch.map((chunk) => chunk.content));
    if (!Array.isArray(vectors) || vectors.length !== batch.length) {
      throw new Error(`provider returned ${vectors?.length ?? 0} embeddings for ${batch.length} chunks`);
    }

    for (let index = 0; index < batch.length; index += 1) {
      const chunk = batch[index];
      rows.push({
        chunk_id: chunk.id,
        model_id: provider.modelId,
        model_revision: provider.modelRevision,
        text_hash: textHash(chunk.content),
        embedding: validateVector(vectors[index], index),
      });
    }

    if (onProgress) {
      await onProgress({ embedded: rows.length, total: chunks.length, batch_size: batch.length });
    }
  }

  return rows;
}

export async function persistEmbeddingRows({
  rows,
  store,
  batchSize = 50,
  onProgress = null,
} = {}) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  if (!store || typeof store.persistEmbeddings !== 'function') {
    throw new TypeError('store.persistEmbeddings must be a function');
  }
  if (onProgress !== null && typeof onProgress !== 'function') {
    throw new TypeError('onProgress must be a function when supplied');
  }
  const size = positiveInteger(batchSize, 'batchSize', 50);
  let persisted = 0;
  const batchResults = [];

  for (let offset = 0; offset < rows.length; offset += size) {
    const batch = rows.slice(offset, offset + size);
    const result = await store.persistEmbeddings(batch);
    persisted += batch.length;
    batchResults.push(result);
    if (onProgress) {
      await onProgress({ persisted, total: rows.length, batch_size: batch.length });
    }
  }

  return {
    persisted_count: persisted,
    batch_count: batchResults.length,
    batch_results: batchResults,
  };
}
