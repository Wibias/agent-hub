# Reference Graph P9 Runtime Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a least-privilege, quick-only runtime transport and shadow canary that proves the certified P7 handoff without changing production routing.

**Architecture:** Migration 008 exposes one zero-argument, current-date P9 wrapper around the certified P7 candidate pool to Supabase `anon`/`authenticated`; no service-role credential enters the client. A separate P9 runtime client and shadow-canary CLI fetch that pool, execute the unchanged P7 policy locally, hydrate canonical local records/patterns, compare against legacy, and always keep legacy authoritative. `query.mjs` remains byte-identical.

**Tech Stack:** Node.js 24 ESM, PostgreSQL/Supabase PostgREST, GitHub Actions, existing P7 parity policy/P8 hydration and pattern-selection modules.

**Spec:** `docs/superpowers/specs/2026-10-23-reference-graph-p9-runtime-canary-design.md`

## Global Constraints

- Final P8 base is `619e0b490420f5292dd4bf16ae36cded4013f7d5`.
- `knowledge/design-references/scripts/query.mjs` must remain blob `4963cfbaf4306a03084f4513a1e324f649ce36e5` throughout P9.
- Production source remains `legacy-control`; P9 performs no production activation.
- Only `quick` may exercise the graph shadow canary; `standard`/`deep` are legacy-only and perform no graph request.
- Runtime client code must contain no `SUPABASE_SERVICE_ROLE_KEY` dependency or service-role credential parameter.
- Migration 008 must be additive and must not change P7/P6 RPC definitions or grants.
- P9 runtime wrapper has zero arguments and exposes only the current eligible P7 pool.
- No catalog, freshness, TTL, review/access, embedding, relation, or ranking-policy mutation.
- Existing quality gates remain unchanged.
- PR stays draft/open/unmerged.

## Review Focus

- Timeout/network failure must preserve a valid legacy result and never record graph usage — Task 3 tests.
- Duplicate/malformed/unknown graph IDs must fail closed to legacy — Tasks 2 and 3 tests.
- `standard`/`deep` must never invoke the remote fetcher — Task 3 tests.
- `anon` runtime access must not accidentally broaden access to P7/P6/write RPCs or tables — Tasks 1 and 5 DB smokes.
- Usage logging must happen exactly once for the authoritative legacy selection even when shadow parity succeeds — Task 3 tests.

---

### Task 1: Add the zero-argument least-privilege runtime RPC

**Files:**
- Create: `reference-graph/schema/008_reference_graph_runtime_canary.sql`
- Create: `tests/reference-graph/p9-runtime-rpc.test.mjs`

**Interfaces:**
- Consumes: `public.reference_graph_quick_candidate_pool_p7(jsonb)` from migration 007.
- Produces: `public.reference_graph_quick_candidate_pool_runtime_p9()` returning the same 15 candidate columns.

- [ ] **Step 1: Write the failing SQL-contract tests**

Pin that migration 008:

- creates `reference_graph_quick_candidate_pool_runtime_p9()` with no arguments;
- is `STABLE SECURITY DEFINER` with fixed search path and bounded statement timeout;
- delegates to the P7 pool with `reference_date = current_date`;
- grants execute to `anon`, `authenticated`, `service_role` and not `public`;
- does not alter the P7 function definition/grants;
- contains no write statements and accepts no caller filter/date parameter.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/reference-graph/p9-runtime-rpc.test.mjs`
Expected: FAIL because migration 008 does not exist.

- [ ] **Step 3: Implement migration 008**

Create exactly:

```text
public.reference_graph_quick_candidate_pool_runtime_p9()
```

Return the same columns/types as P7 by selecting from the P7 function with current-date filters. Set a 2-second statement timeout. Do not grant table/schema privileges.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/reference-graph/p9-runtime-rpc.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat: add least privilege P9 runtime RPC`

---

### Task 2: Add the publishable-key runtime client

**Files:**
- Create: `reference-graph/p9-runtime-client.mjs`
- Create: `tests/reference-graph/p9-runtime-client.test.mjs`

**Interfaces:**
- Produces:

```js
fetchP9QuickCandidatePool({
  supabaseUrl,
  publishableKey,
  fetchImpl = fetch,
  timeoutMs = 1500,
}) -> Promise<{
  candidates: Candidate[],
  transport: { status: 'available', latency_ms: number, candidate_count: number }
}>
```

- [ ] **Step 1: Write failing client tests**

Tests must prove:

- only `/rest/v1/rpc/reference_graph_quick_candidate_pool_runtime_p9` is called;
- request is POST with `{}` and publishable key headers only;
- timeout aborts and throws a typed/runtime transport error;
- non-2xx and invalid JSON fail closed;
- duplicate asset IDs, duplicate legacy IDs, missing IDs, or non-array payload fail validation;
- service-role key names/parameters are absent from the module contract;
- returned transport metadata contains no key material.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/reference-graph/p9-runtime-client.test.mjs`
Expected: FAIL with module missing.

- [ ] **Step 3: Implement the minimal client**

Use `AbortController`, normalize the Supabase URL, issue exactly one POST, validate candidates before returning them, and never log credentials.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/reference-graph/p9-runtime-client.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat: add P9 publishable runtime client`

