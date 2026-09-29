const DEFAULT_RRF_K = 60;

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

export function reciprocalRankFuse({
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

  const scores = new Map();

  const addRanks = (ids) => {
    const seen = new Set();
    let rank = 0;
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      rank += 1;
      scores.set(id, (scores.get(id) ?? 0) + (1 / (k + rank)));
    }
  };

  addRanks(lexicalIds);
  addRanks(semanticIds);

  return [...scores.keys()].sort((left, right) => {
    const scoreDifference = scores.get(right) - scores.get(left);
    if (scoreDifference !== 0) return scoreDifference;

    const leftCreatedAt = createdAtById.get(left) ?? '';
    const rightCreatedAt = createdAtById.get(right) ?? '';
    const createdAtDifference = rightCreatedAt.localeCompare(leftCreatedAt);
    if (createdAtDifference !== 0) return createdAtDifference;

    return left.localeCompare(right);
  });
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

  async recall({
    projectId,
    branch,
    revisionSha = null,
    query,
    mode = 'current',
    maxItems = 10,
    maxSerializedBytes = 16_384,
  }) {
    const lexical = this.#memory.recall({
      projectId,
      branch,
      revisionSha,
      query,
      mode,
      limit: this.#lexicalCandidateLimit,
    });

    if (this.#embedder === null) {
      return enforceRecallBudget(lexical, {
        maxItems,
        maxSerializedBytes,
      });
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
      return enforceRecallBudget(lexical, {
        maxItems,
        maxSerializedBytes,
      });
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
        || right.created_at.localeCompare(left.created_at)
        || left.claim_id.localeCompare(right.claim_id)
      ))
      .slice(0, this.#semanticCandidateLimit);

    const lexicalIds = lexical.items.map((item) => item.claim.id);
    const semanticIds = semantic.map((candidate) => candidate.claim_id);
    const createdAtById = new Map();
    for (const item of lexical.items) {
      createdAtById.set(item.claim.id, item.claim.created_at);
    }
    for (const candidate of semantic) {
      createdAtById.set(candidate.claim_id, candidate.created_at);
    }

    const fusedIds = reciprocalRankFuse({
      lexicalIds,
      semanticIds,
      createdAtById,
    });
    const materialized = this.#memory.materializeRecall({
      projectId,
      branch,
      revisionSha,
      mode,
      claimIds: fusedIds,
    });

    return enforceRecallBudget(materialized, {
      maxItems,
      maxSerializedBytes,
    });
  }
}
