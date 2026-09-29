# Hybrid Memory Retrieval Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dependency-free semantic-vector storage, correctness-safe candidate materialization, deterministic RRF fusion, and bounded hybrid recall while keeping the canonical memory engine valid without any ML runtime.

**Architecture:** `MemoryEngine` remains the synchronous canonical correctness core. A new `HybridMemoryRetriever` composes lexical recall with an injected async embedder, uses derived SQLite vector rows for semantic ranking, then materializes fused IDs through correctness-safe engine APIs and enforces item/byte budgets.

**Tech Stack:** Node.js 24+, built-in `node:sqlite`, built-in `node:crypto`, ESM, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-29-memory-engine-hybrid-retrieval-design.md`

## Global Constraints

- No external ML dependency in this plan.
- `MemoryEngine.recall(...)` remains available and synchronous.
- Embeddings are derived state and are excluded from canonical export/import.
- Semantic ranking never changes project scope, branch scope, freshness, lifecycle, conflicts, authority, reliance, or action approval semantics.
- RRF uses `k = 60`, lexical top 32, semantic top 32.
- Hybrid output enforces `maxItems <= 10` and `maxSerializedBytes <= 16384`.
- Existing M01-M15 tests must remain green.
- Canonical ingest must succeed even when semantic indexing is unavailable.
- No vector database, ANN index, model reranker, autonomous summarization, reflection, or background consolidation.

## Review Focus

- Vector rows with the correct claim ID but the wrong model revision must be ignored; Task 1 adds an exact model/revision compatibility test.
- Semantic candidates with maximal similarity but stale/wrong-project/wrong-branch/superseded state must not surface; Task 2 adds one test per correctness boundary.
- Result trimming must not silently erase an unresolved conflict; Task 3 adds a byte-budget/conflict fail-closed test.
- Query embedding failure or a partially built semantic index must still return lexical results; Task 4 adds provider-failure and missing-row fallback tests.
- Rebuild/clear/export flows must never turn embeddings into canonical truth; Task 5 adds derived-state lifecycle and M13/M15 regression coverage.

---

### Task 1: Derived Semantic Vector Store

**Files:**
- Create: `memory-engine/semantic-vectors.mjs`
- Modify: `memory-engine/index.mjs:1-25`
- Modify: `memory-engine/index.mjs:390-490`
- Modify: `memory-engine/index.mjs:575-705`
- Modify: `memory-engine/index.mjs:1040-1095`
- Test: `tests/memory-engine/semantic-vectors.test.mjs`
- Test: `tests/memory-engine/portable-export.test.mjs`

**Interfaces:**
- Produces: `hashEmbeddingText(text: string) -> string` returning lowercase SHA-256 hex.
- Produces: `encodeFloat32Vector(vector: Float32Array) -> Buffer`.
- Produces: `decodeFloat32Vector(blob: Buffer, dimensions: number) -> Float32Array`.
- Produces on `MemoryEngine`: `putClaimEmbedding({ claimId, modelId, modelRevision, textHash, dimensions, vector, indexedAt? }) -> object`.
- Produces on `MemoryEngine`: `deleteClaimEmbeddings({ modelId?, modelRevision? } = {}) -> number`.
- Produces on `MemoryEngine`: `getClaimEmbedding({ claimId, modelId, modelRevision }) -> object | null`.
- Later tasks consume these exact names.

- [ ] **Step 1: Write failing vector codec tests**

Add tests asserting:

```js
const vector = new Float32Array([0.25, -0.5, 1]);
const blob = encodeFloat32Vector(vector);
assert.deepEqual([...decodeFloat32Vector(blob, 3)], [...vector]);
assert.equal(hashEmbeddingText('passage: hello'), '<known sha256>');
assert.throws(() => decodeFloat32Vector(blob, 2), /dimension/i);
```

Also assert non-`Float32Array`, empty vectors, non-finite values, and byte-length mismatch fail closed.

- [ ] **Step 2: Run the codec test and verify RED**

Run:

```bash
node --test tests/memory-engine/semantic-vectors.test.mjs
```

Expected: FAIL because `memory-engine/semantic-vectors.mjs` does not exist.

- [ ] **Step 3: Implement the pure vector codec**

Create `memory-engine/semantic-vectors.mjs` with the three exact exports from the Interfaces block.

Use native little-endian Float32 representation and validate every element with `Number.isFinite`.

- [ ] **Step 4: Run the codec test and verify GREEN**

Run:

```bash
node --test tests/memory-engine/semantic-vectors.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Write failing derived-schema tests**

