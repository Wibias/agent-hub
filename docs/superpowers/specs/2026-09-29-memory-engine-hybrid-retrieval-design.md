# Hybrid Memory Retrieval Design

Date: 2026-09-29

Status: approved for implementation planning

## Context

The reference memory engine now has explicit regression coverage for Memory Ratchet M01-M15. The remaining roadmap item from the research synthesis is bounded hybrid retrieval.

The existing FTS5 path is deterministic and already passes M14 under 2,000 unrelated distractors. A focused retrieval spike showed a separate relevance limitation: semantically equivalent paraphrases with little lexical overlap can return no result even when the correct memory is present.

Examples that miss under lexical-only recall include:

- "Which storage engine did we choose to handle multiple processes writing at once?"
- "Welche Datenbank haben wir wegen paralleler Schreibzugriffe gewählt?"
- "For how long do we preserve security event records?"

The architecture research already identified a compatible semantic baseline:

- model: `intfloat/multilingual-e5-small`
- model revision: `fd1525a9fd15316a2d503bf26ab031a61d056e98`
- dimensions: 384
- retrieval prefixes: `query:` and `passage:`
- fusion: Reciprocal Rank Fusion (RRF)
- no model reranker

The official pinned ONNX artifact is roughly 470 MB. The first implementation intentionally prefers the exact researched artifact over a smaller converted or quantized derivative. A smaller artifact can be considered later only after an explicit parity and performance benchmark.

## Goals

The hybrid layer must:

1. recover relevant memory for lexical-light paraphrases and multilingual queries;
2. preserve every correctness boundary already enforced by the canonical engine;
3. keep embeddings and semantic indexes fully derived and rebuildable;
4. keep the existing synchronous `MemoryEngine` correctness core usable without a model runtime;
5. remain deterministic at the fusion layer;
6. enforce both item and serialized-byte recall budgets;
7. operate without network access during normal recall once the model cache is prepared.

## Non-goals

This change does not add:

- a vector database;
- approximate-nearest-neighbor indexing;
- an LLM reranker;
- autonomous summarization;
- memory reflection;
- background consolidation;
- graph traversal;
- semantic authority, freshness, lifecycle, or approval decisions;
- automatic remote model downloads during normal recall.

Semantic similarity is relevance only. It never changes what evidence is allowed to mean.

## Architectural boundary

The existing `MemoryEngine` remains the canonical synchronous correctness core.

A new asynchronous `HybridMemoryRetriever` sits above it.

```text
caller
  |
  v
HybridMemoryRetriever
  |---- SemanticEmbedder
  |        |
  |        +---- pinned local E5 provider
  |
  +---- MemoryEngine
           |
           +---- canonical SQLite truth
           +---- lexical FTS derived index
           +---- semantic-vector derived rows
           +---- freshness / lifecycle / authority-safe materialization
```

The hybrid wrapper may improve ranking. It may not bypass project scope, branch scope, current/historical mode, Git freshness, claim lifecycle, conflict handling, reliance policy, or structured action approvals.

The existing `MemoryEngine.recall(...)` remains available as the lexical baseline and fallback path.

## Semantic embedder interface

The core hybrid layer depends on an interface rather than a concrete model package.

Conceptually:

```js
{
  modelId: string,
  modelRevision: string,
  dimensions: number,
  embedQuery(text): Promise<Float32Array>,
  embedPassages(texts): Promise<Float32Array[]>
}
```

Requirements:

- returned vectors are normalized;
- dimensions are fixed and validated;
- model identity and revision are immutable for one provider instance;
- query embedding uses the model's `query:` convention;
- passage embedding uses the model's `passage:` convention;
- provider failures never mutate canonical memory.

Tests for the fusion/core layer use a deterministic fake embedder. The concrete E5 dependency is isolated in a provider module.

## Concrete E5 provider

The first provider uses:

- `@huggingface/transformers` exactly pinned to `4.3.0`;
- `intfloat/multilingual-e5-small`;
- model revision `fd1525a9fd15316a2d503bf26ab031a61d056e98`;
- the official ONNX artifact from the pinned model revision;
- CPU/WASM execution for the first version;
- mean pooling;
- normalized output.

