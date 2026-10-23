# Reference Graph P6 Retrieval Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and live-verify a versioned P6 Reference Graph retrieval path that separates eligibility from request preference, restores the established quick selection/diversity policy on graph candidates, and prevents weak semantic evidence from blindly degrading lexical retrieval.

**Architecture:** Preserve all P5 RPCs and historical evidence. Add parallel `_p6` read-only candidate/context RPCs with unchanged freshness/access/model eligibility but no hard surface/platform exclusion, then apply a pure deterministic JS retrieval policy using frozen pre-P6 surface/platform/token/diversity values. Hybrid becomes lexical-primary with semantic-only candidates limited to supplemental coverage/fill roles. A P6 operator and terminal receipt collect current-date evidence on the dedicated Supabase project; P6 never performs cutover.

**Tech Stack:** Node.js ESM, `node:test`, PostgreSQL/Supabase SQL, pgvector cosine distance, GitHub Actions governance, Ollama Snowflake Arctic Embed 33m query embeddings.

**Spec:** `docs/superpowers/specs/2026-10-23-reference-graph-p6-retrieval-quality-design.md`

## Global Constraints

- Base exactly on P5 final evidence head `fd904355c7d62ad716766eab3bfc41539f5ed18a`.
- Production source remains `legacy-control`; P6 never cuts over or merges itself.
- Keep quality gates unchanged: overlap `>= 0.65`, top-1 `>= 0.75`, empty `<= 0.05`, exact surface `>= 0.70`, exact platform `>= 0.80`, minimum 20 comparable cases.
- Keep current-control authority unchanged: no catalog freshness/status/TTL rewrite and no stale-record recovery in P6.
- Keep exact semantic profile `snowflake-arctic-embed-33m-raw-v1`, model `ollama/snowflake-arctic-embed:33m`, revision `e8db018629b4`, 384 dimensions; no substitute vectors.
- P5 RPCs and P3/P4/P5 evidence are immutable; P6 adds `_p6` RPCs rather than replacing historical functions.
- P6 production code must not import/read `shadow-cases.json`, evidence JSON, shadow case IDs, expected legacy IDs, or per-case scores.
- Frozen pre-P6 ranking values only: surface `+60`, platform `+15`, lexical overlap `×5`, repeated product `20`, source-family `8`, topology `6`.
- Semantic confidence thresholds/weights must not be learned from the 24-case evaluation.
- Dedicated live target only: `vrznfnxzlxaavpqbzbzd` / `agent-hub-reference-graph` / `eu-central-1`.
- No ANN/HNSW/IVFFlat, relation fabrication, browser-extension work, `design-with-ai` routing changes, or unrelated `write-swift` repair.

## Review Focus

- A request whose exact surface/platform cell is sparse must still fill from other **fresh eligible** candidates while preserving feasible quick coverage; pin in Tasks 1–3.
- An infeasible quick coverage request must remain deterministic and report the real shortfall rather than duplicating/fabricating candidates; pin in Task 1.
- Semantic-only candidates must not evict fillable positive-score lexical candidates; pin in Task 1 and integration Task 3.
- P6 SQL must relax only request preference, never freshness/access/model eligibility; pin in Task 2 DB-smoke tests.
- Ties/input permutation must produce stable output by asset ID; pin in Tasks 1–3.

---

### Task 1: Pure P6 Retrieval Policy Contract

**Files:**
- Create: `reference-graph/retrieval-policy.mjs`
- Create: `tests/reference-graph/p6-retrieval-policy.test.mjs`

**Interfaces:**
- Consumes candidate rows `{ id, rank, score }`, graph asset context, full shadow/production request, and bounded `maxItems`.
- Produces `selectP6LexicalResults({ lexicalCandidates, assets, request, maxItems }) -> { ids, diagnostics }`.
- Produces `selectP6GuardedHybridResults({ lexicalCandidates, semanticCandidates, assets, request, maxItems }) -> { ids, diagnostics }`.
- `diagnostics` records coverage feasibility/result and selected lexical/semantic-only counts without benchmark IDs.

