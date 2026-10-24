# Reference Graph P7 Lexical Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and live-verify a graph-native quick-profile selector that reproduces the established legacy lexical selection semantics from graph-resident data without benchmark tuning or production cutover.

**Architecture:** Preserve P5/P6 RPCs and all historical evidence. Enrich only graph asset metadata with missing pre-existing scoring fields, add a service-role-only P7 RPC that returns the complete current eligible quick candidate pool, then apply a pure JS parity selector that independently reproduces the legacy quick score, diversity, constructive-coverage, and legacy-ID tie rules. P7 is correctness-first: no semantic/hybrid ranking and no candidate pruning until parity is proven.

**Tech Stack:** Node.js ESM, `node:test`, PostgreSQL/Supabase SQL, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-23-reference-graph-p7-lexical-parity-design.md`

## Global Constraints

- Base: `0dc105ef4a1ea3f9b6512598a4f5996e2be95c5f`.
- `production_source` remains `legacy-control`; no merge/cutover.
- Gates unchanged: overlap `>=0.65`, top1 `>=0.75`, empty `<=0.05`, surface `>=0.70`, platform `>=0.80`, >=20 comparable cases.
- P3/P4/P5/P6 evidence and P5/P6 RPCs are immutable.
- No catalog JSONL mutation, freshness/status/TTL rewrite, or access-authority change.
- Metadata-only re-import must preserve source/asset/chunk IDs, content hashes, text hashes, and embeddings.
- Exact live target only: `vrznfnxzlxaavpqbzbzd` / `agent-hub-reference-graph` / `eu-central-1`.
- Production P7 code must not import legacy selection code, catalog records, shadow cases, evidence files, expected IDs, or per-case scores.
- Legacy quick values are frozen and copied exactly: surface `+60`, platform `+15`, overlap `×5`, multi-state `+4`, ordinary/failure-prone `+3`, TESTED `+3`, AVAILABLE `+2`, visual-verified `+25`, visual help/docs/guide/support/marketing `-20`, diversity `20/8/6`.
- Every P7 candidate must have a non-empty `legacy_id`; final ranking ties use `legacy_id` exactly as legacy `record.id` ordering. Asset UUID never decides a parity tie.
- P7 supports `quick` only; standard/deep behavior is untouched.
- No semantic/hybrid ranking, ANN, relation fabrication, or candidate-pool optimization in P7.
- Unrelated `write-swift` release-governance repair remains out of scope.

## Review Focus

- Metadata enrichment must not alter `contentText`, asset/chunk identity, or embedding compatibility.
- P7 search-token reconstruction must exactly equal legacy `recordSearchText()` token semantics despite using graph chunks + metadata.
- Full eligible-pool RPC must relax only query filtering, never review/access/freshness eligibility.
- Constructive quick coverage must remain jointly feasible and deterministic under diversity penalties.
- Score ties whose asset-ID ordering differs from legacy-ID ordering must still reproduce legacy selection order.

---

### Task 1: Metadata Parity + Identity Invariant

**Files:**
- Modify: `reference-graph/legacy-import.mjs`
- Create: `tests/reference-graph/p7-metadata-parity.test.mjs`

**Interfaces:**
- `adaptLegacyDesignReference(record)` additionally writes asset metadata keys:
  - `evidence_class`
  - `ordinary_or_failure_prone`
  - `multi_state_flow`
- `contentText` and all identity inputs remain unchanged.

- [ ] **Step 1: Write RED metadata tests**

Assert the three metadata fields are absent on the current implementation and that a metadata-enriched capture must expose exact legacy values.

- [ ] **Step 2: Write RED identity-stability test**

For one complete fixture, compare the pre-enrichment and intended enriched projection and require identical source ID, asset ID, chunk ID, asset content hash, chunk content, and chunk `text_hash`.

- [ ] **Step 3: Run RED**

Run: `node --test tests/reference-graph/p7-metadata-parity.test.mjs`
Expected: metadata assertions fail.

- [ ] **Step 4: Implement metadata enrichment only**

Do not change `searchableText`, observations, tags, captured time, provenance, source metadata, or identity generation.

- [ ] **Step 5: Verify GREEN**

Run: `node --test tests/reference-graph/p7-metadata-parity.test.mjs tests/reference-graph/legacy-import.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `feat: preserve P7 lexical parity metadata`

