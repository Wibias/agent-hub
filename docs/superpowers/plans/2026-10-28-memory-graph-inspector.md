# Memory Graph Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded read-only Memory Graph and Graph tab to the existing local Memory Console, using canonical Claims plus provenance-labeled semantic similarity relations.

**Architecture:** A new pure/read-only `memory-graph.mjs` builds graph nodes and explicit/inferred edges from the existing `MemoryEngine`. `memory-ui-model.mjs` exposes a browser-safe projection, `scripts/memory-ui.mjs` serves `/api/graph`, and the existing static Memory Console renders the graph. Production recall remains unchanged; only a bounded traversal helper is added for the later shadow-recall phase.

**Tech Stack:** Node.js ESM, built-in SQLite-backed `MemoryEngine`, vanilla browser JavaScript/SVG/CSS, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-28-memory-graph-inspector-design.md`

## Global Constraints

- Read-only graph construction; no canonical DB schema or Memory mutation.
- Scope exactly one project + branch.
- Maximum 500 graph nodes.
- Semantic threshold defaults to `0.82` and maximum inferred neighbors to 3 per node.
- Only compatible embedding model/revision/dimension profiles may be compared.
- Raw embedding vectors must never appear in browser/API payloads.
- Production Recall/Judge authority is unchanged.

## Review Focus

- Mixed embedding profiles must never create cross-profile similarity edges; Task 1 tests this.
- Large scopes must truncate deterministically and report truncation; Task 1 tests this.
- Lifecycle/conflict edges referencing Claims outside the selected branch must be excluded; Task 1 tests this.
- Traversal must not exceed hop/candidate/weight bounds or duplicate nodes; Task 2 tests this.
- Graph UI/API must remain read-only and preserve existing Memory Console security headers/host checks; Task 3 tests endpoint behavior and existing UI tests remain green.

---

### Task 1: Read-only Memory Graph Builder

**Files:**
- Create: `memory-engine/memory-graph.mjs`
- Create: `tests/memory-engine/memory-graph.test.mjs`

**Interfaces:**
- Produces: `buildMemoryGraph(memory, options) -> graph`
- Graph nodes contain browser-safe Claim metadata and no vectors.
- Graph edges use `origin: 'explicit' | 'inferred'` and deterministic IDs.

- [ ] **Step 1: Write failing graph-construction tests**

Cover canonical Claims, lifecycle edges, conflict edges, semantic-similarity edges, embedding-profile isolation, vector non-leakage, deterministic 500-node truncation, and branch scoping.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/memory-engine/memory-graph.test.mjs`
Expected: FAIL because `memory-engine/memory-graph.mjs` does not exist.

- [ ] **Step 3: Implement `buildMemoryGraph(memory, options)`**

Defaults: `maxNodes=500`, `semanticThreshold=0.82`, `maxSemanticNeighbors=3`, `includeSemantic=true`.

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `node --test tests/memory-engine/memory-graph.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(memory): build bounded memory graph"`

### Task 2: Bounded Graph Traversal Foundation

**Files:**
- Modify: `memory-engine/memory-graph.mjs`
- Modify: `tests/memory-engine/memory-graph.test.mjs`

**Interfaces:**
- Consumes: graph returned by `buildMemoryGraph`.
- Produces: `expandMemoryGraph(graph, { anchorIds, maxHops?, maxCandidates?, minWeight? }) -> { anchorIds, claimIds, traversedEdges }`.

- [ ] **Step 1: Write failing traversal tests**

Assert deterministic one-hop expansion, explicit-edge inclusion, inferred-edge minimum weight, cycle/dedup safety, unknown anchors, `maxHops`, and `maxCandidates`.

- [ ] **Step 2: Run focused test and verify RED**

- [ ] **Step 3: Implement minimal bounded traversal**

Defaults: `maxHops=1`, `maxCandidates=8`, `minWeight=0.82`.

- [ ] **Step 4: Run focused test and verify GREEN**

- [ ] **Step 5: Commit**

`git commit -m "feat(memory): add bounded graph expansion"`

### Task 3: Memory Console Graph API

**Files:**
- Modify: `memory-engine/memory-ui-model.mjs`
- Modify: `scripts/memory-ui.mjs`
- Modify: `tests/memory-engine/memory-ui.test.mjs`

**Interfaces:**
- Produces: `memoryUiGraph(memory, { projectId, branch })`.
- Produces GET `/api/graph?projectId=...&branch=...`.

- [ ] **Step 1: Write failing UI-model/API tests**

Assert graph response is scoped, vectors absent, GET-only, and unknown/missing scope returns guarded errors.

- [ ] **Step 2: Run Memory Console tests and verify RED**

Run: `node --test tests/memory-engine/memory-ui.test.mjs`

- [ ] **Step 3: Add model projection and GET endpoint**

Do not alter action endpoints or security policy.

- [ ] **Step 4: Run tests and verify GREEN**

- [ ] **Step 5: Commit**

`git commit -m "feat(memory-ui): expose memory graph endpoint"`

### Task 4: Graph Tab

**Files:**
- Modify: `memory-ui/index.html`
- Modify: `memory-ui/app.js`
- Modify: `memory-ui/styles.css`
- Modify: `tests/memory-engine/memory-ui.test.mjs`

**Interfaces:**
- Consumes `/api/graph`.
- Adds `Graph` to existing view routing without changing default `memories` view.

- [ ] **Step 1: Add failing static/UI contract tests**

Assert Graph tab exists, graph fetch route is wired, explicit/inferred legend exists, and selected-node detail can link back to Memories.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement Graph tab**

Use local SVG only: deterministic initial layout, bounded lightweight relaxation, click/tap selection, search, state/origin filters, neighbor inspector, and no raw vectors.

- [ ] **Step 4: Verify GREEN**

- [ ] **Step 5: Commit**

`git commit -m "feat(memory-ui): add interactive memory graph"`

### Task 5: Regression + Documentation

**Files:**
- Modify: `memory-engine/README.md`
- Modify: `README.md`

- [ ] **Step 1: Run focused suites**

`node --test tests/memory-engine/memory-graph.test.mjs tests/memory-engine/memory-ui.test.mjs`

- [ ] **Step 2: Run full memory-engine foundation**

`node --test tests/memory-engine/*.test.mjs`

- [ ] **Step 3: Document Graph tab and read-only/shadow boundary**

- [ ] **Step 4: Run `git diff --check` and final scoped review**

- [ ] **Step 5: Open Draft PR**

PR must state that production Recall/Judge authority is unchanged and Graph Recall Shadow Mode is intentionally deferred to a separate PR.