- [ ] **Step 1: Write RED tests for frozen lexical scoring and diversity**

Pin synthetic fixtures proving:

- raw lexical overlap contributes `score * 5`;
- exact requested surface contributes `+60`;
- exact requested platform contributes `+15`;
- after each selection, repeated product/source-family/topology subtract `20/8/6 * previous count`;
- stable ID is the final tie-break.

- [ ] **Step 2: Run the policy test and observe RED**

Run: `node --test tests/reference-graph/p6-retrieval-policy.test.mjs`

Expected: FAIL because `reference-graph/retrieval-policy.mjs` does not exist.

- [ ] **Step 3: Implement `selectP6LexicalResults(...)` minimally**

Represent asset fields through one internal normalizer reading:

- `metadata.product`
- `surface_family` / `metadata.surface_family`
- `platform` / `metadata.platform`
- `source_family`
- `topology`

Use only the spec's frozen values and deterministic asset ID tie-break.

- [ ] **Step 4: Add RED tests for constructive quick coverage**

Synthetic cases must prove:

- feasible `surface >= 1` and `platform >= ceil(maxItems / 2)` is preserved during greedy selection;
- both-predicate records are counted for both requirements;
- individually possible constraints that cannot jointly fit report infeasible honestly;
- missing request surface/platform removes only that requirement;
- standard/deep are rejected by the P6 quick-only policy rather than silently inheriting behavior.

- [ ] **Step 5: Implement generic quick feasibility inside the P6 module**

Do not import `quick-coverage.mjs` if doing so would couple graph asset shapes to legacy records; keep the helper pure and graph-shaped.

- [ ] **Step 6: Add RED guarded-hybrid tests**

Pin:

- semantic rank cannot displace a positive-score lexical result when lexical can fill limit + coverage;
- semantic-only candidate may fill an otherwise empty slot;
- semantic-only candidate may satisfy a feasible coverage slot that no remaining lexical candidate can satisfy;
- candidate present in both channels remains lexical-primary;
- semantic rank can replace only stable-ID tie-break for candidates with identical adjusted lexical score;
- permutation of input candidates yields identical IDs.

- [ ] **Step 7: Implement `selectP6GuardedHybridResults(...)` minimally**

Do not add a learned threshold or semantic fusion weight.

- [ ] **Step 8: Verify Task 1 GREEN**

Run: `node --test tests/reference-graph/p6-retrieval-policy.test.mjs`

Expected: all P6 policy tests PASS.

- [ ] **Step 9: Commit Task 1**

Commit message: `feat: add P6 guarded retrieval policy`

---

### Task 2: Versioned P6 Candidate RPCs

**Files:**
- Create: `reference-graph/schema/006_reference_graph_retrieval_quality.sql`
- Create: `tests/reference-graph/p6-rpc-contract.test.mjs`
- Modify: `tests/reference-graph/foundation-contract.test.mjs` only if migration enumeration is explicitly pinned there.

**Interfaces:**
- Produces SQL RPCs:
  - `reference_graph_lexical_candidates_p6(text, jsonb, integer)`
  - `reference_graph_semantic_candidates_p6(text, text, text, jsonb, integer)`
  - `reference_graph_candidate_context_p6(uuid[], jsonb)`
- All are `stable`, `security definer`, service-role-only, bounded, and read-only.

- [ ] **Step 1: Write RED migration-contract tests**

Assert migration 006:

- defines all three `_p6` functions;
- revokes `public, anon, authenticated` and grants `service_role` only;
- references `reference_graph.current_assets`;
- requires `review_status = 'reviewed'`;
- requires access in `AVAILABLE | PAYWALLED`;
- requires TTL freshness against `reference_date`;
- semantic RPC requires exact `model_id` and `model_revision`;
- does **not** use surface/platform equality as a `WHERE` eligibility predicate;
- context exposes `source_family` and `topology`.

- [ ] **Step 2: Run RED**

Run: `node --test tests/reference-graph/p6-rpc-contract.test.mjs`

Expected: FAIL because migration 006 does not exist.

- [ ] **Step 3: Implement lexical `_p6` RPC**

