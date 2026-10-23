import { retrieveReferenceBundle } from './retrieval.mjs';

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
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

function vectorText(embedding) {
  if (!Array.isArray(embedding) || embedding.length !== 384) {
    throw new TypeError('embedding must be a 384-number array');
  }
  if (embedding.some((value) => !Number.isFinite(value))) {
    throw new TypeError('embedding must contain only finite numbers');
  }
  return `[${embedding.join(',')}]`;
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
    const uniqueIds = [...new Set(
      (Array.isArray(assetIds) ? assetIds : [])
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
    )];
    if (uniqueIds.length === 0) return { assets: [], relations: [] };
    return normalizeContext(await this.rpc('reference_graph_candidate_context', {
      p_asset_ids: uniqueIds,
      p_filters: filters,
    }));
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