GPU/WebGPU execution is out of scope for the first implementation because it adds hardware-specific behavior without being required for correctness.

The provider accepts an explicit cache directory. Normal runtime initializes with remote model loading disabled.

A separate explicit cache-preparation command may temporarily allow remote loading in order to populate the configured cache. Recall itself must never initiate a network download.

The model files are not committed to this repository.

## Dependency isolation

The dependency is introduced only in the concrete provider delivery step.

The implementation is split so the core hybrid architecture can land without an external ML dependency:

### Delivery A: hybrid core

Adds:

- embedder interface;
- semantic derived schema;
- deterministic RRF;
- recall byte-budget enforcement;
- deterministic fake-embedder tests;
- semantic correctness-boundary tests.

No Transformers.js dependency is added in this delivery.

### Delivery B: pinned E5 provider

Adds:

- exact `@huggingface/transformers@4.3.0` dependency;
- pinned model/revision configuration;
- explicit cache-preparation script;
- offline runtime initialization;
- real semantic retrieval evaluation.

This separation keeps the canonical engine dependency-light and makes provider adoption independently reviewable.

## Derived semantic schema

Embeddings are derived state, never canonical state.

Add a table equivalent to:

```text
claim_embeddings
  claim_id
  model_id
  model_revision
  text_hash
  dimensions
  vector_blob
  indexed_at
```

Primary identity is the claim plus exact model identity and revision.

Properties:

- `vector_blob` stores little-endian Float32 data;
- `dimensions` must match the provider;
- `text_hash` is SHA-256 over the exact passage text used for embedding;
- stale model revisions are not reused;
- mismatched text hashes are not reused;
- the table is excluded from canonical export;
- derived-state clearing deletes semantic rows;
- semantic rebuild regenerates rows from redacted canonical evidence and claims.

No raw secret-bearing text may enter embedding generation because the passage source is already-redacted canonical memory.

## Passage construction

Semantic passage text is deterministic and contains the same durable concepts used by lexical search:

```text
passage: <claim kind> <subject> <predicate> <claim value> <redacted evidence content>
```

Whitespace is normalized before hashing and embedding.

The query path is:

```text
query: <user recall query>
```

Do not inject authority class, freshness state, approval capability, or hidden policy labels into embedding text. Those are correctness inputs, not relevance hints.

## Index lifecycle

Canonical ingest must not depend on model inference succeeding.

The sequence is:

```text
1. canonical ingest commits
2. hybrid layer requests the canonical embedding document
3. provider computes the passage embedding
4. vector row is upserted as derived state
```

If steps 2-4 fail, canonical ingest remains successful and lexical recall remains available.

A later semantic rebuild can repair missing derived rows.

For full rebuild:

1. take a consistent canonical snapshot;
2. derive deterministic passage documents;
3. embed them outside the canonical write transaction;
4. atomically replace the rows for the exact model ID/revision;
5. leave canonical truth untouched if embedding generation fails.

## Scope and eligibility before semantic ranking

Semantic ranking must never start from the entire unfiltered memory store.

The engine exposes only candidates that already satisfy the same correctness eligibility rules used by current recall.

Order:

```text
project
  -> branch
    -> current/historical mode
      -> lifecycle eligibility
        -> repository freshness
          -> relevance ranking
```

A high semantic score cannot revive:

- another project's memory;
- another branch's current claim;
- a superseded or rejected claim in current mode;
- stale repository evidence;
- an expired claim;
- action approval text as current project truth.

Historical mode remains explicitly historical and may retrieve historical states according to the existing contract.

## Hybrid retrieval flow

For one recall:

1. resolve project/branch/mode/revision eligibility;
2. run lexical retrieval for the top 32 eligible candidates;
3. embed the query;
4. load eligible semantic rows for the exact model ID/revision;
5. compute cosine similarity as a dot product over normalized vectors;
6. sort semantic candidates deterministically and keep the top 32;
7. fuse lexical and semantic ranks with RRF;
8. materialize fused IDs through the engine's correctness-safe recall path;
9. preserve applicable conflict edges;
10. apply final item and byte budgets;
11. apply reliance separately when requested by the caller.

Semantic retrieval is brute-force over the eligible scoped vectors in the first version.