Keep P5 tokenization/partial-overlap semantics and raw distinct-token score; remove request surface/platform exclusion only. Preserve deterministic rank and 1..100 bound.

- [ ] **Step 4: Implement semantic `_p6` RPC**

Keep cosine similarity and exact model/revision eligibility; remove surface/platform exclusion only.

- [ ] **Step 5: Implement context `_p6` RPC**

Keep current/fresh/reviewed/access eligibility. Return existing asset payload plus:

- `source_family` from `sources.source_family`;
- `topology` from a deterministic topology observation lookup (`observation_kind = 'topology'`, stable ordering if multiple exist).

Do not relax eligibility for relation expansion.

- [ ] **Step 6: Run migration-contract tests GREEN**

Run: `node --test tests/reference-graph/p6-rpc-contract.test.mjs`

Expected: PASS.

- [ ] **Step 7: Run existing Reference Graph tests**

Run: `node --test tests/reference-graph/*.test.mjs`

Expected: PASS; historical P5 tests remain unchanged.

- [ ] **Step 8: Commit Task 2**

Commit message: `feat: add versioned P6 retrieval RPCs`

---

### Task 3: Store Adapter + P6 Shadow Retriever

**Files:**
- Modify: `reference-graph/supabase-store.mjs`
- Create: `reference-graph/p6-live-shadow.mjs`
- Create: `tests/reference-graph/p6-live-shadow.test.mjs`

**Interfaces:**
- `ReferenceGraphSupabaseStore.lexicalCandidatesP6(query, filters, limit)` calls lexical `_p6` RPC.
- `ReferenceGraphSupabaseStore.semanticCandidatesP6(embedding, modelId, modelRevision, filters, limit)` calls semantic `_p6` RPC.
- `ReferenceGraphSupabaseStore.candidateContextP6(assetIds, filters)` calls context `_p6` RPC.
- `createP6SupabaseShadowRetriever({ store, queryProvider?, mode, modelId?, modelRevision?, candidateLimit? })` returns the same `{ items, relations, ... }` shape consumed by `runCatalogShadowEvaluation`.

- [ ] **Step 1: Write RED store adapter tests**

Use the existing fetch/RPC stubbing pattern to assert exact `_p6` RPC names and payloads while preserving `reference_date`, requested surface/platform values as preference context, and candidate limit.

- [ ] **Step 2: Implement the three store methods**

Do not modify existing P5 store methods.

- [ ] **Step 3: Write RED P6 retriever tests**

Pin:

- lexical mode requests P6 lexical candidates + P6 context and invokes `selectP6LexicalResults`;
- semantic mode requests P6 semantic candidates + context and uses deterministic semantic diagnostic ordering with quick coverage;
- hybrid requests both channels but invokes guarded hybrid policy;
- request object reaches the policy unchanged;
- no query provider is called in lexical mode;
- exact model/revision is mandatory in semantic/hybrid modes;
- candidate limit is bounded and result count respects `maxItems`.

- [ ] **Step 4: Implement `createP6SupabaseShadowRetriever(...)`**

Keep P5 `createSupabaseShadowRetriever()` untouched.

- [ ] **Step 5: Add regression test for hard-filter removal behavior**

Mock a pool containing one exact surface/platform asset plus valid cross-surface/cross-platform assets. Assert P6 can fill four while meeting quick coverage; historical P5 mock remains sparse under its exact-filter path.

- [ ] **Step 6: Verify Task 3 GREEN**

