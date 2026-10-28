# Memory Graph Recall Shadow Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add default-off, read-only Graph Recall Shadow Mode that measures bounded graph expansion against the already-authoritative Recall/Judge result without changing production selection.

**Architecture:** Add a pure graph-shadow evaluator over the existing `buildMemoryGraph(...)` / `expandMemoryGraph(...)` foundation, persist privacy-safe immutable observations in a dedicated file store, then attach a post-authoritative observer to the Codex recall adapter. Live collection is explicitly gated and fail-open; evaluation is read-only and requires 100 natural Judge-labeled samples before any later promotion discussion.

**Tech Stack:** Node.js ESM, existing Memory Engine, existing Memory Graph module, built-in crypto/fs/path APIs, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-29-memory-graph-recall-shadow-design.md`

## Global Constraints

- Production Recall/Judge authority is unchanged.
- No second Judge call.
- No canonical SQLite schema migration or Memory mutation.
- Live shadow collection is default-off.
- Defaults: `maxAnchors=3`, `maxHops=1`, `maxCandidates=8`, `minWeight=0.82`.
- Existing graph bound remains at most `500` nodes and compatible embedding profiles only.
- Durable evidence stores no prompt text, Claim text, raw Claim IDs, or vectors.
- Candidate token cost uses deterministic `ceil(UTF8 bytes / 4)` estimation only.
- Minimum promotion-discussion evidence target is `100` quality-eligible natural runtime samples.
- This phase emits no production recommendation.

## Review Focus

- A source candidate absent from a truncated graph must be reported as missing and must not be silently replaced; Task 1 tests this.
- Novel graph neighbors outside the source candidate pool must be observable without being treated as authoritative selections; Task 1 tests this.
- Empty Judge selections must not fabricate a recall score or false negative; Task 1 tests this.
- Observer/store failures must leave the authoritative recall result unchanged and must not trigger another Judge call; Task 3 tests this.
- Duplicate durable observation IDs must be idempotent only for byte-equivalent content and reject conflicts; Task 2 tests this.

---

### Task 1: Pure Graph Recall Shadow Evaluator

**Files:**
- Create: `memory-engine/graph-recall-shadow.mjs`
- Create: `tests/memory-engine/graph-recall-shadow.test.mjs`

**Interfaces:**
- Consumes: graph returned by `buildMemoryGraph(...)`, ordered source candidate IDs/text, authoritative selector IDs/status.
- Produces: `evaluateGraphRecallShadow(options) -> report`.
- Produces: `estimateGraphRecallCandidateTokens(value) -> integer`.

- [ ] **Step 1: Write failing evaluator tests**

Cover:

- deterministic first-3 anchor selection from source order;
- one-hop expansion with max 8 candidates and inferred floor `0.82`;
- explicit-edge traversal below the inferred floor;
- novel graph candidate reporting;
- source-retained/source-pruned accounting;
- missing/truncated source-anchor accounting;
- Judge-labeled hit/miss/false-negative metrics;
- zero selected Judge result => recall `null`, false negatives `0`;
- no-Judge sample => `qualityEligible=false`, recall `null`;
- deterministic UTF-8 token estimate `ceil(bytes / 4)`;
- input graph/candidate arrays are not mutated.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/memory-engine/graph-recall-shadow.test.mjs`

Expected: FAIL because `memory-engine/graph-recall-shadow.mjs` does not exist.

- [ ] **Step 3: Implement minimal evaluator**

Implement:

`estimateGraphRecallCandidateTokens(value) -> integer`

`evaluateGraphRecallShadow({ graph, sourceCandidates, authoritativeSelectedIds, judgeCalled, judgeAvailable, maxAnchors=3, maxHops=1, maxCandidates=8, minWeight=0.82, clockMs=Date.now }) -> report`

`sourceCandidates` entries are `{ id, text }`. The report includes raw IDs only in-memory; durable privacy conversion belongs to Task 2.

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `node --test tests/memory-engine/graph-recall-shadow.test.mjs`