At the current expected scale, this avoids a vector database and keeps the index replaceable. ANN indexing is considered only after a measured performance problem exists.

## Reciprocal Rank Fusion

Use deterministic RRF with:

```text
score(id) =
  lexical_present  ? 1 / (60 + lexical_rank)  : 0
  +
  semantic_present ? 1 / (60 + semantic_rank) : 0
```

Ranks are 1-based.

Final ordering:

1. RRF score descending;
2. claim creation time descending;
3. claim ID ascending.

The constant `60` is fixed in the first version. It is not tuned per query.

No authority or trust score is added to RRF.

## Output budgets

Hybrid recall makes the existing M14 limits explicit engine behavior:

- `maxItems <= 10`;
- `maxSerializedBytes <= 16384`.

The final result is built in fused-rank order.

If the byte budget would be exceeded, lowest-ranked result items are removed until the serialized response fits.

Conflict safety must survive trimming:

- a retained claim must still expose any known applicable conflict edge;
- a missing conflict counterpart must remain identifiable as not retrieved;
- reliance must continue to fail closed rather than treating trimming as conflict resolution.

The budget applies to the raw recall payload, not just evidence text.

## Fallback behavior

Semantic retrieval is a relevance enhancement, not a correctness dependency.

Fallback to lexical-only recall when:

- no embedder is configured;
- the local model cache is unavailable;
- query embedding fails;
- no compatible vector rows exist;
- some claims are not yet semantically indexed.

A semantic failure must not produce an empty answer when lexical recall can still answer.

The response may expose diagnostic metadata such as semantic availability, but callers must not need it for correctness.

## Public API compatibility

The existing synchronous `MemoryEngine.recall(...)` remains unchanged for existing consumers.

The new asynchronous wrapper owns hybrid behavior:

```js
const hybrid = new HybridMemoryRetriever({
  memory,
  embedder,
});

const result = await hybrid.recall({
  projectId,
  branch,
  revisionSha,
  query,
  mode: 'current',
  maxItems: 10,
  maxSerializedBytes: 16384,
});
```

The wrapper uses narrowly scoped engine methods for:

- obtaining correctness-filtered semantic candidates;
- reading canonical embedding documents;
- writing/replacing derived vectors;
- materializing fused claim IDs safely.

Those engine methods must not expose a route that bypasses project/branch/freshness/lifecycle filtering.

## Rebuild and export behavior

Canonical export remains unchanged and excludes `claim_embeddings`.

Canonical import restores canonical truth and the lexical index exactly as today.

Semantic rebuild is an explicit asynchronous follow-up step because model inference must not become part of the synchronous canonical import transaction.

Therefore:

- M13 canonical semantics remain valid immediately after import;
- lexical recall remains immediately available;
- hybrid recall falls back safely until semantic rebuild completes;
- rebuilding embeddings never changes canonical rows.

## Security and privacy

The model runs locally.

Normal recall performs no network requests.

The model receives only already-redacted canonical passage text and the user's recall query.

No approval capabilities, hidden trust labels, or unredacted raw sources are embedded.

Remote model access is allowed only in the explicit model-cache preparation command.

The provider verifies exact model ID and revision before use.

## Testing strategy

### Core tests

Use a deterministic fake embedder to prove:

- semantic-only candidates can enter the fused top results;
- lexical-only candidates remain available;
- RRF ordering is deterministic;
- wrong-project candidates cannot surface even with maximal semantic similarity;
- wrong-branch candidates cannot surface;
- stale repository claims cannot surface in current mode;
- superseded/rejected claims cannot surface in current mode;
- historical mode preserves its existing semantics;
- unresolved conflicts remain visible and reliance remains fail-closed;
- missing semantic rows fall back to lexical retrieval;
- semantic provider failure falls back to lexical retrieval;
- embeddings are excluded from canonical export;
- derived clearing removes semantic rows;
- final results obey both item and byte budgets.

### Existing ratchet

M01-M15 must remain green without weakening any current assertion.

### Real-model semantic evaluation

The E5 provider must pass a focused retrieval eval using the real pinned model.

At minimum:

1. original M14 database query remains top five;
2. English paraphrase "storage engine ... multiple processes writing at once" returns the Postgres decision in the top five;
3. German paraphrase "Welche Datenbank ... paralleler Schreibzugriffe" returns the Postgres decision in the top five;
4. "For how long do we preserve security event records?" returns the audit-retention decision in the top five;
5. item count remains at most 10;
6. serialized recall payload remains at most 16 KiB.

The eval records lexical rank, semantic rank, and fused rank so future provider/model changes can be compared.

## Performance policy

The first implementation uses brute-force cosine scoring because it is the simplest correct design and avoids a vector database.

Performance is measured after correctness.

A vector/ANN dependency is justified only if a reproducible benchmark on realistic scoped memory shows brute-force semantic scoring is materially too slow.

Likewise, a smaller quantized model is adopted only if a parity benchmark shows that the required semantic eval remains equivalent enough while materially improving startup, disk, or inference cost.

## Failure behavior

Failures are isolated by layer:

- canonical SQLite failure: existing transaction rules apply;
- lexical index failure: existing derived rebuild path applies;
- passage embedding failure: canonical ingest remains committed;
- semantic row write failure: lexical recall remains available;
- query embedding failure: lexical fallback;
- corrupt/mismatched vector dimensions: row is ignored and marked for rebuild;
- model revision mismatch: old vectors are not reused;
- model cache missing: no implicit download, lexical fallback.

No semantic error changes authority, approval, or lifecycle state.

## Alternatives considered

### Lexical synonym expansion

Rejected as the primary solution.

A synonym dictionary would require ongoing domain curation, performs poorly across languages, and does not generalize to arbitrary paraphrases.

### Quantized converted E5 artifact first

Deferred.

Smaller ONNX variants exist on later model revisions, but the initial implementation uses the exact researched revision. A later optimization may switch only after explicit semantic parity evidence.

### Vector database or ANN index

Rejected for the first version.

It adds persistence and operational complexity before a scale problem has been measured.

### Model reranker

Rejected.

RRF is deterministic, local, explainable, and already supported by the architecture research. A learned reranker is unnecessary for the current goal.

### Replacing FTS5 with embeddings

Rejected.

Lexical retrieval is fast, deterministic, excellent for exact identifiers and code terms, and already satisfies M14. Semantic retrieval complements it rather than replacing it.

## Delivery sequence

### PR A: hybrid core

Implement:

- semantic derived table;
- embedding document helpers;
- correctness-filtered semantic candidate API;
- `HybridMemoryRetriever`;
- deterministic RRF;
- item and serialized-byte budget enforcement;
- fake embedder regression suite;
- existing M01-M15 verification.

No external ML dependency.

### PR B: pinned E5 provider

Implement:

- exact `@huggingface/transformers@4.3.0` dependency;
- official E5 model/revision constants;
- CPU/WASM provider;
- explicit cache preparation;
- offline runtime mode;
- real-model semantic eval;
- provider documentation and verification.

### Later optimization only if measured

Possible follow-up:

- quantized ONNX artifact after parity benchmark;
- ANN/vector index after performance benchmark.

Neither is part of the initial hybrid implementation.

## Acceptance criteria

The design is complete when:

- the existing canonical engine remains valid without a semantic provider;
- semantic relevance can recover lexical-light and multilingual paraphrases;
- FTS and semantic results fuse deterministically via RRF;
- every correctness boundary is applied before semantic ranking and rechecked during materialization;
- canonical export/import remains embedding-free;
- semantic indexes are rebuildable derived state;
- normal recall is offline after explicit cache preparation;
- no remote model download occurs implicitly;
- final recall enforces <=10 items and <=16 KiB;
- M01-M15 remain green;
- the real E5 paraphrase eval passes the listed top-five requirements.

## References

- Memory Ratchet synthesis: `tests/memory-ratchet/results/SYNTHESIS.md`
- Hindsight evaluation: `tests/memory-ratchet/results/hindsight-0.10.1.md`
- Hugging Face model: https://huggingface.co/intfloat/multilingual-e5-small
- Pinned ONNX revision: https://huggingface.co/intfloat/multilingual-e5-small/tree/fd1525a9fd15316a2d503bf26ab031a61d056e98/onnx
- Transformers.js server-side Node documentation: https://huggingface.co/docs/transformers.js/en/tutorials/node
