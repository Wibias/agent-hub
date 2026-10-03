const DEFAULT_RRF_K = 60;

function compareCodePoints(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function validateEmbeddingVector(vector, dimensions, name) {
  if (!(vector instanceof Float32Array)) {
    throw new TypeError(`${name} must be a Float32Array`);
  }
  if (vector.length !== dimensions) {
    throw new RangeError(`${name} dimensions must match embedder dimensions`);
  }
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${name} values must be finite`);
    }
  }
  return vector;
}

function validateEmbedder(embedder) {
  assertNonEmptyString(embedder.modelId, 'embedder modelId');
  assertNonEmptyString(embedder.modelRevision, 'embedder modelRevision');
  if (!Number.isInteger(embedder.dimensions) || embedder.dimensions < 1) {
    throw new RangeError('embedder dimensions must be a positive integer');
  }
  if (typeof embedder.embedQuery !== 'function') {
    throw new TypeError('embedder embedQuery must be a function');
  }
  if (typeof embedder.embedPassages !== 'function') {
    throw new TypeError('embedder embedPassages must be a function');
  }
}

function assertIdList(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  for (const id of value) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError(`${name} entries must be non-empty strings`);
    }
  }
}

function rankMap(ids) {
  const ranks = new Map();
  let rank = 0;
  for (const id of ids) {
    if (ranks.has(id)) continue;
    rank += 1;
    ranks.set(id, rank);
  }
  return ranks;
}

function reciprocalRankDetails({
  lexicalIds,
  semanticIds,
  createdAtById,
  k = DEFAULT_RRF_K,
}) {
  assertIdList(lexicalIds, 'lexicalIds');
  assertIdList(semanticIds, 'semanticIds');
  if (!(createdAtById instanceof Map)) {
    throw new TypeError('createdAtById must be a Map');
  }
  if (!Number.isFinite(k) || k <= 0) {
    throw new RangeError('k must be greater than zero');
  }

  const lexicalRanks = rankMap(lexicalIds);
  const semanticRanks = rankMap(semanticIds);
  const ids = new Set([...lexicalRanks.keys(), ...semanticRanks.keys()]);

  const details = [...ids].map((id) => {
    const lexicalRank = lexicalRanks.get(id) ?? null;
    const semanticRank = semanticRanks.get(id) ?? null;
    const score = (
      (lexicalRank === null ? 0 : (1 / (k + lexicalRank)))
      + (semanticRank === null ? 0 : (1 / (k + semanticRank)))
    );
    return {
      id,
      lexicalRank,
      semanticRank,
      score,
    };
  });

  details.sort((left, right) => {
    const scoreDifference = right.score - left.score;
    if (scoreDifference !== 0) return scoreDifference;

    const leftCreatedAt = createdAtById.get(left.id) ?? '';
    const rightCreatedAt = createdAtById.get(right.id) ?? '';
    const createdAtDifference = compareCodePoints(rightCreatedAt, leftCreatedAt);
    if (createdAtDifference !== 0) return createdAtDifference;

    return compareCodePoints(left.id, right.id);
  });

  return details.map((detail, index) => ({
    ...detail,
    finalRank: index + 1,
  }));
}

export function reciprocalRankFuse({
  lexicalIds,
  semanticIds,
  createdAtById,
  k = DEFAULT_RRF_K,
}) {
  return reciprocalRankDetails({
    lexicalIds,
    semanticIds,
    createdAtById,
    k,
  }).map((detail) => detail.id);
}

function validateBudget(maxItems, maxSerializedBytes) {
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 10) {
    throw new RangeError('maxItems must be an integer between 1 and 10');
  }
  if (
    !Number.isInteger(maxSerializedBytes)
    || maxSerializedBytes < 1
    || maxSerializedBytes > 16_384
  ) {
    throw new RangeError(
      'maxSerializedBytes must be an integer between 1 and 16384',
    );
  }
}

function connectedConflicts(conflicts, retainedIds) {
  return conflicts.filter(
    (conflict) => (
      retainedIds.has(conflict.claim_a)
      || retainedIds.has(conflict.claim_b)
    ),
  );
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function enforceRecallBudget(result, {
  maxItems = 10,
  maxSerializedBytes = 16_384,
} = {}) {
  validateBudget(maxItems, maxSerializedBytes);
  if (!result || typeof result !== 'object') {
    throw new TypeError('result must be an object');
  }
  if (!Array.isArray(result.items) || !Array.isArray(result.conflicts)) {
    throw new TypeError('result must contain items and conflicts arrays');
  }

  const items = result.items.slice(0, maxItems);

  const build = () => {
    const retainedIds = new Set(items.map((item) => item?.claim?.id));
    return {
      items: [...items],
      conflicts: connectedConflicts(result.conflicts, retainedIds),
    };
  };

  let bounded = build();
  while (items.length > 0 && serializedBytes(bounded) > maxSerializedBytes) {
    items.pop();
    bounded = build();
  }

  if (serializedBytes(bounded) > maxSerializedBytes) {
    throw new RangeError(
      'maxSerializedBytes is too small to serialize an empty recall result',
    );
  }

  return bounded;
}


export class HybridMemoryRetriever {
  #memory;
  #embedder;
  #lexicalCandidateLimit;
  #semanticCandidateLimit;

  constructor({
    memory,
    embedder = null,
    lexicalCandidateLimit = 32,
    semanticCandidateLimit = 32,
  }) {
    if (!memory || typeof memory !== 'object') {
      throw new TypeError('memory must be a MemoryEngine-like object');
    }
    if (embedder !== null) validateEmbedder(embedder);
    for (const [value, name] of [
      [lexicalCandidateLimit, 'lexicalCandidateLimit'],
      [semanticCandidateLimit, 'semanticCandidateLimit'],
    ]) {
      if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive integer`);
      }
    }

    this.#memory = memory;
    this.#embedder = embedder;
    this.#lexicalCandidateLimit = lexicalCandidateLimit;
    this.#semanticCandidateLimit = semanticCandidateLimit;
  }

  async indexClaim(claimId) {
    if (this.#embedder === null) {
      return { indexed: false, reason: 'no_embedder' };
    }

    const document = this.#memory.embeddingDocument({ claimId });
    if (!document) {
      return { indexed: false, reason: 'missing_claim' };
    }

    const vectors = await this.#embedder.embedPassages([document.text]);
    if (!Array.isArray(vectors) || vectors.length !== 1) {
      throw new Error('embedPassages must return one vector per passage');
    }
    validateEmbeddingVector(
      vectors[0],
      this.#embedder.dimensions,
      'passage embedding',
    );

    this.#memory.putClaimEmbedding({
      claimId,
      modelId: this.#embedder.modelId,
      modelRevision: this.#embedder.modelRevision,
      textHash: document.text_hash,
      dimensions: this.#embedder.dimensions,
      vector: vectors[0],
    });

    return { indexed: true };
  }

  async rebuildSemanticIndex({ projectId, branch }) {
    if (this.#embedder === null) {
      return { indexed: 0, failed: 0 };
    }

    const documents = this.#memory.listEmbeddingDocuments({ projectId, branch });
    let vectors;
    try {
      vectors = await this.#embedder.embedPassages(
        documents.map((document) => document.text),
      );
      if (!Array.isArray(vectors) || vectors.length !== documents.length) {
        throw new Error('embedPassages must return one vector per passage');
      }
      for (const vector of vectors) {
        validateEmbeddingVector(
          vector,
          this.#embedder.dimensions,
          'passage embedding',
        );
      }
    } catch {
      return { indexed: 0, failed: documents.length };
    }

    this.#memory.replaceClaimEmbeddings({
      projectId,
      branch,
      modelId: this.#embedder.modelId,
      modelRevision: this.#embedder.modelRevision,
      rows: documents.map((document, index) => ({
        claimId: document.claim_id,
        textHash: document.text_hash,
        dimensions: this.#embedder.dimensions,
        vector: vectors[index],
      })),
    });

    return { indexed: documents.length, failed: 0 };
  }

  async #rankRecallCandidates({
    projectId,
    branch,
    revisionSha = null,
    query,
    mode = 'current',
  }) {
    const lexical = this.#memory.recall({
      projectId,
      branch,
      revisionSha,
      query,
      mode,
      limit: this.#lexicalCandidateLimit,
    });

    const lexicalIds = lexical.items.map((item) => item.claim.id);
    const lexicalFallback = (fallbackReason) => ({
      retrievalMode: 'lexical',
      fallbackReason,
      lexical,
      semantic: [],
      ranking: lexicalIds.map((id, index) => ({
        id,
        lexicalRank: index + 1,
        semanticRank: null,
        score: null,
        finalRank: index + 1,
      })),
    });

    if (this.#embedder === null) {
      return lexicalFallback('embedder_unavailable');
    }

    let queryVector;
    try {
      queryVector = await this.#embedder.embedQuery(query);
      validateEmbeddingVector(
        queryVector,
        this.#embedder.dimensions,
        'query embedding',
      );
    } catch {
      return lexicalFallback('query_embedding_failed');
    }

    const semantic = this.#memory.semanticCandidates({
      projectId,
      branch,
      revisionSha,
      mode,
      modelId: this.#embedder.modelId,
      modelRevision: this.#embedder.modelRevision,
    })
      .filter((candidate) => candidate.dimensions === queryVector.length)
      .map((candidate) => ({
        ...candidate,
        similarity: candidate.vector.reduce(
          (score, value, index) => score + (value * queryVector[index]),
          0,
        ),
      }))
      .sort((left, right) => (
        (right.similarity - left.similarity)
        || compareCodePoints(right.created_at, left.created_at)
        || compareCodePoints(left.claim_id, right.claim_id)
      ))
      .slice(0, this.#semanticCandidateLimit);

    const semanticIds = semantic.map((candidate) => candidate.claim_id);
    const createdAtById = new Map();
    for (const item of lexical.items) {
      createdAtById.set(item.claim.id, item.claim.created_at);
    }
    for (const candidate of semantic) {
      createdAtById.set(candidate.claim_id, candidate.created_at);
    }

    return {
      retrievalMode: 'hybrid',
      fallbackReason: null,
      lexical,
      semantic,
      ranking: reciprocalRankDetails({
        lexicalIds,
        semanticIds,
        createdAtById,
      }),
    };
  }

  async diagnoseRecall({
    projectId,
    branch,
    revisionSha = null,
    query,
    mode = 'current',
    maxItems = 10,
  }) {
    validateBudget(maxItems, 16_384);
    const ranked = await this.#rankRecallCandidates({
      projectId,
      branch,
      revisionSha,
      query,
      mode,
    });

    let materialized;
    if (ranked.retrievalMode === 'lexical') {
      materialized = {
        items: ranked.lexical.items.slice(0, maxItems),
        conflicts: connectedConflicts(
          ranked.lexical.conflicts,
          new Set(
            ranked.lexical.items
              .slice(0, maxItems)
              .map((item) => item.claim.id),
          ),
        ),
      };
    } else {
      materialized = this.#memory.materializeRecall({
        projectId,
        branch,
        revisionSha,
        mode,
        claimIds: ranked.ranking
          .slice(0, maxItems)
          .map((detail) => detail.id),
      });
    }

    const itemById = new Map(
      materialized.items.map((item) => [item.claim.id, item]),
    );
    const semanticById = new Map(
      ranked.semantic.map((candidate) => [candidate.claim_id, candidate]),
    );

    return {
      retrievalMode: ranked.retrievalMode,
      fallbackReason: ranked.fallbackReason,
      candidates: ranked.ranking
        .slice(0, maxItems)
        .map((detail) => ({
          item: itemById.get(detail.id) ?? null,
          lexicalRank: detail.lexicalRank,
          semanticRank: detail.semanticRank,
          semanticSimilarity: (
            semanticById.get(detail.id)?.similarity ?? null
          ),
          finalRank: detail.finalRank,
          rrfScore: detail.score,
        }))
        .filter((candidate) => candidate.item !== null),
      conflicts: materialized.conflicts,
    };
  }

  async recallDetailed({
    projectId,
    branch,
    revisionSha = null,
    query,
    mode = 'current',
    maxItems = 10,
    maxSerializedBytes = 16_384,
  }) {
    const ranked = await this.#rankRecallCandidates({
      projectId,
      branch,
      revisionSha,
      query,
      mode,
    });

    const unbounded = ranked.retrievalMode === 'lexical'
      ? ranked.lexical
      : this.#memory.materializeRecall({
          projectId,
          branch,
          revisionSha,
          mode,
          claimIds: ranked.ranking.map((detail) => detail.id),
        });
    const result = enforceRecallBudget(unbounded, {
      maxItems,
      maxSerializedBytes,
    });
    const retainedIds = new Set(
      result.items.map((item) => item?.claim?.id).filter(Boolean),
    );
    const allItems = new Map(
      unbounded.items
        .filter((item) => item?.claim?.id)
        .map((item) => [item.claim.id, item]),
    );
    const semanticById = new Map(
      ranked.semantic.map((item) => [item.claim_id, item]),
    );

    return {
      result,
      telemetry: {
        retrieval_mode: ranked.retrievalMode,
        fallback_reason: ranked.fallbackReason,
        candidates: ranked.ranking.map((detail) => {
          const item = allItems.get(detail.id) ?? null;
          return {
            claim_id: detail.id,
            authority_class: item?.evidence?.authority_class ?? 'unclassified',
            final_rank: detail.finalRank,
            lexical_rank: detail.lexicalRank,
            semantic_rank: detail.semanticRank,
            semantic_similarity: (
              semanticById.get(detail.id)?.similarity ?? null
            ),
            rrf_score: detail.score,
            budget_retained: retainedIds.has(detail.id),
          };
        }),
      },
    };
  }

  async recall(args) {
    const detailed = await this.recallDetailed(args);
    return detailed.result;
  }
}