Add tests that create a normal engine/claim, call `putClaimEmbedding(...)`, and assert:

```js
assert.deepEqual([...stored.vector], [...vector]);
assert.equal(stored.model_id, 'fake-e5');
assert.equal(stored.model_revision, 'rev-1');
assert.equal(stored.dimensions, 3);
```

Add a second vector for the same claim with `model_revision: 'rev-2'`; exact `rev-1` lookup must still return only `rev-1`.

Assert vector dimensions and `textHash` are validated.

- [ ] **Step 6: Run the derived-schema test and verify RED**

Run the semantic-vector test file again.

Expected: FAIL because the engine methods/table do not exist.

- [ ] **Step 7: Add the derived `claim_embeddings` table and engine methods**

In `MemoryEngine` schema, add a STRICT table with:

```text
claim_id        TEXT NOT NULL REFERENCES claims(id)
model_id        TEXT NOT NULL
model_revision  TEXT NOT NULL
text_hash       TEXT NOT NULL
dimensions      INTEGER NOT NULL CHECK (dimensions > 0)
vector_blob     BLOB NOT NULL
indexed_at      TEXT NOT NULL
PRIMARY KEY (claim_id, model_id, model_revision)
```

Implement the exact methods from Interfaces.

`putClaimEmbedding` must confirm the claim exists, vector length equals `dimensions`, and `textHash` is a 64-character lowercase hex SHA-256 string.

- [ ] **Step 8: Prove embeddings stay derived**

Extend `portable-export.test.mjs` and semantic-vector tests to assert:

```js
assert.equal(Object.hasOwn(engine.exportCanonical(), 'claim_embeddings'), false);
engine.clearDerivedState();
assert.equal(engine.getClaimEmbedding({ claimId, modelId, modelRevision }), null);
```

Also assert `importCanonical(...)` does not recreate semantic rows.

- [ ] **Step 9: Update all derived-state clear/rebuild paths**

Modify `clearDerivedState()` and canonical import/rebuild flows so semantic rows are deleted, never exported, and never regenerated synchronously.

Do not add model inference to `rebuildDerivedState()`.

- [ ] **Step 10: Run focused tests**

Run:

```bash
node --test tests/memory-engine/semantic-vectors.test.mjs tests/memory-engine/portable-export.test.mjs
```

Expected: PASS.

- [ ] **Step 11: Commit Task 1**

```bash
git add memory-engine/semantic-vectors.mjs memory-engine/index.mjs tests/memory-engine/semantic-vectors.test.mjs tests/memory-engine/portable-export.test.mjs
git commit -m "feat: add derived semantic vector storage"
```

### Task 2: Correctness-Safe Semantic Candidate and Materialization APIs

**Files:**
- Modify: `memory-engine/index.mjs:1640-1780`
- Test: `tests/memory-engine/hybrid-retrieval.test.mjs`
- Test: `tests/memory-engine/git-freshness.test.mjs`
- Test: `tests/memory-engine/authority-reliance.test.mjs`

**Interfaces:**
- Consumes: Task 1 vector rows.
- Produces on `MemoryEngine`: `embeddingDocument({ claimId }) -> { claim_id, project_id, branch_scope, created_at, text, text_hash } | null`.
- Produces on `MemoryEngine`: `listEmbeddingDocuments({ projectId, branch }) -> Array<EmbeddingDocument>` for all canonical claims in that branch, including historical states.
- Produces on `MemoryEngine`: `semanticCandidates({ projectId, branch, revisionSha?, mode?, modelId, modelRevision }) -> Array<{ claim_id, created_at, text_hash, dimensions, vector }>`.
- Produces on `MemoryEngine`: `materializeRecall({ projectId, branch, revisionSha?, mode?, claimIds }) -> { items, conflicts }`.
- Task 4 consumes these exact names.