---

### Task 3: Build the shadow-canary core and CLI

**Files:**
- Create: `reference-graph/p9-runtime-canary.mjs`
- Create: `reference-graph/cli/p9-runtime-canary.mjs`
- Create: `tests/reference-graph/p9-runtime-canary.test.mjs`
- Create: `tests/reference-graph/p9-runtime-canary-cli.test.mjs`

**Interfaces:**
- Consumes: `selectRecords`, `selectPatterns`, `recordUsage`, `selectP7ParityLexicalResults`, `hydrateP8LegacyIds`, `fetchP9QuickCandidatePool`.
- Produces:

```js
runP9ShadowCanary({
  records,
  patterns,
  request,
  fetchCandidatePool,
  recordUsageFn,
  recordUsageEnabled = true,
}) -> Promise<CanaryResult>
```

Authoritative result fields remain the legacy records/patterns; graph output lives only under `graph_canary`.

- [ ] **Step 1: Write failing core tests**

Pin:

- exact quick parity reports `graph_canary.status = 'exact'` but authoritative source remains legacy;
- remote timeout/error returns legacy with `status = 'fallback'`;
- unknown/duplicate IDs or record/pattern mismatch return legacy fallback;
- `standard`/`deep` never call `fetchCandidatePool` and report `legacy-only`;
- successful and failed quick shadows call `recordUsageFn` exactly once with legacy-selected records;
- `recordUsageEnabled=false` calls it zero times.

- [ ] **Step 2: Run focused core tests and verify RED**

Run: `node --test tests/reference-graph/p9-runtime-canary.test.mjs`
Expected: FAIL with module missing.

- [ ] **Step 3: Implement the canary core**

Compute legacy first, then shadow quick only. Execute the unchanged P7 policy and P8 hydration/pattern logic. Catch graph-side failures into diagnostics without changing the authoritative legacy result.

- [ ] **Step 4: Write CLI tests**

Pin required request args, quick/standard/deep behavior, environment resolution (`SUPABASE_PUBLISHABLE_KEY` first, compatibility `SUPABASE_ANON_KEY` second), `--strict-canary`, `--no-record-usage`, and absence of service-role environment names.

- [ ] **Step 5: Implement the CLI**

The CLI must not import or modify production `query.mjs`; it is a separate explicit canary entry point.

- [ ] **Step 6: Run both focused suites**

Run: `node --test tests/reference-graph/p9-runtime-canary*.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

Commit: `feat: add reversible P9 shadow canary`

---

### Task 4: Add the P9 receipt and evidence contract

**Files:**
- Create: `reference-graph/p9-receipt.mjs`
- Create: `tests/reference-graph/p9-receipt.test.mjs`

**Interfaces:**
- Produces `createP9Receipt`, `recordP9Phase`, `finalizeP9Receipt`, `assertSecretFreeP9Receipt`.
- P9 phases: `preflight`, `migration`, `transport`, `canary`.

- [ ] **Step 1: Write failing receipt tests**

Final receipt may set `least_privilege_transport_ready=true` only when:

- migration/grants prove the P9 wrapper is narrow;
- service role is absent from canary transport;
- current pool is complete/equivalent;
- quick 24/24 record and pattern shadow parity passes;
- fallback and standard/deep no-network tests pass.

It may set `quick_shadow_canary_ready=true` under the same conditions, but must always set:

```text
production_activation_ready=false
production_source=legacy-control
activation_performed=false
```

Secret scan must reject service-role keys/tokens and publishable-key values passed as explicit forbidden values.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/reference-graph/p9-receipt.test.mjs`
Expected: FAIL with module missing.

- [ ] **Step 3: Implement receipt**

Follow the terminal/fail-closed structure of P8 receipt; distinguish canary readiness from activation readiness.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/reference-graph/p9-receipt.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat: add P9 runtime canary receipt`

---

### Task 5: Make least-privilege runtime safety permanent in governance

**Files:**
- Modify: `.github/workflows/verify-reference-graph.yml`
- Modify: `reference-graph/README.md`
- Create: `tests/reference-graph/p9-ci-contract.test.mjs`

**Interfaces:**
- Permanent governance consumes migration 008, P9 receipt, runtime client/canary, and immutable P8 evidence.

- [ ] **Step 1: Write failing CI-contract tests**

Require permanent workflow checks for:

- migrations `001→008`;
- immutable P8 evidence and exact `query.mjs` blob;
- optional P9 evidence through `assertSecretFreeP9Receipt`;
- no `SUPABASE_SERVICE_ROLE_KEY`, `ReferenceGraphSupabaseStore`, or direct P7/P6 operator imports in P9 runtime client/canary surfaces;
- migration 008 zero-arg wrapper;
- `anon` and `authenticated` can execute only P9 wrapper;
- `anon` cannot execute P7 pool, P6 RPCs, embedding coverage, ingest, verification, or embedding-write RPCs;
- `anon` cannot directly select Reference Graph tables;
- service-role historical access remains unchanged.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/reference-graph/p9-ci-contract.test.mjs`
Expected: FAIL until permanent workflow/docs are extended.