Run: `node --test tests/reference-graph/p6-retrieval-policy.test.mjs tests/reference-graph/p6-rpc-contract.test.mjs tests/reference-graph/p6-live-shadow.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Commit message: `feat: wire P6 retrieval shadow path`

---

### Task 4: P6 Operator + Terminal Receipt

**Files:**
- Create: `reference-graph/p6-receipt.mjs`
- Create: `reference-graph/cli/p6-live-quality.mjs`
- Create: `tests/reference-graph/p6-receipt.test.mjs`
- Create: `tests/reference-graph/p6-operator.test.mjs`

**Interfaces:**
- Receipt API follows P5 phase discipline:
  - `createP6Receipt({ binding, gitSha, verificationAt, referenceTime, baseSha })`
  - `recordP6Phase(receipt, { phase, status, detail? })`
  - `finalizeP6Receipt(receipt, { currentControlHealth, embeddingCoverage, p5Baseline, evaluations, migration })`
  - `assertSecretFreeP6Receipt(receipt, secrets)`
- Operator modes:
  - `--current-control`
  - `--embedding-coverage`
  - `--supabase-p6-lexical`
  - `--supabase-p6-semantic`
  - `--supabase-p6-hybrid`

- [ ] **Step 1: Write RED receipt lifecycle tests**

Pin terminal failed phases, exact target/base/implementation binding, structural 24/24 + 0-gap control gate, 275/275 compatible embedding gate, unchanged thresholds, and `production_source = legacy-control`.

- [ ] **Step 2: Implement P6 receipt lifecycle**

`eligible_for_cutover_review` can become true only if the guarded hybrid summary is available and `cutover_ready === true`; this does not perform cutover.

- [ ] **Step 3: Write RED operator tests**

Pin argument exclusivity, target binding, secret redaction, exact profile, P6 retriever selection, and blocked behavior when control/embedding gates fail.

- [ ] **Step 4: Implement `p6-live-quality.mjs`**

Reuse P5 helpers where safe, but do not alter P5 operator semantics. Keep the 24 shadow cases evaluation-only.

- [ ] **Step 5: Verify Task 4 GREEN**

Run: `node --test tests/reference-graph/p6-receipt.test.mjs tests/reference-graph/p6-operator.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Commit message: `feat: add P6 quality operator and receipt`

---

### Task 5: Permanent Governance + Anti-Leakage

**Files:**
- Modify: `.github/workflows/verify-reference-graph.yml`
- Create: `tests/reference-graph/p6-ci-contract.test.mjs`

**Interfaces:**
- Permanent PR governance owns P6 tests, anti-leakage, migration smoke, historical immutability, secret scanning, and current-control measurement.

- [ ] **Step 1: Write RED CI contract test**

Require the workflow to run all P6 test files and migration 006 in DB smoke.

- [ ] **Step 2: Add source-level anti-benchmark-leakage assertions**

Fail if P6 production files contain imports/reads of:

- `shadow-cases.json`
- `p5-live-shadow-evidence.json`
- `p6-retrieval-quality-evidence.json`
- known shadow case IDs
- expected legacy IDs

The test fixture itself may name forbidden strings; production paths may not.

- [ ] **Step 3: Extend DB smoke**

After schema 001..006:

- verify `_p6` RPCs exist;
- service role can execute;
- anon/authenticated cannot;
- P5 RPCs still exist;
- synthetic fresh rows outside requested surface/platform remain visible to `_p6` candidate functions;
- stale/unreviewed/blocked rows remain excluded.

- [ ] **Step 4: Extend immutable evidence checks**

Pin P3/P4/P5 evidence blobs against the P5 base SHA or verify no P6 diff touches those files.

- [ ] **Step 5: Run full Reference Graph suite**