- [ ] **Step 1: Write failing embedding-document tests**

Create `tests/memory-engine/hybrid-retrieval.test.mjs`.

Assert `embeddingDocument({ claimId })` builds exactly:

```text
passage: <kind> <subject> <predicate> <claim value> <redacted evidence content>
```

with collapsed whitespace, and that `text_hash` equals `hashEmbeddingText(text)`.

Use evidence containing a redacted secret marker and assert no original secret reaches the document.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/memory-engine/hybrid-retrieval.test.mjs
```

Expected: FAIL because the semantic document API does not exist.

- [ ] **Step 3: Implement embedding-document methods**

Add `embeddingDocument` and `listEmbeddingDocuments`.

These APIs are for index construction, not recall authority. They may expose historical claims but must only use already-redacted canonical evidence.

Sort `listEmbeddingDocuments` by claim ID for deterministic rebuild input.

- [ ] **Step 4: Write failing semantic eligibility tests**

Build fixtures containing:

- same semantic vector in project A and project B;
- same semantic vector on `main` and a feature branch;
- active and superseded claims;
- fresh and stale repository claims;
- an approval claim in candidate state.

Assert `semanticCandidates(... mode: 'current')` returns only current-eligible rows for the requested project/branch/revision.

Assert `mode: 'historical'` preserves the existing historical semantics.

- [ ] **Step 5: Implement `semanticCandidates` using the same eligibility rules as recall**

Do not duplicate a weaker filter.

Refactor the existing current/historical eligibility predicate into a private engine helper if needed, and make both lexical recall and semantic candidate selection use it.

Exact model ID and model revision must match.

Rows with corrupt blob length or dimensions must be skipped, not returned.

- [ ] **Step 6: Write failing ordered materialization tests**

Call:

```js
engine.materializeRecall({
  projectId: 'project-a',
  branch: 'main',
  revisionSha,
  mode: 'current',
  claimIds: ['claim-b', 'claim-a'],
});
```

Assert output preserves the supplied eligible order, drops IDs that are no longer eligible, and returns the same normalized item shape as `recall(...)`.

Add an unresolved conflict where only one side is in `claimIds`; the returned conflict edge must remain visible so `evaluateReliance(...)` fails closed.

- [ ] **Step 7: Implement `materializeRecall`**

Recheck project, branch, mode, lifecycle, and repository freshness while materializing IDs.

Never trust a fused ID list as proof of eligibility.

Reuse the existing conflict-discovery semantics, including counterpart-not-retrieved behavior.

- [ ] **Step 8: Run correctness-focused tests**

Run:

```bash
node --test tests/memory-engine/hybrid-retrieval.test.mjs tests/memory-engine/git-freshness.test.mjs tests/memory-engine/authority-reliance.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add memory-engine/index.mjs tests/memory-engine/hybrid-retrieval.test.mjs tests/memory-engine/git-freshness.test.mjs tests/memory-engine/authority-reliance.test.mjs
git commit -m "feat: expose correctness-safe semantic candidates"
```

### Task 3: Deterministic RRF and Recall Budgeting

**Files:**
- Create: `memory-engine/hybrid-retrieval.mjs`
- Modify: `tests/memory-engine/hybrid-retrieval.test.mjs`

**Interfaces:**
- Consumes: claim IDs and creation timestamps from Task 2.
- Produces: `reciprocalRankFuse({ lexicalIds, semanticIds, createdAtById, k? }) -> string[]`.
- Produces: `enforceRecallBudget(result, { maxItems, maxSerializedBytes }) -> { items, conflicts }`.
- Task 4 consumes these exact exports.

- [ ] **Step 1: Write failing RRF tests**

Assert:

```js
assert.deepEqual(
  reciprocalRankFuse({
    lexicalIds: ['a', 'b'],
    semanticIds: ['b', 'c'],
    createdAtById: new Map([
      ['a', '2026-01-01T00:00:00Z'],
      ['b', '2026-01-02T00:00:00Z'],
      ['c', '2026-01-03T00:00:00Z'],
    ]),
  }),
  ['b', 'a', 'c'],
);
```

Add a tie case proving ordering is creation time descending then claim ID ascending.

Assert default `k` is exactly `60`.

- [ ] **Step 2: Run test and verify RED**

Run the hybrid-retrieval test.

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement deterministic RRF**

Create `memory-engine/hybrid-retrieval.mjs`.

Use 1-based ranks and:

```text
score = lexical? 1/(60+rank) : 0
      + semantic? 1/(60+rank) : 0