---

### Task 2: Pure Graph-Native Legacy-Quick Parity Selector

**Files:**
- Create: `reference-graph/p7-parity-policy.mjs`
- Create: `tests/reference-graph/p7-parity-policy.test.mjs`

**Interfaces:**
- `selectP7ParityLexicalResults({ candidates, request, maxItems }) -> { ids, diagnostics }`
- Candidate shape:
  - `asset_id`
  - `legacy_id` — required non-empty string and authoritative final tie-break
  - `search_text`
  - `product`
  - `surface_family`
  - `platform`
  - `page_role`
  - `motion`
  - `source_family`
  - `topology`
  - `access_status`
  - `evidence_class`
  - `ordinary_or_failure_prone`
  - `multi_state_flow`
  - `tags`

- [ ] **Step 1: Write RED score-decomposition tests**

Pin every frozen static value independently: `60/15/5`, `4/3/3/2`, `+25/-20`, and diversity `20/8/6`.

- [ ] **Step 2: Write RED token-parity tests**

Require query tokens to equal legacy `job + dimensions + surface` token semantics and candidate search tokens to use `search_text + surface_family + motion` with ASCII-set tokenization.

- [ ] **Step 3: Write RED visual-request tests**

Pin `visual-verified` boost and page-role penalty behavior exactly.

- [ ] **Step 4: Write RED constructive-coverage and tie tests**

Pin feasible joint surface/platform coverage, overlapping predicates, infeasible deterministic fallback, and a tie fixture where asset-ID order disagrees with legacy-ID order. Require `legacy_id.localeCompare(...)` to determine the final parity order.

- [ ] **Step 5: Run RED**

Run: `node --test tests/reference-graph/p7-parity-policy.test.mjs`
Expected: module missing / tests fail.

- [ ] **Step 6: Implement selector minimally**

Production module must not import `knowledge/design-references`, shadow fixtures, or evidence. Reject missing/duplicate `legacy_id`; use `asset_id` only as transport identity, never as a score-tie decision.

- [ ] **Step 7: Add test-only parity harness**

In tests only, compare P7 selections against `selectRecords()` over synthetic quick fixtures generated independently of shadow case IDs. Pin identical selected legacy IDs and selection order.

- [ ] **Step 8: Add committed-catalog regression test**

Project committed records through `adaptLegacyDesignReference()`, build P7 candidate rows from the resulting capture, and compare P7 versus legacy quick selection at `2026-10-23T12:00:00Z`. The test may use the fixed 24 cases only as regression evidence; production code must remain fixture-free.

- [ ] **Step 9: Verify GREEN and commit**

Run: `node --test tests/reference-graph/p7-parity-policy.test.mjs`
Expected: PASS.
Commit: `feat: add graph-native quick parity policy`

---

### Task 3: Migration 007 Full Eligible Candidate Pool

**Files:**
- Create: `reference-graph/schema/007_reference_graph_lexical_parity.sql`
- Create: `tests/reference-graph/p7-rpc-contract.test.mjs`

**Interfaces:**
- `public.reference_graph_quick_candidate_pool_p7(jsonb)`

The RPC returns every current eligible asset for `reference_date`, deterministically by asset ID for transport, with all Task-2 candidate fields. Policy ranking remains independent of transport order and resolves final score ties by `legacy_id`.

- [ ] **Step 1: Write RED RPC contract tests**

Require service-role-only function, `current_assets`, reviewed/access/TTL predicates, deterministic transport ordering, non-empty legacy ID, concatenated chunk text, topology, tags, and all parity metadata fields.

- [ ] **Step 2: Assert forbidden SQL behavior**

Reject query-text arguments, surface/platform equality eligibility predicates, embedding/model dependencies, and writes.