Expected: PASS with 0 failures.

- [ ] **Step 5: Commit**

`git commit -m "feat(memory): evaluate graph recall shadow"`

### Task 2: Immutable Privacy-Safe Shadow Store

**Files:**
- Create: `memory-engine/graph-recall-shadow-store.mjs`
- Create: `tests/memory-engine/graph-recall-shadow-store.test.mjs`

**Interfaces:**
- Consumes: in-memory evaluator report plus `{ projectId, branch, query, observedAt }`.
- Produces: `buildGraphRecallShadowRecord(...) -> record` with hashed candidate keys only.
- Produces: `GraphRecallShadowStore({ rootDir }).record(record)`, `.list()`, `.count()`.

- [ ] **Step 1: Write failing store tests**

Assert:

- deterministic SHA-256 candidate keys;
- deterministic observation ID includes scope, query digest, source keys, authoritative keys, and graph keys but stores no query text;
- serialized record contains no `query`, Claim text/value, raw Claim IDs, or `vector` property;
- identical duplicate record returns `existing`;
- same observation ID with different content throws `GRAPH_RECALL_SHADOW_CONFLICT`;
- `list()` is deterministic and `count()` matches.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/memory-engine/graph-recall-shadow-store.test.mjs`

- [ ] **Step 3: Implement store using the existing immutable recall-shadow file pattern**

Use atomic temp-write + hard-link semantics matching `RecallShadowCalibrationStore`; store files under `<rootDir>/graph-calibration/<observation-id>.json`.

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `node --test tests/memory-engine/graph-recall-shadow-store.test.mjs`

- [ ] **Step 5: Commit**

`git commit -m "feat(memory): persist graph recall shadow evidence"`

### Task 3: Post-Authoritative Codex Observer Boundary

**Files:**
- Modify: `memory-engine/adapters/codex-recall-context-selection.mjs`
- Create or modify: `tests/memory-engine/codex-recall-context-selection.test.mjs`
- Create: `tests/memory-engine/codex-graph-recall-shadow.test.mjs`

**Interfaces:**
- Add optional `graphRecallObserver` function.
- Add optional `onGraphRecallObservation` callback.
- Observer receives `{ query, candidates, authoritativeSelectedIds, judgeCalled, judgeAvailable }` after the authoritative result exists.
- Return value of `selectCodexAuthoritativeRecall(...)` stays the authoritative result; observer output is never substituted into it.

- [ ] **Step 1: Write failing authority-boundary tests**

Assert:

- observer runs after the normal selector result exists;
- authoritative `selected` and `selector.selected_ids` are unchanged when observer returns data;
- observer throw is swallowed and authoritative result is unchanged;
- callback throw is swallowed;
- baseline Judge call count remains exactly one when Judge is used;
- no-Judge authoritative fast-path remains no-Judge even with graph observer configured;
- observer receives reliance-approved candidates, not blocked items.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/memory-engine/codex-recall-context-selection.test.mjs tests/memory-engine/codex-graph-recall-shadow.test.mjs`

- [ ] **Step 3: Implement post-authoritative observer with fail-open isolation**

Keep existing Fast Path observer/shadow contracts unchanged. Do not add Graph Shadow output to authoritative selector fields.

- [ ] **Step 4: Run focused tests and verify GREEN**

- [ ] **Step 5: Commit**

`git commit -m "feat(memory): observe graph recall after authority"`

### Task 4: Live Memory Hook Wiring and Default-Off Gate

**Files:**
- Modify: `memory-engine/adapters/codex-hooks.mjs`
- Modify: `memory-engine/adapters/codex-hook-cli.mjs`
- Modify relevant hook/config tests under `tests/memory-engine/`.

**Interfaces:**
- Add explicit Graph Recall Shadow enablement to the hook runtime; default false.
- When enabled, build the current project/branch graph, evaluate the shadow observation, and persist it through `GraphRecallShadowStore`.
- Reuse the existing Memory shadow/calibration root family; keep Graph records in their own `graph-calibration` subdirectory.

