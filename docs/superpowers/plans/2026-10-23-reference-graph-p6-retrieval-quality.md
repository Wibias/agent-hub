# Reference Graph P6 Retrieval Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and live-verify a versioned P6 retrieval path that separates hard eligibility from request preference, restores the established quick-selection/diversity policy on graph candidates, and prevents weak semantic evidence from blindly degrading lexical retrieval.

**Architecture:** Preserve all P5 RPCs/evidence. Add parallel `_p6` read-only candidate/context RPCs with unchanged freshness/access/model eligibility but no hard surface/platform exclusion, then apply a pure JS policy using frozen pre-P6 surface/platform/token/diversity values. Semantic-only remains diagnostic; terminal hybrid is lexical-primary and semantic-supplemental. P6 records live evidence but never cuts over.

**Tech Stack:** Node.js ESM, `node:test`, PostgreSQL/Supabase SQL, pgvector, GitHub Actions, Ollama Snowflake Arctic Embed 33m.

**Spec:** `docs/superpowers/specs/2026-10-23-reference-graph-p6-retrieval-quality-design.md`

## Global Constraints

- Base: `fd904355c7d62ad716766eab3bfc41539f5ed18a`.
- `production_source` remains `legacy-control`; no merge/cutover.
- Gates unchanged: overlap `>=0.65`, top1 `>=0.75`, empty `<=0.05`, surface `>=0.70`, platform `>=0.80`, >=20 comparable cases.
- No catalog freshness/status/TTL mutation; 325 stale records remain out of scope.
- Exact semantic profile only: `snowflake-arctic-embed-33m-raw-v1`, revision `e8db018629b4`, 384 dimensions.
- P5 RPCs and P3/P4/P5 evidence are immutable.
- Production P6 code must not read shadow cases/evidence, case IDs, expected legacy IDs, or per-case scores.
- Frozen pre-P6 values only: surface `+60`, platform `+15`, lexical overlap `×5`, product/source/topology repeat penalties `20/8/6`.
- No learned semantic threshold/weight from the 24 evaluation cases.
- Live target only: `vrznfnxzlxaavpqbzbzd` / `agent-hub-reference-graph` / `eu-central-1`.
- No ANN, fabricated relations, browser-extension work, design-with-ai routing, or unrelated `write-swift` repair.

## Review Focus

- Sparse exact cells still fill from other **fresh eligible** candidates while preserving feasible quick coverage.
- Infeasible coverage stays deterministic and honest.
- Semantic-only candidates cannot evict fillable positive lexical results in hybrid.
- SQL relaxes only surface/platform preference, never freshness/access/model eligibility.
- Ties/input permutations remain deterministic by asset ID.

---

### Task 1: Pure P6 Retrieval Policy

**Files:**
- Create: `reference-graph/retrieval-policy.mjs`
- Create: `tests/reference-graph/p6-retrieval-policy.test.mjs`

**Interfaces:**
- `selectP6LexicalResults({ lexicalCandidates, assets, request, maxItems }) -> { ids, diagnostics }`
- `selectP6SemanticResults({ semanticCandidates, assets, request, maxItems }) -> { ids, diagnostics }`
- `selectP6GuardedHybridResults({ lexicalCandidates, semanticCandidates, assets, request, maxItems }) -> { ids, diagnostics }`

- [ ] **Step 1: Write lexical RED tests**

Assert synthetic fixtures use only `raw lexical score * 5 + exact surface 60 + exact platform 15`, then dynamic repeat penalties `product 20 / source_family 8 / topology 6`; stable ID resolves ties.

- [ ] **Step 2: Run RED**

Run: `node --test tests/reference-graph/p6-retrieval-policy.test.mjs`
Expected: module missing / tests fail.

- [ ] **Step 3: Implement lexical policy minimally**

Normalize only `metadata.product`, `surface_family`, `platform`, `source_family`, `topology`; reject non-quick requests.

- [ ] **Step 4: Add constructive-coverage RED tests**

Assert feasible quick coverage (`surface>=1`, `platform>=ceil(maxItems/2)`) survives every greedy choice; overlapping predicates count for both; infeasible joint constraints report honestly; missing requested dimensions remove only that requirement.

- [ ] **Step 5: Implement graph-shaped quick feasibility**

Keep it pure; do not depend on legacy record fixtures or shadow data.

- [ ] **Step 6: Add semantic diagnostic RED tests**

Assert `selectP6SemanticResults` preserves semantic score/rank order except when choosing the next highest candidate that keeps feasible quick coverage; no lexical/diversity weight; stable ID tie-break.

- [ ] **Step 7: Add guarded-hybrid RED tests**

Assert semantic cannot displace fillable positive lexical results; semantic-only may fill missing slots or a coverage slot unavailable lexically; dual-channel candidates remain lexical-primary; semantic rank may break only an otherwise stable-ID tie at identical adjusted lexical score; permutation is deterministic.

