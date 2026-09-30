# Pinned E5 Memory Embedder Implementation Plan

**Execution status:** completed by PR #14 (`feat: add pinned offline E5 memory provider`) and merged as `a4081fb0c765acb993ff08d7a13ec254082980c4`.

**Later measured optimization:** PR #16 (`perf: use measured qint8 E5 provider`) replaced the initial fp32 graph with the official qint8 graph after explicit semantic-parity and performance verification. The fp32/no-quantization constraints below are retained as the original implementation plan, not the current provider contract.

The unchecked task boxes below are retained as the original execution plan and are not a live work queue.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the exact researched multilingual E5 provider, explicit model-cache preparation, and a real semantic retrieval evaluation on top of the already-merged dependency-free hybrid core.

**Architecture:** The provider is an isolated adapter implementing the embedder contract from PR A. Normal runtime is local-files-only and CPU-backed; model download is allowed only through an explicit cache-preparation command. The real-model evaluation is a separate manual workflow so ordinary recall and ordinary PR tests do not download a ~470 MB model.

**Tech Stack:** Node.js 24+, `@huggingface/transformers@4.3.0`, ONNX Runtime Node through Transformers.js, ESM, Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-29-memory-engine-hybrid-retrieval-design.md`

**Depends on:** `docs/superpowers/plans/2026-09-29-memory-engine-hybrid-core.md` fully implemented and merged.

## Global Constraints

- Exact package version: `@huggingface/transformers@4.3.0`.
- Exact model ID: `intfloat/multilingual-e5-small`.
- Exact model revision: `fd1525a9fd15316a2d503bf26ab031a61d056e98`.
- Exact embedding dimensions: `384`.
- First provider uses full-precision `fp32`; no quantized/converted artifact in this plan.
- First provider forces CPU execution.
- Feature extraction uses mean pooling and normalized embeddings.
- Normal provider initialization uses local files only; no implicit remote download.
- Explicit cache preparation is the only code path allowed to set `local_files_only: false`.
- Model files are stored below the already-ignored `.cache/` tree and are never committed.
- Existing M01-M15 and PR A hybrid-core tests remain green.
- No vector database, ANN index, GPU/WebGPU requirement, or learned reranker.

## Review Focus

- A missing model cache must fail provider initialization cleanly without causing the hybrid retriever to lose lexical results; Task 1 and Task 4 test this.
- Model revision drift must not silently reuse another revision's cache/vectors; Task 1 pins and asserts the exact revision passed to `pipeline`.
- E5 query/passage prefixes must not be omitted or doubled; Task 1 tests exact extractor inputs.
- Normal CI/runtime must not download model files; Task 2 tests `local_files_only: true` by default and Task 3 keeps download in a manual workflow.
- A future Transformers.js upgrade must not silently change the provider contract; Task 1 pins the package and Task 3 runs provider unit tests under Node 24 on every normal verification run.

---

### Task 1: Scoped Package and Offline E5 Provider

**Files:**
- Create: `memory-engine/package.json`
- Create: `memory-engine/package-lock.json`
- Create: `memory-engine/e5-embedder.mjs`
- Create: `tests/memory-engine/e5-embedder.test.mjs`

**Interfaces:**
- Consumes from PR A: embedder contract `{ modelId, modelRevision, dimensions, embedQuery(text), embedPassages(texts) }`.
- Produces constants: `E5_MODEL_ID`, `E5_MODEL_REVISION`, `E5_DIMENSIONS`.
- Produces: `createE5Embedder({ cacheDir, allowRemoteModels = false, pipelineFactory? }) -> Promise<Embedder>`.
- The returned embedder implements exactly the PR A contract.
- Task 2 cache preparation and Task 4 real eval consume this factory.

- [ ] **Step 1: Add the scoped package manifest with exact dependency**

Create `memory-engine/package.json`:

```json
{
  "name": "@agent-hub/memory-engine",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "dependencies": {
    "@huggingface/transformers": "4.3.0"
  }
}
```

Generate and commit `memory-engine/package-lock.json` with the dependency resolved exactly.

Run:

```bash
npm install --package-lock-only --prefix memory-engine
npm ci --prefix memory-engine
```

Expected: install succeeds under Node 24.

- [ ] **Step 2: Write failing provider-construction tests with an injected pipeline factory**

The fake `pipelineFactory` must capture:

```js
task === 'feature-extraction'
model === 'intfloat/multilingual-e5-small'
options.revision === 'fd1525a9fd15316a2d503bf26ab031a61d056e98'
options.cache_dir === cacheDir
options.local_files_only === true
options.dtype === 'fp32'
options.device === 'cpu'
```

Also assert `allowRemoteModels: true` changes only `local_files_only` to `false`.

- [ ] **Step 3: Run provider unit test and verify RED**

Run:

```bash
node --test tests/memory-engine/e5-embedder.test.mjs
```

Expected: FAIL because `e5-embedder.mjs` does not exist.

- [ ] **Step 4: Implement `createE5Embedder`**

Use:

```text
pipeline(
  'feature-extraction',
  E5_MODEL_ID,
  {
    revision: E5_MODEL_REVISION,
    cache_dir: cacheDir,
    local_files_only: !allowRemoteModels,
    dtype: 'fp32',
    device: 'cpu'
  }
)
```

Do not mutate global Transformers.js environment to enable remote models.

`cacheDir` is required and must be a non-empty path string.

- [ ] **Step 5: Write failing prefix/pooling/normalization tests**

The injected extractor records calls.

Assert:

```js
await embedder.embedQuery('Which storage engine?');
// extractor receives "query: Which storage engine?"