Run: `node --test tests/reference-graph/*.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

Commit message: `ci: govern P6 retrieval quality`

---

### Task 6: Final Implementation Verification + Whole-Branch Review

**Files:**
- No product files unless review finds a defect; any defect follows RED→GREEN before proceeding.

**Interfaces:**
- Produces one clean implementation SHA to which live P6 evidence is bound.

- [ ] **Step 1: Run complete Reference Graph tests**

Run: `node --test tests/reference-graph/*.test.mjs`

Expected: PASS.

- [ ] **Step 2: Run design-reference library regression suite**

Run the existing design-reference test command used in P5 Task 6.

Expected: PASS.

- [ ] **Step 3: Run committed/tree secret scans**

Use the permanent governance commands; no secret findings.

- [ ] **Step 4: Review exact P5→P6 diff**

Check specifically:

- no P5 RPC replacement;
- no P3/P4/P5 evidence rewrite;
- no freshness/catalog mutation;
- no threshold changes;
- no case/expected-ID references in production P6 code;
- semantic cannot displace fillable positive lexical candidates;
- standard/deep behavior is not silently defined.

- [ ] **Step 5: Fix any finding via RED→GREEN and re-run Steps 1–4**

Do not proceed to live deployment with unresolved Important/Critical findings.

- [ ] **Step 6: Record clean implementation SHA and green governance run**

This SHA is immutable input to Task 7 evidence.

---

### Task 7: Dedicated Supabase Migration + Live P6 Evidence

**Files:**
- Create after measurement: `reference-graph/evidence/p6-retrieval-quality-evidence.json`
- No edits to P5 evidence.

**Interfaces:**
- Live target only: `vrznfnxzlxaavpqbzbzd`.
- Migration name in Supabase history must identify P6 retrieval quality and correspond to committed schema 006.
- Terminal evaluation uses the exact pinned query embedding provider/artifact.

- [ ] **Step 1: Verify target identity and project health**

Require exact project ref/name/region and healthy status before DDL.

- [ ] **Step 2: Re-measure preconditions read-only**

Require:

- current control: 24/24 full, 0 gaps, healthy;
- exact embedding coverage: eligible 275, compatible 275, missing 0, hash mismatch 0;
- P5 evidence unchanged.

Stop P6 if these fail.

- [ ] **Step 3: Apply committed migration 006 to the dedicated project**

Use Supabase migration tooling. Do not apply DDL to any other project.

- [ ] **Step 4: Verify migration security and semantics**

Read-only checks confirm function definitions, grants, hard eligibility, soft preference candidate visibility, and unchanged P5 RPCs.

- [ ] **Step 5: Generate/reuse exact query embeddings**

Use only `snowflake-arctic-embed:33m@e8db018629b4`; bind artifact/run/content SHA. No synthetic/substitute vectors.

- [ ] **Step 6: Run live P6 lexical, semantic diagnostic, and guarded hybrid**

Use the P6 operator against the fixed 24 evaluation cases at a fixed current P6 reference time.

Record per-case IDs, overlap/top-1, exact metadata, empty, latency, and policy diagnostics.

- [ ] **Step 7: Recompute summaries from returned IDs**

Do not trust helper scalars when raw IDs disagree. Recompute overlap/top-1 from bound `legacy_ids ∩ graph_ids` exactly as P5 did.

- [ ] **Step 8: Compare P6 hybrid against P5 lexical baseline**

Record counts of overlap improved/equal/regressed and top-1 gained/preserved/lost. Do not hide regressions behind the average.

- [ ] **Step 9: Build canonical P6 receipt**

Use `finalizeP6Receipt()` + `assertSecretFreeP6Receipt()` and bind the clean Task-6 implementation SHA.

- [ ] **Step 10: Commit durable P6 evidence**

Commit message: `chore: record P6 retrieval quality evidence`

- [ ] **Step 11: Run permanent Reference Graph governance on evidence head**

Expected: PASS.

---

### Task 8: Final PR + Stop Boundary

**Files:**
- Update PR metadata/body only; no product changes unless final review finds a defect.

**Interfaces:**
- Produces stacked Draft PR `agent/reference-graph-p6` → `agent/reference-graph-p5`.

- [ ] **Step 1: Perform final whole-branch review**

Review exact P5 final head → P6 final evidence head using the spec's safety boundaries.

- [ ] **Step 2: Confirm temporary workflows/helpers are absent**

Final branch contains only permanent P6 product/governance/docs/evidence artifacts.

- [ ] **Step 3: Update Draft PR with final evidence**

Include base/head SHAs, migration identity, target, control/embedding gates, mode summaries, latency, regression counts, governance runs, Release-governance inherited `write-swift` status, and terminal decision.

- [ ] **Step 4: Preserve stop boundary**

PR remains `draft`, `open`, `unmerged`. Production source remains `legacy-control`. Do not mark ready, merge, or route traffic.

- [ ] **Step 5: Final verification statement**

Report one of:

- `NO CUTOVER` with exact blockers; or
- `eligible_for_cutover_review: true` if all unchanged gates pass, explicitly noting that no cutover was performed.