- [ ] **Step 8: Implement semantic + guarded hybrid minimally**

No learned threshold or fusion weight.

- [ ] **Step 9: Verify GREEN and commit**

Run: `node --test tests/reference-graph/p6-retrieval-policy.test.mjs`
Expected: PASS.
Commit: `feat: add P6 guarded retrieval policy`

---

### Task 2: Versioned P6 Candidate RPCs

**Files:**
- Create: `reference-graph/schema/006_reference_graph_retrieval_quality.sql`
- Create: `tests/reference-graph/p6-rpc-contract.test.mjs`
- Modify: `tests/reference-graph/foundation-contract.test.mjs` only if migration enumeration requires it.

**Interfaces:**
- `reference_graph_lexical_candidates_p6(text,jsonb,integer)`
- `reference_graph_semantic_candidates_p6(text,text,text,jsonb,integer)`
- `reference_graph_candidate_context_p6(uuid[],jsonb)`

- [ ] **Step 1: Write RPC RED tests**

Require all three service-role-only functions; `current_assets`, reviewed/access/TTL predicates; exact model/revision in semantic; no surface/platform equality eligibility predicates; context exposes `source_family` and deterministic topology observation.

- [ ] **Step 2: Run RED**

Run: `node --test tests/reference-graph/p6-rpc-contract.test.mjs`
Expected: migration missing.

- [ ] **Step 3: Implement lexical `_p6` RPC**

Copy P5 partial-token candidate semantics and raw score, but remove only hard surface/platform exclusion. Keep `score>0`, deterministic rank, limit 1..100.

- [ ] **Step 4: Implement semantic `_p6` RPC**

Keep cosine similarity, exact model/revision and all hard eligibility; remove only surface/platform exclusion.

- [ ] **Step 5: Implement context `_p6` RPC**

Return existing context plus `source_family` and one deterministic `topology`; eligibility stays current/reviewed/access/fresh. Relations unchanged.

- [ ] **Step 6: Verify and commit**

Run: `node --test tests/reference-graph/p6-rpc-contract.test.mjs tests/reference-graph/*.test.mjs`
Expected: PASS.
Commit: `feat: add versioned P6 retrieval RPCs`

---

### Task 3: Store Adapter + P6 Shadow Retriever

**Files:**
- Modify: `reference-graph/supabase-store.mjs`
- Create: `reference-graph/p6-live-shadow.mjs`
- Create: `tests/reference-graph/p6-live-shadow.test.mjs`

**Interfaces:**
- `lexicalCandidatesP6(query, filters, limit)`
- `semanticCandidatesP6(embedding, modelId, modelRevision, filters, limit)`
- `candidateContextP6(assetIds, filters)`
- `createP6SupabaseShadowRetriever({ store, queryProvider?, mode, modelId?, modelRevision?, candidateLimit? })`

- [ ] **Step 1: Write store RED tests**

Assert exact `_p6` RPC names/payloads and preserved `reference_date` plus requested surface/platform as policy context.

- [ ] **Step 2: Implement store methods without touching historical methods**

- [ ] **Step 3: Write retriever RED tests**

Pin lexical -> lexical policy, semantic -> `selectP6SemanticResults`, hybrid -> guarded policy; full request reaches policy; lexical never calls query provider; semantic/hybrid require exact model/revision; maxItems is respected.

- [ ] **Step 4: Implement P6 retriever**

Keep `createSupabaseShadowRetriever()` unchanged.

- [ ] **Step 5: Add sparse-cell integration fixture**

One exact cell candidate plus cross-cell fresh candidates must fill four while meeting feasible quick coverage; stale/unavailable rows are never supplied by the RPC contract.

- [ ] **Step 6: Verify and commit**

Run: `node --test tests/reference-graph/p6-retrieval-policy.test.mjs tests/reference-graph/p6-rpc-contract.test.mjs tests/reference-graph/p6-live-shadow.test.mjs`
Expected: PASS.
Commit: `feat: wire P6 retrieval shadow path`

---

### Task 4: P6 Operator + Receipt

**Files:**
- Create: `reference-graph/p6-receipt.mjs`
- Create: `reference-graph/cli/p6-live-quality.mjs`
- Create: `tests/reference-graph/p6-receipt.test.mjs`
- Create: `tests/reference-graph/p6-operator.test.mjs`

**Interfaces:**
- `createP6Receipt({ binding, gitSha, verificationAt, referenceTime, baseSha })`
- `recordP6Phase(receipt, { phase, status, detail? })`
- `finalizeP6Receipt(receipt, { currentControlHealth, embeddingCoverage, p5Baseline, evaluations, migration })`
- `assertSecretFreeP6Receipt(receipt, secrets)`
- CLI modes: `--current-control`, `--embedding-coverage`, `--supabase-p6-lexical`, `--supabase-p6-semantic`, `--supabase-p6-hybrid`.