await embedder.embedPassages([
  'passage: database decision Postgres',
  'plain passage text',
]);
// extractor receives:
// "passage: database decision Postgres"
// "passage: plain passage text"
```

Every extractor call uses:

```js
{ pooling: 'mean', normalize: true }
```

This exact contract prevents omitted or doubled E5 prefixes.

- [ ] **Step 6: Implement query/passage extraction and tensor validation**

`embedQuery(rawText)` adds exactly one `query: ` prefix.

`embedPassages(texts)` preserves an existing `passage: ` prefix and adds it only when absent.

Convert returned tensor data into independent `Float32Array` vectors.

Validate:

- tensor final dimension is exactly 384;
- output count equals input count;
- every value is finite.

Throw on shape mismatch.

- [ ] **Step 7: Add provider failure tests**

Assert:

- pipeline initialization error rejects `createE5Embedder`;
- wrong 383/385-dimension output rejects;
- NaN/Infinity output rejects;
- empty query/passage input rejects.

- [ ] **Step 8: Run provider tests**

Run:

```bash
node --test tests/memory-engine/e5-embedder.test.mjs
```

Expected: PASS without downloading any model because the test injects a fake pipeline.

- [ ] **Step 9: Commit Task 1**

```bash
git add memory-engine/package.json memory-engine/package-lock.json memory-engine/e5-embedder.mjs tests/memory-engine/e5-embedder.test.mjs
git commit -m "feat: add pinned offline e5 embedder"
```

### Task 2: Explicit Model Cache Preparation

**Files:**
- Create: `scripts/prepare-memory-embedding-model.mjs`
- Modify: `tests/memory-engine/e5-embedder.test.mjs`
- Modify: `memory-engine/README.md`

**Interfaces:**
- Consumes: `createE5Embedder` from Task 1.
- Produces CLI: `node scripts/prepare-memory-embedding-model.mjs --cache-dir <path>`.
- CLI exits 0 only after the exact model/revision can produce a 384-dimensional normalized embedding.

- [ ] **Step 1: Write failing CLI argument tests**

Extract a pure exported parser:

```js
parsePrepareModelArgs(argv) -> { cacheDir }
```

Assert:

- missing `--cache-dir` fails;
- duplicate/empty cache path fails;
- valid path is returned unchanged.

Keep remote permission implicit in this command; do not add a general `--allow-remote` runtime flag.

- [ ] **Step 2: Implement the preparation command**

The CLI:

1. resolves the cache path;
2. creates the directory if needed;
3. calls `createE5Embedder({ cacheDir, allowRemoteModels: true })`;
4. calls `embedQuery('memory cache readiness probe')`;
5. verifies dimension 384;
6. prints model ID, revision, dimensions, and cache path;
7. exits non-zero on any failure.

This is the only repository command allowed to enable remote model loading.

- [ ] **Step 3: Add an offline reopen unit test**

With an injected factory, simulate:

1. preparation with `allowRemoteModels: true`;
2. normal provider creation with default `allowRemoteModels: false`.

Assert the normal creation passes `local_files_only: true`.

- [ ] **Step 4: Document model preparation and normal offline runtime**

Update `memory-engine/README.md` with:

```bash
npm ci --prefix memory-engine
node scripts/prepare-memory-embedding-model.mjs   --cache-dir .cache/memory-engine/e5
```

Document that normal runtime points `cacheDir` at the same path and never enables remote loading.

- [ ] **Step 5: Run unit tests**

Run:

```bash
node --test tests/memory-engine/e5-embedder.test.mjs
```

Expected: PASS with no real model download.

- [ ] **Step 6: Commit Task 2**

```bash
git add scripts/prepare-memory-embedding-model.mjs tests/memory-engine/e5-embedder.test.mjs memory-engine/README.md
git commit -m "feat: add explicit e5 model cache preparation"
```

### Task 3: CI Dependency Install and Manual Real-Model Evaluation Workflow

**Files:**
- Modify: `.github/workflows/verify-skill-routing.yml:154-160`
- Create: `.github/workflows/memory-semantic-eval.yml`

**Interfaces:**
- Consumes: scoped `memory-engine/package-lock.json`.
- Produces normal verification with provider unit tests but no model download.
- Produces manual workflow `Memory semantic eval` that may populate the pinned cache and run the real provider eval.

- [ ] **Step 1: Update normal Release Governance to install provider package only**

Before `Test memory engine foundation`, add:

```yaml
- name: Install memory engine provider dependencies
  run: npm ci --prefix memory-engine