- [ ] **Step 3: Extend permanent workflow**

Use a fresh pgvector database with fixtures relative to `current_date`; execute `001→008`; prove wrapper output equals P7 output for the same current-date pool and prove all negative grants.

- [ ] **Step 4: Update README**

Document P9 shadow-only usage, publishable-key boundary, fallback behavior, and explicit non-activation.

- [ ] **Step 5: Run full Reference Graph governance**

Run: permanent PR workflow.
Expected: all Reference Graph steps green. Release Governance may remain red only for inherited `write-swift skill must exist`.

- [ ] **Step 6: Commit**

Commit: `ci: enforce P9 least privilege runtime boundary`

---

### Task 6: Verify the clean implementation head and scope

**Files:**
- No intended durable files beyond Tasks 1–5.

- [ ] **Step 1: Run full Reference Graph suite**

Run: `node --test tests/reference-graph/*.test.mjs`
Expected: PASS.

- [ ] **Step 2: Run design-reference library regression**

Run: `node --test knowledge/design-references/tests/library.test.mjs`
Expected: PASS.

- [ ] **Step 3: Run tree secret scan**

Run: `python3 skills/security-review-redirect/scripts/scan_secrets.py reference-graph`
Expected: no common secret patterns.

- [ ] **Step 4: Review P8→P9 diff**

Verify:

- `query.mjs` blob remains `4963cfbaf4306a03084f4513a1e324f649ce36e5`;
- no catalog JSONL, freshness/TTL/status/access, P7 ranking, embedding, relation, or production-routing change;
- only migration 008 grants new runtime access;
- no service-role credential path appears in P9 runtime code.

- [ ] **Step 5: Freeze clean implementation SHA**

Bind live evidence only after permanent governance is green on this exact clean head.

---

### Task 7: Deploy migration 008 and produce live shadow-canary evidence

**Files:**
- Create: `reference-graph/evidence/p9-runtime-canary-evidence.json`
- Modify no production runtime files.

- [ ] **Step 1: Verify target and migration state**

Target must be `vrznfnxzlxaavpqbzbzd / agent-hub-reference-graph / eu-central-1 / ACTIVE_HEALTHY`. If migration 008 is absent, apply exactly the committed migration once and record migration history/hash. If already present, verify definition/hash instead of replaying it.

- [ ] **Step 2: Verify live grants and negative privileges**

Prove `anon`/`authenticated` wrapper execution, P7/P6/write denial, no direct table access, service-role historical access unchanged, and no WARN/ERROR security advisor regression attributable to P9.

- [ ] **Step 3: Verify live current pool equivalence**

Canonicalize all 15 fields for the live P9 wrapper pool and committed/offline P8/P7 pool. Require 275 candidates, 275 metadata-complete, 275 unique legacy IDs, and equal canonical hashes.

- [ ] **Step 4: Exercise live HTTP transport if a publishable key is available through a trusted runtime**

Run the actual `p9-runtime-client.mjs` against PostgREST without `service_role`, verify candidate count/hash and transport latency. Do not commit the key. If a trusted publishable-key runtime is unavailable, record `live_http_transport_verified=false` as a P9 receipt blocker rather than weakening the requirement.

- [ ] **Step 5: Run 24/24 quick shadow canaries**

Use the live P9 pool plus the unchanged P7 policy/P8 hydration. Require 24/24 ordered record parity and 24/24 pattern parity. Record latency and fallback/no-network regression evidence.

- [ ] **Step 6: Build canonical P9 receipt**

Generate through `createP9Receipt → recordP9Phase → finalizeP9Receipt`; run `assertSecretFreeP9Receipt`. Production activation must remain false regardless of canary readiness.

- [ ] **Step 7: Commit durable evidence**

Commit: `evidence: record P9 runtime canary decision`

- [ ] **Step 8: Run final governance on evidence head**

Expected: Reference Graph governance green. Release Governance may remain inherited-red only at `write-swift skill must exist`.

- [ ] **Step 9: Update the stacked draft PR**

Document final SHAs, target/grants, live HTTP verification state, 24/24 parity, receipt decision, and stop boundary. Keep draft/open/unmerged.

## P9 Stop Boundary

P9 stops after least-privilege transport and shadow-canary evidence. Even if every P9 gate passes:

```text
production_activation_ready = false
production_source = legacy-control
activation_performed = false
```

A later phase must separately authorize and implement a reversible **quick-only serving canary** before production routing changes.
