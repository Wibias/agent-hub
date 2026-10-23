# Reference Graph P8 Cutover Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the quick-profile production handoff from legacy selection to P7 graph selection without activating it, while keeping standard/deep legacy-only and keeping the Supabase service-role credential out of the normal design-reference runtime.

**Architecture:** P8 adds a pure handoff adapter, an offline P7 candidate-pool builder, a read-only review operator, and a canonical review receipt. The existing `knowledge/design-references/scripts/query.mjs` remains byte-identical and continues serving production. Live review uses the existing service-role-only P7 RPC only inside the operator and binds the result to P7 evidence plus the current local catalog.

**Tech Stack:** Node.js 24 ESM, Node test runner, existing design-reference catalog/selectors, existing P7 parity policy, existing Supabase store/target binding, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-23-reference-graph-p8-cutover-review-design.md`

## Global Constraints

- P8 performs no production cutover and no route switch.
- `production_source` remains `legacy-control`.
- `knowledge/design-references/scripts/query.mjs` must retain Git blob `4963cfbaf4306a03084f4513a1e324f649ce36e5`.
- Standard and deep remain legacy-only; P7 graph selection is quick-only.
- `SUPABASE_SERVICE_ROLE_KEY` must not appear under `knowledge/design-references/**`.
- P7 RPC grants remain service-role-only; P8 adds no migration.
- Review/dry-run execution never records usage.
- Unknown or duplicate graph legacy IDs fail closed.
- P7 thresholds and P7 evidence are immutable.
- PR remains draft/open/unmerged.

## Review Focus

- **Graph ID cannot be hydrated locally:** fail closed with the exact missing ID; never drop it and continue. Task 1 test pins this.
- **Duplicate graph ID or duplicate local catalog ID:** reject ambiguity before comparison. Task 1 test pins this.
- **Standard/deep request reaches graph adapter:** reject it as unsupported rather than silently treating it as quick. Task 1 and Task 3 tests pin this.
- **Service-role/network failure during live review:** report the review as blocked; do not claim legacy fallback is a successful graph review. Task 3 test pins this.
- **Future code accidentally wires graph into production CLI:** permanent governance pins the query blob and forbids service-role/network imports in the design-reference runtime. Task 4 pins this.

---

### Task 1: Pure P8 Handoff Contract and Offline Candidate Pool

**Files:**
- Create: `reference-graph/p8-cutover-review.mjs`
- Test: `tests/reference-graph/p8-cutover-review.test.mjs`

**Interfaces:**
- Produces: `buildP8OfflineQuickCandidatePool(records, { now }) -> candidate[]`
- Produces: `hydrateP8LegacyIds({ records, legacyIds }) -> record[]`
- Produces: `compareP8QuickHandoff({ records, request, graphLegacyIds, legacySelection }) -> result`
- Produces: `assessP8ActivationBoundary({ profile, handoffExact, runtimeCredentialMode }) -> result`

- [ ] **Step 1: Write the failing contract tests**

Pin these assertions:

- offline pool contains only current reviewed accessible records at `2026-10-23T12:00:00Z`;
- offline candidate fields match P7 RPC semantics, including `asset.metadata.source_family ?? source.source_family`;
- hydration preserves graph ID order and returns the canonical local record objects;
- unknown graph ID throws with that ID;
- duplicate graph IDs throw;
- duplicate local record IDs throw;
- exact quick IDs yield `handoff_exact === true`;
- reordered/different quick IDs yield `handoff_exact === false` with diagnostics;
- standard/deep requests throw before graph comparison;
- activation boundary returns quick review eligibility only for exact quick handoff;
- service-role runtime always yields `production_activation_ready === false`;
- all outputs state `production_source: 'legacy-control'` and `activation_performed: false` where applicable.

- [ ] **Step 2: Run focused test and confirm RED**

Run:

`node --test tests/reference-graph/p8-cutover-review.test.mjs`

Expected: failure because `reference-graph/p8-cutover-review.mjs` does not exist.

- [ ] **Step 3: Implement the pure P8 contract**

`buildP8OfflineQuickCandidatePool(records, { now })`:

- uses `isFresh()` plus the same reviewed/access eligibility as the local selector;
- adapts each eligible record with `adaptLegacyDesignReference()`;
- derives the P7 candidate shape from capture metadata/observations/chunks/tags;
- resolves source family from asset metadata first, then source fallback;
- sorts deterministically by `asset_id`.

`hydrateP8LegacyIds` validates uniqueness on both sides and returns records in requested ID order.

`compareP8QuickHandoff` accepts only `profile === 'quick'`, hydrates graph IDs, compares ordered legacy IDs, and returns diagnostics without mutation.

`assessP8ActivationBoundary` never returns production activation ready in P8.

- [ ] **Step 4: Run focused test and full Reference Graph tests**

Run:

`node --test tests/reference-graph/p8-cutover-review.test.mjs`

then:

`node --test tests/reference-graph/*.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message:

`feat: add P8 cutover review handoff contract`

---

### Task 2: Canonical P8 Review Receipt

**Files:**
- Create: `reference-graph/p8-receipt.mjs`
- Test: `tests/reference-graph/p8-receipt.test.mjs`

**Interfaces:**
- Produces: `P8_PHASES = ['preflight','offline_contract','live_review','security_boundary']`
- Produces: `createP8Receipt({ binding, gitSha, verificationAt, referenceTime, baseSha })`
- Produces: `recordP8Phase(receipt, { phase, status, detail, error })`
- Produces: `finalizeP8Receipt(receipt, { p7Receipt, currentControlHealth, candidatePool, offlineReview, liveReview, blockers })`
- Produces: `assertSecretFreeP8Receipt(value, extraSecrets = [])`

- [ ] **Step 1: Write failing receipt tests**

Pin:

- schema `reference-graph.p8-cutover-review.v1`;
- production source always `legacy-control`;
- activation performed always `false`;
- quick review eligibility requires all four phases successful, P7 ready/blocker-free, healthy control, complete unique pool, and exact 24-case offline/live handoff;
- standard/deep are reported `legacy-only` and do not invalidate quick review;
- `production_activation_ready` is always `false` in P8;
- service-role runtime boundary is always present in blockers;
- terminal phase failure keeps review eligibility false;
- secret scanner rejects service-role values anywhere in receipt.

- [ ] **Step 2: Run focused test and confirm RED**

`node --test tests/reference-graph/p8-receipt.test.mjs`

Expected: missing module.

- [ ] **Step 3: Implement receipt**

Use the P7 receipt pattern for phase validation and deep secret scanning, but keep P8 decision semantics distinct:

- `quick_path_review_eligible`
- `production_activation_ready`
- `production_source`
- `activation_performed`

No P8 function may infer that `quick_path_review_eligible` authorizes activation.

- [ ] **Step 4: Run focused and full tests**

Expected: PASS.

- [ ] **Step 5: Commit**

`feat: add P8 cutover review receipt`

---

### Task 3: Read-only Offline/Live Cutover Review Operator

**Files:**
- Create: `reference-graph/cli/p8-cutover-review.mjs`
- Test: `tests/reference-graph/p8-operator.test.mjs`

**Interfaces:**
- Consumes: Task 1 P8 adapter and offline pool
- Consumes: P7 `selectP7ParityLexicalResults`
- Consumes: `ReferenceGraphSupabaseStore.quickCandidatePoolP7(filters)`
- Consumes: target-binding helpers
- Produces CLI modes `--offline-contract` and `--supabase-quick-review --target <path>`

- [ ] **Step 1: Write failing operator tests**

Pin:

- exactly one mode required;
- offline mode requires no Supabase environment values;
- offline mode uses 24 committed quick cases and reports 24/24 exact handoff on current catalog;
- live mode requires target binding, URL binding, and service role;
- live mode passes `reference_date` to `quickCandidatePoolP7`;
- live mode never calls an ingest/write method;
- standard/deep per-request graph review is rejected;
- network/credential error exits non-zero and is redacted;
- no call to `recordUsage` exists in operator source;
- output is secret-free and says production remains legacy.

- [ ] **Step 2: Run focused test and confirm RED**

`node --test tests/reference-graph/p8-operator.test.mjs`

- [ ] **Step 3: Implement operator**

`--offline-contract`:

- load local records and shadow cases;
- reject any non-quick case;
- build offline candidate pool once;
- for each case compute legacy selection, P7 graph selection, and P8 handoff comparison;
- summarize exact case count and blockers.

`--supabase-quick-review`:

- use existing target/credential guards;
- read live P7 pool once;
- run same case loop against current local legacy selector;
- report live pool counts and handoff summary;
- no writes.

- [ ] **Step 4: Run focused/full tests and offline operator**

Run:

`node reference-graph/cli/p8-cutover-review.mjs --offline-contract --reference-date 2026-10-23`

Expected:

- 24 cases;
- 24 exact handoffs;
- 0 mismatches;
- production source legacy-control.

- [ ] **Step 5: Commit**

`feat: add P8 cutover review operator`

---

### Task 4: Permanent P8 Governance and Runtime Boundary Guards

**Files:**
- Modify: `.github/workflows/verify-reference-graph.yml`
- Create: `tests/reference-graph/p8-ci-contract.test.mjs`
- Modify: `reference-graph/README.md`

**Interfaces:**
- Consumes Tasks 1–3
- Produces permanent review-only safety gates

- [ ] **Step 1: Write failing CI-contract tests**

Pin workflow requirements:

- P8 tests are covered by the normal wildcard suite;
- committed P8 evidence is secret-scanned when present;
- P7 evidence remains immutable at the final restacked base semantics;
- `git hash-object knowledge/design-references/scripts/query.mjs` must equal `4963cfbaf4306a03084f4513a1e324f649ce36e5`;
- recursive static scan of `knowledge/design-references` must reject `SUPABASE_SERVICE_ROLE_KEY`, `ReferenceGraphSupabaseStore`, `quickCandidatePoolP7`, and `p7-parity-policy` imports;
- offline P8 operator runs at `2026-10-23` and requires 24 exact handoffs;
- no migration 008 is executed;
- migrations remain 001→007;
- existing P7 DB smoke remains unchanged.

- [ ] **Step 2: Run focused test and confirm RED**

`node --test tests/reference-graph/p8-ci-contract.test.mjs`

- [ ] **Step 3: Extend governance and README**

Add named steps:

- `Verify P8 production CLI remains legacy-only`
- `Verify P8 offline quick handoff contract`

Extend committed-artifact secret scan to `reference-graph/evidence/p8-cutover-review-evidence.json` through `assertSecretFreeP8Receipt`.

README documents P8 as review-only and explicitly states service-role is not a production runtime credential.

- [ ] **Step 4: Run full governance**

Expected Reference Graph workflow: GREEN.

The separate Release Governance may remain red only for the inherited `write-swift skill must exist` baseline issue.

- [ ] **Step 5: Commit**

`ci: enforce P8 cutover review boundaries`

---

### Task 5: Live Read-only Review and Durable Evidence

**Files:**
- Create: `reference-graph/evidence/p8-cutover-review-evidence.json`

**Interfaces:**
- Consumes final implementation SHA from Tasks 1–4
- Consumes canonical P7 receipt from `reference-graph/evidence/p7-lexical-parity-evidence.json`
- Produces canonical P8 receipt/evidence

- [ ] **Step 1: Freeze the implementation SHA**

Require permanent Reference Graph governance green on the implementation head before evidence is generated.

- [ ] **Step 2: Re-verify live target read-only**

On `vrznfnxzlxaavpqbzbzd` verify:

- target healthy;
- migration `20261023190807 / reference_graph_lexical_parity_p7` present;
- P7 RPC exists;
- service_role execute true;
- anon/authenticated false;
- live pool 275 eligible / 275 complete / 275 unique.

Do not apply DDL or mutate data.

- [ ] **Step 3: Run P8 live review**

Execute the P8 live operator with the existing trusted operator credential path against reference date `2026-10-23`.

Required evidence:

- current legacy control healthy;
- 24 quick cases;
- 24 exact ordered handoffs;
- 0 mismatches;
- graph IDs all hydrate locally;
- production remains legacy-control;
- no usage writes.

- [ ] **Step 4: Finalize canonical receipt**

Record all four phases successful only if the evidence above holds.

Expected decision even on perfect parity:

- `quick_path_review_eligible: true`
- `production_activation_ready: false`
- `production_source: legacy-control`
- `activation_performed: false`
- blocker includes service-role runtime credential boundary.

Run `assertSecretFreeP8Receipt()` and repository secret scan.

- [ ] **Step 5: Commit evidence and rerun permanent governance**

Final evidence head must be green under permanent Reference Graph governance.

Commit:

`evidence: record P8 cutover review decision`

---

### Task 6: Final Scope Review and Draft PR Update

**Files:**
- No new implementation files expected

- [ ] **Step 1: Compare final P7 → P8 diff**

Expected scope:

- P8 design/plan;
- P8 pure adapter;
- P8 receipt;
- P8 operator;
- P8 tests;
- Reference Graph governance/README;
- durable P8 evidence.

Forbidden changes:

- `knowledge/design-references/scripts/query.mjs`;
- design-with-ai production reference-library instructions;
- knowledge index query command;
- catalog JSONL;
- migrations/schema;
- P7 policy/RPC behavior;
- production routing.

- [ ] **Step 2: Verify final PR remains draft/open/unmerged**

Base must be `agent/reference-graph-p7` and final P7 base SHA must be `2ce02e43a54549b0ddc2d7d78e7fc0e56430fe8d`.

- [ ] **Step 3: Update PR description with final evidence**

Document:

- implementation/evidence SHAs;
- governance runs;
- live read-only result;
- quick review eligibility;
- production activation blocker;
- no cutover/no merge.

- [ ] **Step 4: Stop at P8 boundary**

Do not alter `query.mjs` or production routing.

A future phase may design a least-privilege runtime transport and a reversible quick-only canary.