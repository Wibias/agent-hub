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