- [ ] **Step 3: Run RED**

Run: `node --test tests/reference-graph/p7-rpc-contract.test.mjs`
Expected: migration missing.

- [ ] **Step 4: Implement migration 007**

Aggregate chunk content by ordinal; expose requested fields; preserve P5/P6 functions unchanged.

- [ ] **Step 5: Verify source contract**

Run: `node --test tests/reference-graph/p7-rpc-contract.test.mjs tests/reference-graph/*.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `feat: add P7 full eligible candidate pool RPC`

---

### Task 4: Store Adapter + P7 Shadow Retriever

**Files:**
- Modify: `reference-graph/supabase-store.mjs`
- Create: `reference-graph/p7-live-shadow.mjs`
- Create: `tests/reference-graph/p7-live-shadow.test.mjs`

**Interfaces:**
- `quickCandidatePoolP7(filters) -> candidate[]`
- `createP7SupabaseShadowRetriever({ store }) -> graphRetrieve`

- [ ] **Step 1: Write store RED test**

Assert exact RPC name `reference_graph_quick_candidate_pool_p7`, only `p_filters`, preserved `reference_date`, and no query/embedding payload.

- [ ] **Step 2: Implement store method**

Do not modify historical store methods.

- [ ] **Step 3: Write retriever RED tests**

Assert quick-only request, full pool passed unchanged to the pure P7 policy, `maxItems` respected, no semantic provider, and returned assets follow policy legacy-ID order rather than RPC transport order.

- [ ] **Step 4: Implement P7 retriever**

No fallback to P6/P5 retrieval paths.

- [ ] **Step 5: Add sparse-pool and permutation fixtures**

Require deterministic full fill and honest coverage diagnostics.

- [ ] **Step 6: Verify and commit**

Run: `node --test tests/reference-graph/p7-parity-policy.test.mjs tests/reference-graph/p7-rpc-contract.test.mjs tests/reference-graph/p7-live-shadow.test.mjs`
Expected: PASS.
Commit: `feat: wire P7 parity retrieval path`

---

### Task 5: P7 Receipt + Read-Only Operator

**Files:**
- Create: `reference-graph/p7-receipt.mjs`
- Create: `reference-graph/cli/p7-live-quality.mjs`
- Create: `tests/reference-graph/p7-receipt.test.mjs`
- Create: `tests/reference-graph/p7-operator.test.mjs`

**Interfaces:**
- `createP7Receipt({ binding, gitSha, verificationAt, referenceTime, baseSha })`
- `recordP7Phase(receipt, { phase, status, detail? })`
- `finalizeP7Receipt(receipt, { currentControlHealth, identityEvidence, embeddingCoverage, candidatePool, evaluation, migration })`
- `assertSecretFreeP7Receipt(receipt, secrets)`
- CLI modes:
  - `--current-control`
  - `--candidate-pool`
  - `--supabase-p7-parity-lexical`

- [ ] **Step 1: Write receipt RED tests**

Pin target/base/SHA, terminal phase semantics, structural 24/24+0-gap control, identity invariants, 275/275 embedding compatibility, unchanged thresholds, `legacy-control`, and cutover-review eligibility only when the P7 lexical evaluation passes every gate.

- [ ] **Step 2: Implement receipt**

P7 never performs cutover.

- [ ] **Step 3: Write operator RED tests**

Pin mode exclusivity, target binding, secret redaction, P7 retriever selection, full-pool count, and blocked control/identity paths.

- [ ] **Step 4: Implement operator**

No write/migration/import action is exposed by the operator.

- [ ] **Step 5: Verify and commit**

Run: `node --test tests/reference-graph/p7-receipt.test.mjs tests/reference-graph/p7-operator.test.mjs`
Expected: PASS.
Commit: `feat: add P7 parity quality operator and receipt`

---

### Task 6: Permanent Governance + Implementation Verification

**Files:**
- Modify: `.github/workflows/verify-reference-graph.yml`
- Create: `tests/reference-graph/p7-ci-contract.test.mjs`

- [ ] **Step 1: Write RED CI contract**

Require P7 tests, migration 007 execution, P7 DB smoke, P3-P6 evidence immutability, secret scans, current-control measurement, metadata identity test, and anti-benchmark-leakage guard.

- [ ] **Step 2: Add migration 007 DB smoke**

Create fresh reviewed/access/fresh, stale, candidate, blocked, and cross-surface rows. Require the P7 RPC to return only hard-eligible rows and to expose full parity fields/search text.

- [ ] **Step 3: Add service-role grant smoke**

Require service role success and `anon` / `authenticated` denial.

- [ ] **Step 4: Add P7 anti-leakage guard**

Production P7 files must not reference shadow/evidence files, known case IDs, expected IDs, legacy selection module paths, or per-case outcomes.

- [ ] **Step 5: Run full Reference Graph suite**

Run: `node --test tests/reference-graph/*.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run design-reference library regression + secret scan**

Use the same commands/pattern as P6 Task 6.

- [ ] **Step 7: Whole P6→P7 implementation review**

Check metadata-only scope, unchanged content identity, P5/P6 RPC immutability, no standard/deep changes, no threshold changes, exact legacy-ID tie semantics, and no benchmark leakage.

- [ ] **Step 8: Fix any finding RED→GREEN and repeat verification**

- [ ] **Step 9: Record clean implementation SHA + permanent governance run**

Commit: `ci: govern P7 lexical parity`

---

### Task 7: Dedicated Supabase Metadata Re-import + Live Evidence

**Files:**
- Create: `reference-graph/evidence/p7-lexical-parity-evidence.json`

- [ ] **Step 1: Verify exact target identity/health**

Only `vrznfnxzlxaavpqbzbzd`.

- [ ] **Step 2: Re-measure preconditions**

Require current control 24/24, zero gaps, fresh pool 275, existing counts 600 assets / 600 chunks / 600 embeddings, and P6 evidence unchanged.

- [ ] **Step 3: Apply committed migration 007 only**

Record migration file hash and history row.

- [ ] **Step 4: Snapshot graph identities before re-import**

Persist/compare deterministic sets or hashes for source IDs, asset IDs, chunk IDs, asset content hashes, and chunk text hashes.

- [ ] **Step 5: Re-import committed 600-record catalog**

Run twice. Require no new IDs/count changes and metadata fields populated.

- [ ] **Step 6: Re-measure embedding compatibility**

Require `275/275`, missing `0`, text-hash mismatch `0`.

- [ ] **Step 7: Verify candidate pool**

Require exactly 275 currently eligible rows and complete parity fields, including non-empty unique `legacy_id`, for each row.

- [ ] **Step 8: Run P7 parity lexical on all 24 cases**

Record raw legacy IDs, raw graph legacy IDs, overlap/top1, surface/platform, empty, latency, and policy diagnostics.

- [ ] **Step 9: Recompute summaries from raw IDs**

Raw IDs are binding over helper scalars.

- [ ] **Step 10: Build final `finalizeP7Receipt()` + secret check**

Record `NO CUTOVER` or `eligible_for_cutover_review: true`; never perform cutover.

- [ ] **Step 11: Commit evidence**

Commit: `evidence: record P7 lexical parity`

- [ ] **Step 12: Require permanent Reference Graph governance GREEN on evidence head**

---

### Task 8: Final Draft PR + Stop Boundary

- [ ] **Step 1: Whole-branch P6→P7 review**
- [ ] **Step 2: Confirm no temporary workflows, transport artifacts, or helper scripts remain**
- [ ] **Step 3: Update stacked Draft PR P7→P6 with base/implementation/evidence SHAs, migration 007, identity evidence, live metrics, governance, and inherited `write-swift` failure**
- [ ] **Step 4: Keep PR open/draft/unmerged and `production_source=legacy-control`**
- [ ] **Step 5: Stop at evidence boundary; do not change production routing even if `eligible_for_cutover_review=true`**