- [ ] **Step 1: RED receipt tests**

Pin terminal failed phases, target/base/SHA, structural 24/24+0-gap control, exact embedding coverage, unchanged thresholds, `legacy-control`, and review eligibility only when guarded hybrid `cutover_ready===true`.

- [ ] **Step 2: Implement receipt**

- [ ] **Step 3: RED operator tests**

Pin argument exclusivity, target binding, secret redaction, exact profile, P6 retriever choice, and blocked control/embedding paths.

- [ ] **Step 4: Implement operator**

Reuse P5 helpers only where semantics stay unchanged; fixed cases remain evaluation-only.

- [ ] **Step 5: Verify and commit**

Run: `node --test tests/reference-graph/p6-receipt.test.mjs tests/reference-graph/p6-operator.test.mjs`
Expected: PASS.
Commit: `feat: add P6 quality operator and receipt`

---

### Task 5: Permanent Governance

**Files:**
- Modify: `.github/workflows/verify-reference-graph.yml`
- Create: `tests/reference-graph/p6-ci-contract.test.mjs`

- [ ] **Step 1: RED CI contract test**

Require P6 tests, migration 006 DB smoke, secret scans, historical immutability and current-control measurement.

- [ ] **Step 2: Add anti-benchmark-leakage guard**

Production P6 files must not reference shadow/evidence files, known case IDs, or expected IDs.

- [ ] **Step 3: Extend DB smoke**

After 001..006 verify `_p6` functions service-role-only; P5 RPCs still exist; fresh cross-surface/platform candidates remain visible to `_p6`; stale/unreviewed/blocked candidates remain excluded.

- [ ] **Step 4: Pin P3/P4/P5 evidence immutability**

- [ ] **Step 5: Verify and commit**

Run: `node --test tests/reference-graph/*.test.mjs`
Expected: PASS.
Commit: `ci: govern P6 retrieval quality`

---

### Task 6: Implementation Verification + Review

- [ ] **Step 1:** Run full Reference Graph tests.
- [ ] **Step 2:** Run the same design-reference library regression suite used by P5 Task 6.
- [ ] **Step 3:** Run committed/tree secret scans.
- [ ] **Step 4:** Review exact P5→P6 diff for P5-RPC/evidence mutation, threshold/catalog changes, benchmark leakage, semantic displacement, and accidental standard/deep behavior.
- [ ] **Step 5:** Fix any finding RED→GREEN and repeat verification.
- [ ] **Step 6:** Record one clean implementation SHA + green permanent governance run.

---

### Task 7: Dedicated Supabase + Live Evidence

**Files:**
- Create: `reference-graph/evidence/p6-retrieval-quality-evidence.json`

- [ ] **Step 1: Verify exact target identity/health**

Only `vrznfnxzlxaavpqbzbzd`.

- [ ] **Step 2: Re-measure preconditions**

Require current control 24/24, 0 gaps, healthy; embedding coverage 275/275, 0 missing/hash mismatch; P5 evidence unchanged.

- [ ] **Step 3: Apply committed migration 006 only to dedicated target**

- [ ] **Step 4: Verify grants + function semantics read-only**

- [ ] **Step 5: Reuse/generate exact pinned query embeddings and bind artifact hashes**

- [ ] **Step 6: Run P6 lexical, semantic diagnostic, guarded hybrid on all 24 cases**

Record raw returned IDs, overlap/top1, metadata rates, empty, latency, policy diagnostics.

- [ ] **Step 7: Recompute summaries from raw IDs**

Raw IDs win over inconsistent helper scalars.

- [ ] **Step 8: Compare hybrid against P5 lexical**

Record overlap improved/equal/regressed and top1 gained/preserved/lost.

- [ ] **Step 9: Build `finalizeP6Receipt()` + secret check, then commit evidence**

Commit: `chore: record P6 retrieval quality evidence`

- [ ] **Step 10: Require permanent Reference Graph governance GREEN on evidence head**

---

### Task 8: Final Draft PR + Stop Boundary

- [ ] **Step 1:** Whole-branch P5→P6 review.
- [ ] **Step 2:** Confirm no temporary workflows/helpers remain.
- [ ] **Step 3:** Update stacked Draft PR P6→P5 with SHAs, migration, target, gates, live metrics, regression counts, governance and inherited `write-swift` failure.
- [ ] **Step 4:** Keep PR open/draft/unmerged; keep `production_source=legacy-control`.
- [ ] **Step 5:** Report `NO CUTOVER` with blockers, or only `eligible_for_cutover_review: true` if every unchanged gate passes. Never perform cutover in P6.
