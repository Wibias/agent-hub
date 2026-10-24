import { retrieveReferenceBundle } from './retrieval.mjs';

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function requireLowercaseHex64(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a 64-character lowercase hex string`);
  }
  return value;
}

function normalizeP16ConsumptionResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('P16 grant consumption response is malformed');
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'consumed' || keys[1] !== 'consumption_id') {
    throw new Error('P16 grant consumption response is malformed');
  }
  if (value.consumed === true
      && typeof value.consumption_id === 'string'
      && value.consumption_id.trim().length > 0) {
    return {
      consumed: true,
      consumption_id: value.consumption_id,
    };
  }
  if (value.consumed === false && value.consumption_id === null) {
    return {
      consumed: false,
      consumption_id: null,
    };
  }
  throw new Error('P16 grant consumption response is malformed');
}

function normalizeUrl(value) {
  const url = requireString(value, 'url').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) {
    throw new TypeError('url must be an http(s) URL');
  }
  return url;
}

function candidateId(row) {
  if (typeof row === 'string') return row;
  if (row && typeof row === 'object') {
    return row.asset_id ?? row.id ?? null;
  }
  return null;
}

function validateEmbedding(embedding) {
  if (!Array.isArray(embedding) || embedding.length !== 384) {
    throw new TypeError('embedding must be a 384-number array');
  }
  if (embedding.some((value) => !Number.isFinite(value))) {
    throw new TypeError('embedding must contain only finite numbers');
  }
  return embedding;
}

function vectorText(embedding) {
  return `[${validateEmbedding(embedding).join(',')}]`;
}

function normalizeEmbeddingRow(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new TypeError(`embeddings[${index}] must be an object`);
  }
  return {
    chunk_id: requireString(row.chunk_id, `embeddings[${index}].chunk_id`),
    model_id: requireString(row.model_id, `embeddings[${index}].model_id`),
    model_revision: requireString(
      row.model_revision,
      `embeddings[${index}].model_revision`,
    ),
    text_hash: requireString(row.text_hash, `embeddings[${index}].text_hash`),
    embedding: [...validateEmbedding(row.embedding)],
  };
}

function normalizeContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { assets: [], relations: [] };
  }
  return {
    assets: Array.isArray(value.assets) ? value.assets : [],
    relations: Array.isArray(value.relations) ? value.relations : [],
  };
}

function uniqueAssetIds(assetIds) {
  return [...new Set(
    (Array.isArray(assetIds) ? assetIds : [])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean),
  )];
}

export class ReferenceGraphSupabaseStore {
  constructor({ url, serviceRoleKey, fetchImpl = globalThis.fetch } = {}) {
    this.url = normalizeUrl(url);
    this.serviceRoleKey = requireString(serviceRoleKey, 'serviceRoleKey');
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('fetchImpl must be a function');
    }
    this.fetchImpl = fetchImpl;
  }

  static fromEnv(env = process.env, options = {}) {
    return new ReferenceGraphSupabaseStore({
      url: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      ...options,
    });
  }

  async rpc(name, args = {}) {
    const rpcName = requireString(name, 'RPC name');
    const response = await this.fetchImpl(`${this.url}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(args),
    });

    const raw = await response.text();
    let body = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }

    if (!response.ok) {
      const detail = typeof body === 'string'
        ? body
        : body?.message ?? body?.details ?? response.statusText ?? 'request failed';
      const safeDetail = String(detail).split(this.serviceRoleKey).join('[redacted]');
      throw new Error(`Supabase RPC ${rpcName} failed (${response.status}): ${safeDetail}`);
    }

    return body;
  }

  async persistCapture(capture) {
    return this.rpc('reference_graph_ingest_capture', { p_capture: capture });
  }

  async persistCaptures(captures) {
    if (!Array.isArray(captures)) {
      throw new TypeError('captures must be an array');
    }
    return this.rpc('reference_graph_ingest_captures', { p_captures: captures });
  }

  async persistEmbeddings(embeddings) {
    if (!Array.isArray(embeddings)) {
      throw new TypeError('embeddings must be an array');
    }
    const normalized = embeddings.map(normalizeEmbeddingRow);
    return this.rpc('reference_graph_upsert_embeddings', {
      p_embeddings: normalized,
    });
  }

  async recordVerifications(rows) {
    if (!Array.isArray(rows)) {
      throw new TypeError('verification rows must be an array');
    }
    return this.rpc('reference_graph_record_verifications', {
      p_verifications: rows,
    });
  }

  async embeddingCoverage(modelId, modelRevision, referenceDate) {
    const result = await this.rpc('reference_graph_embedding_coverage', {
      p_model_id: requireString(modelId, 'modelId'),
      p_model_revision: requireString(modelRevision, 'modelRevision'),
      p_reference_date: requireString(referenceDate, 'referenceDate'),
    });
    return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  }

  async lexicalCandidates(query, filters = {}, limit = 48) {
    const rows = await this.rpc('reference_graph_lexical_candidates', {
      p_query: String(query ?? ''),
      p_filters: filters,
      p_limit: limit,
    });
    return Array.isArray(rows) ? rows : [];
  }

  async semanticCandidates(embedding, modelId, modelRevision, filters = {}, limit = 48) {
    const rows = await this.rpc('reference_graph_semantic_candidates', {
      p_embedding_text: vectorText(embedding),
      p_model_id: requireString(modelId, 'modelId'),
      p_model_revision: requireString(modelRevision, 'modelRevision'),
      p_filters: filters,
      p_limit: limit,
    });
    return Array.isArray(rows) ? rows : [];
  }

  async candidateContext(assetIds, filters = {}) {
    const uniqueIds = uniqueAssetIds(assetIds);
    if (uniqueIds.length === 0) return { assets: [], relations: [] };
    return normalizeContext(await this.rpc('reference_graph_candidate_context', {
      p_asset_ids: uniqueIds,
      p_filters: filters,
    }));
  }

  async lexicalCandidatesP6(query, filters = {}, limit = 48) {
    const rows = await this.rpc('reference_graph_lexical_candidates_p6', {
      p_query: String(query ?? ''),
      p_filters: filters,
      p_limit: limit,
    });
    return Array.isArray(rows) ? rows : [];
  }

  async semanticCandidatesP6(embedding, modelId, modelRevision, filters = {}, limit = 48) {
    const rows = await this.rpc('reference_graph_semantic_candidates_p6', {
      p_embedding_text: vectorText(embedding),
      p_model_id: requireString(modelId, 'modelId'),
      p_model_revision: requireString(modelRevision, 'modelRevision'),
      p_filters: filters,
      p_limit: limit,
    });
    return Array.isArray(rows) ? rows : [];
  }

  async candidateContextP6(assetIds, filters = {}) {
    const uniqueIds = uniqueAssetIds(assetIds);
    if (uniqueIds.length === 0) return { assets: [], relations: [] };
    return normalizeContext(await this.rpc('reference_graph_candidate_context_p6', {
      p_asset_ids: uniqueIds,
      p_filters: filters,
    }));
  }

  async quickCandidatePoolP7(filters = {}) {
    const rows = await this.rpc('reference_graph_quick_candidate_pool_p7', {
      p_filters: filters,
    });
    return Array.isArray(rows) ? rows : [];
  }

  async consumeActivationGrantNonceP16({
    nonce,
    grant_payload_hash,
    request_hash,
    authority_hash,
  } = {}) {
    const result = await this.rpc('reference_graph_consume_activation_grant_nonce_p16', {
      p_nonce: requireLowercaseHex64(nonce, 'nonce'),
      p_grant_payload_hash: requireLowercaseHex64(grant_payload_hash, 'grant_payload_hash'),
      p_request_hash: requireLowercaseHex64(request_hash, 'request_hash'),
      p_authority_hash: requireLowercaseHex64(authority_hash, 'authority_hash'),
    });
    return normalizeP16ConsumptionResponse(result);
  }

  async stats() {
    const result = await this.rpc('reference_graph_stats', {});
    return result && typeof result === 'object' ? result : {};
  }

  async retrieve({
    query,
    embedding = null,
    modelId = null,
    modelRevision = null,
    filters = {},
    maxItems = 12,
    candidateLimit = null,
  } = {}) {
    const limit = candidateLimit ?? Math.min(100, Math.max(24, maxItems * 4));
    const lexicalRows = await this.lexicalCandidates(query, filters, limit);
    const semanticRows = embedding === null
      ? []
      : await this.semanticCandidates(
        embedding,
        modelId,
        modelRevision,
        filters,
        limit,
      );

    const lexicalHits = lexicalRows.map(candidateId).filter(Boolean);
    const semanticHits = semanticRows.map(candidateId).filter(Boolean);
    const seedIds = [...new Set([...lexicalHits, ...semanticHits])];
    const context = await this.candidateContext(seedIds, filters);

    return retrieveReferenceBundle({
      lexicalHits,
      semanticHits,
      assets: context.assets,
      relations: context.relations,
      filters,
      maxItems,
    });
  }
}