```

Do not invoke the cache-preparation command in normal Release Governance.

- [ ] **Step 2: Run the normal memory suite locally**

Run:

```bash
npm ci --prefix memory-engine
node --test tests/memory-engine/*.test.mjs
```

Expected: all ordinary tests PASS; real-model semantic eval is skipped unless its cache environment variable is set.

- [ ] **Step 3: Add manual `memory-semantic-eval.yml`**

Trigger:

```yaml
on:
  workflow_dispatch:
```

Steps, in order:

1. checkout;
2. setup Node 24;
3. `npm ci --prefix memory-engine`;
4. restore/cache `.cache/memory-engine/e5` keyed by:
   - OS;
   - `memory-engine/package-lock.json` hash;
   - exact E5 model revision;
5. when cache miss, run:
   `node scripts/prepare-memory-embedding-model.mjs --cache-dir .cache/memory-engine/e5`;
6. run the real semantic eval with:
   `MEMORY_E5_MODEL_CACHE=.cache/memory-engine/e5 node --test tests/memory-engine/e5-semantic-eval.test.mjs`.

The workflow name is exactly `Memory semantic eval`.

- [ ] **Step 4: Check workflow syntax and ordinary governance**

Run repository workflow validation if an existing verifier covers YAML; otherwise inspect with GitHub Actions after push.

Run:

```bash
node --test tests/memory-engine/e5-embedder.test.mjs
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add .github/workflows/verify-skill-routing.yml .github/workflows/memory-semantic-eval.yml
git commit -m "ci: add explicit memory semantic evaluation"
```

### Task 4: Real Pinned-Model Semantic Retrieval Evaluation

**Files:**
- Create: `tests/memory-engine/e5-semantic-eval.test.mjs`
- Modify: `memory-engine/README.md`

**Interfaces:**
- Consumes: merged PR A `HybridMemoryRetriever`, `reciprocalRankFuse`, semantic engine APIs, and Task 1 E5 provider.
- Uses environment variable: `MEMORY_E5_MODEL_CACHE`.
- Produces test output recording lexical rank, semantic rank, and fused rank for each required query.

- [ ] **Step 1: Write the real-model eval with an explicit skip gate**

At module start:

```js
const cacheDir = process.env.MEMORY_E5_MODEL_CACHE;
```

Define the real-model test with `skip: !cacheDir`.

Do not silently download when the variable is absent.

- [ ] **Step 2: Build the focused canonical corpus**

In the test, ingest at minimum:

- SQLite acceptance;
- Postgres superseding decision;
- audit-log retention decision;
- retry policy;
- at least 32 unrelated distractor claims.

Use existing engine APIs and preserve normal lifecycle/source authority semantics.

Construct `HybridMemoryRetriever` with the real E5 embedder, then run `rebuildSemanticIndex`.

- [ ] **Step 3: Evaluate the four required queries**

Required queries:

```text
Which database was selected because concurrent writers are required?
Which storage engine did we choose to handle multiple processes writing at once?
Welche Datenbank haben wir wegen paralleler Schreibzugriffe gewählt?
For how long do we preserve security event records?
```

Assertions:

- first three queries: current Postgres claim fused rank <=5;
- fourth query: audit-retention claim fused rank <=5;
- every hybrid result has <=10 items;
- every serialized result is <=16,384 bytes.

- [ ] **Step 4: Record lexical, semantic, and fused ranks**

For each query, compute and print one JSON line containing:

```json
{
  "query": "...",
  "target_claim_id": "...",
  "lexical_rank": null,
  "semantic_rank": 1,
  "fused_rank": 1
}
```

Use `null` when a target is absent from a candidate list.

This output is evidence for later model/provider parity comparisons.

- [ ] **Step 5: Prove normal runtime is offline**

Create the E5 provider with default `allowRemoteModels: false`.

The test must succeed using only `MEMORY_E5_MODEL_CACHE`.

Do not call the preparation script from the test itself.

- [ ] **Step 6: Run ordinary tests before the expensive eval**

Run:

```bash
npm ci --prefix memory-engine
node --test tests/memory-engine/*.test.mjs
```

Expected: all ordinary tests PASS and the real-model test is SKIP when `MEMORY_E5_MODEL_CACHE` is absent.

- [ ] **Step 7: Run the explicit cache preparation and real eval**

Run:

```bash
node scripts/prepare-memory-embedding-model.mjs   --cache-dir .cache/memory-engine/e5

MEMORY_E5_MODEL_CACHE=.cache/memory-engine/e5   node --test tests/memory-engine/e5-semantic-eval.test.mjs
```

Expected: PASS for all four semantic queries.

This step is allowed to access the network only during cache preparation.

- [ ] **Step 8: Update README with measured provider status**

Document:

- exact package/model/revision/dimensions;
- cache preparation command;
- normal offline behavior;
- the four semantic eval cases;
- no quantized model or ANN index yet.

- [ ] **Step 9: Commit Task 4**

```bash
git add tests/memory-engine/e5-semantic-eval.test.mjs memory-engine/README.md
git commit -m "test: verify pinned e5 semantic retrieval"
```

- [ ] **Step 10: Final PR B verification**

Run:

```bash
npm ci --prefix memory-engine
node --test tests/memory-engine/*.test.mjs
git diff --check
```

Then run the manual `Memory semantic eval` workflow against the PR head and require success before merge.

Before merge:

- PR B must be based on the merged PR A head;
- branch must be zero commits behind current `main`;
- Release Governance must be green;
- Memory semantic eval must be green;
- review threads must be resolved.