- [ ] **Step 1: Write failing live-wiring tests**

Assert:

- default runtime does not invoke graph shadow;
- enabled runtime invokes it once per natural recall event;
- current `projectId` + `branch` are used;
- candidate text is used only for in-memory cost estimation and is absent from durable record;
- graph/store failures do not alter or suppress formatted authoritative memory context;
- no extra Judge factory/call is created by Graph Shadow;
- Windows path/lifecycle remains synchronous enough that persistence finishes before hook return.

- [ ] **Step 2: Verify RED**

Run the relevant Codex hook tests plus `tests/memory-engine/codex-graph-recall-shadow.test.mjs`.

- [ ] **Step 3: Implement explicit gate and live observer wiring**

Use a single explicit runtime flag named `graphRecallShadow` internally and map the CLI/environment configuration to it. Preserve all existing Recall Fast Path shadow flags and behavior.

- [ ] **Step 4: Verify GREEN**

Run all touched Codex hook/recall tests.

- [ ] **Step 5: Commit**

`git commit -m "feat(memory): wire graph recall shadow collection"`

### Task 5: Read-Only Natural Shadow Evaluator

**Files:**
- Create: `scripts/eval-graph-recall-shadow.mjs`
- Create: `tests/memory-engine/graph-recall-shadow-eval.test.mjs`

**Interfaces:**
- Reads `GraphRecallShadowStore.list()` only.
- Produces JSON report `type: "agent_hub_graph_recall_shadow"`, `schemaVersion: 1`.
- Uses `required_quality_sample_target: 100`.
- `production_recommendation` is always `null` in this phase.

- [ ] **Step 1: Write failing aggregate-evaluator tests**

Assert exact aggregation for:

- total vs quality-eligible observations;
- evidence sufficiency false at 99 and true only at 100+ eligible samples;
- mean/p95 local shadow latency;
- mean source/graph candidate counts and estimated tokens;
- source pruning and novel candidate rates;
- aggregate false-negative count;
- macro final-selection recall excludes `null` denominator samples;
- exact-preservation rate;
- `production_recommendation === null` regardless of metrics.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/memory-engine/graph-recall-shadow-eval.test.mjs`

- [ ] **Step 3: Implement evaluator and CLI JSON output**

Keep it read-only and deterministic. No automatic gate promotion.

- [ ] **Step 4: Verify GREEN**

Run focused evaluator/store tests.

- [ ] **Step 5: Commit**

`git commit -m "feat(memory): evaluate natural graph recall shadow"`

### Task 6: Regression, Documentation, and Stacked Draft PR

**Files:**
- Modify: `memory-engine/README.md`
- Modify: `README.md` only if operator enable/eval commands belong in the top-level Memory section.
- Update this plan/spec only for factual drift discovered during implementation.

**Interfaces:**
- Documents default-off enablement, evidence path, evaluation command, 100-sample target, and strict authority boundary.

- [ ] **Step 1: Run focused graph-shadow suites**

Run all new Graph Recall Shadow tests plus existing `memory-graph`, recall relevance, Fast Path shadow, live calibration, replay, and Codex recall tests.

- [ ] **Step 2: Run full Memory Engine foundation**

Run: `node --test tests/memory-engine/*.test.mjs`

Expected: PASS with 0 failures.

- [ ] **Step 3: Run syntax/diff hygiene**

Run `node --check` on new scripts/modules and `git diff --check`.

- [ ] **Step 4: Run governance CI and final scope review**

Verify Release Governance and relevant Reference Graph governance remain green. Confirm the stacked diff contains only Graph Recall Shadow code/tests/docs and no authority/schema/security drift.

- [ ] **Step 5: Open a draft stacked PR**

Base: `agent/memory-graph-inspector` while PR #135 remains unmerged.

The PR body must explicitly state:

- no production Recall/Judge authority change;
- no second Judge;
- default-off live collection;
- 100 natural quality-sample target;
- no production recommendation in this phase.