```

Do not include authority, freshness, or lifecycle in the score.

- [ ] **Step 4: Write failing budget tests**

Construct a result with >10 items and a serialized size >16 KiB.

Assert:

```js
const bounded = enforceRecallBudget(result, {
  maxItems: 10,
  maxSerializedBytes: 16_384,
});
assert.ok(bounded.items.length <= 10);
assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= 16_384);
```

Add a conflict where retained claim A conflicts with non-retained claim B. The applicable conflict edge must remain until A itself is trimmed.

- [ ] **Step 5: Implement budget enforcement**

Validate integer `maxItems` in `1..10` and integer `maxSerializedBytes` in `1..16384`.

Trim lowest-ranked items until both caps pass.

Retain only conflicts connected to at least one retained item; preserve the counterpart ID even when its item is absent.

- [ ] **Step 6: Run the focused test**

Run:

```bash
node --test tests/memory-engine/hybrid-retrieval.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add memory-engine/hybrid-retrieval.mjs tests/memory-engine/hybrid-retrieval.test.mjs
git commit -m "feat: add deterministic hybrid fusion budgets"
```

### Task 4: Hybrid Retriever, Semantic Indexing, and Lexical Fallback

**Files:**
- Modify: `memory-engine/hybrid-retrieval.mjs`
- Modify: `tests/memory-engine/hybrid-retrieval.test.mjs`

**Interfaces:**
- Consumes: Task 1 engine vector methods, Task 2 candidate/materialization methods, Task 3 RRF/budget helpers.
- Produces: `class HybridMemoryRetriever`.
- Constructor: `new HybridMemoryRetriever({ memory, embedder = null, lexicalCandidateLimit = 32, semanticCandidateLimit = 32 })`.
- Produces method: `indexClaim(claimId: string) -> Promise<{ indexed: boolean, reason?: string }>`.
- Produces method: `rebuildSemanticIndex({ projectId, branch }) -> Promise<{ indexed: number, failed: number }>`.
- Produces method: `recall({ projectId, branch, revisionSha?, query, mode?, maxItems?, maxSerializedBytes? }) -> Promise<{ items, conflicts }>`.
- Embedder contract consumed: `{ modelId, modelRevision, dimensions, embedQuery(text), embedPassages(texts) }`.

- [ ] **Step 1: Add a deterministic fake embedder to the test file**

The fake must:

- expose fixed `modelId`, `modelRevision`, `dimensions`;
- accept the raw query in `embedQuery(text)` and already-deterministic passage text in `embedPassages(texts)`;
- return normalized `Float32Array` values;
- map one lexical-light paraphrase to the same vector as the Postgres passage;
- allow forced query and passage failures.

- [ ] **Step 2: Write failing semantic indexing tests**

Assert `indexClaim`:

- builds the passage from `embeddingDocument`;
- calls `embedPassages([text])`;
- persists the exact model/revision/text hash/vector;
- returns `{ indexed: false, reason: 'no_embedder' }` when no embedder exists;
- never changes the canonical claim if embedding throws.

Assert `rebuildSemanticIndex` deletes only rows for the current model ID/revision and rebuilds deterministic branch documents.

- [ ] **Step 3: Implement embedder validation and indexing methods**

Validate model ID/revision as non-empty strings and dimensions as a positive integer.

Validate every returned vector length and finite values before storing.

Do not wrap canonical ingest in semantic work.

- [ ] **Step 4: Write failing hybrid recall tests**

Create a corpus where the lexical query has no token overlap with the Postgres claim, but the fake semantic vector ranks Postgres first.

Assert `HybridMemoryRetriever.recall(...)` returns Postgres.

Also assert:

- lexical exact-identifier result remains present even if semantic list omits it;
- semantic top 32 and lexical top 32 are the only lists passed to RRF;
- wrong-project/branch/stale/superseded vectors cannot surface;
- final materialization order matches fused order.

- [ ] **Step 5: Implement hybrid recall**

Flow:

1. call `memory.recall(... limit: 32)`;
2. if no embedder, bound and return lexical result;
3. call `embedder.embedQuery(query)` with the raw query; the embedder owns the exact `query: ` prefix;
4. load correctness-filtered semantic candidates for exact model/revision;
5. dot-product normalized query vector against normalized stored vectors;
6. sort semantic candidates by similarity descending, then creation time descending, then claim ID ascending;
7. keep top 32;
8. RRF lexical + semantic IDs;
9. `materializeRecall` fused IDs;
10. `enforceRecallBudget`.

- [ ] **Step 6: Write fallback tests**

Assert lexical-only result is returned when:

- no embedder configured;
- `embedQuery` throws;
- no compatible semantic rows exist;
- only some claims have semantic rows.

A semantic failure must never convert a lexical hit into an empty result.

- [ ] **Step 7: Run hybrid tests**

Run:

```bash
node --test tests/memory-engine/hybrid-retrieval.test.mjs tests/memory-engine/semantic-vectors.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add memory-engine/hybrid-retrieval.mjs tests/memory-engine/hybrid-retrieval.test.mjs
git commit -m "feat: add hybrid memory retriever"
```

### Task 5: Full Regression, Ratchet Preservation, and Documentation

**Files:**
- Modify: `memory-engine/README.md`
- Modify: `tests/memory-engine/ratchet-bounded-recall.test.mjs`
- Test: all `tests/memory-engine/*.test.mjs`

**Interfaces:**
- Consumes: complete dependency-free hybrid core.
- Produces no new runtime API.

- [ ] **Step 1: Extend M14-adjacent coverage without changing the frozen Ratchet fixture**

Keep the existing lexical M14 assertions.

Add a separate fake-embedder hybrid test proving:

- lexical-light paraphrase retrieves the Postgres decision in the top five;
- multilingual-like query can be represented semantically by the injected embedder;
- item count remains <=10;
- serialized hybrid payload remains <=16 KiB.

Do not alter `tests/memory-ratchet/cases.json` or frozen fixture semantics.

- [ ] **Step 2: Run all memory-engine tests**

Run:

```bash
node --test tests/memory-engine/*.test.mjs
```

Expected: every existing M01-M15 regression plus new hybrid tests PASS.

- [ ] **Step 3: Update README**

Document:

- hybrid core architecture;
- semantic embedder interface;
- embeddings as derived state;
- RRF constant and candidate limits;
- lexical fallback;
- item/byte caps;
- no ML dependency yet;
- E5 provider remains PR B.

Remove the statement that local embeddings/RRF are entirely unimplemented; replace it with a note that the provider is the remaining piece.

- [ ] **Step 4: Run export/recovery-focused regression again**

Run:

```bash
node --test tests/memory-engine/portable-export.test.mjs tests/memory-engine/ratchet-portable-export.test.mjs tests/memory-engine/ratchet-failure-recovery.test.mjs
```

Expected: PASS, proving vectors are still derived and rebuildable.

- [ ] **Step 5: Commit Task 5**

```bash
git add memory-engine/README.md tests/memory-engine/ratchet-bounded-recall.test.mjs
git commit -m "docs: document hybrid retrieval core"
```

- [ ] **Step 6: Final PR A verification**

Run:

```bash
node --test tests/memory-engine/*.test.mjs
git diff --check
```

Expected: all tests PASS and no whitespace errors.

Open a PR from a fresh branch based on then-current `main`; the PR must contain only PR A implementation commits and must be zero commits behind `main` before merge.
