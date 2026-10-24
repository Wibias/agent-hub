# Reference Graph P10 — Least-Privilege Runtime Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace P9's publicly executable `SECURITY DEFINER` runtime RPC with an RLS-backed, read-only current-date projection that preserves exact quick shadow-canary parity under a Supabase publishable key and clears the P9 security-advisor WARN findings.

**Architecture:** Migration 009 closes public execution of the P9 wrapper, creates one public projection table with current-date RLS, and creates one service-role-only refresh RPC that atomically rebuilds the projection from the certified P7 pool. A new P10 HTTP client reads the projection with a publishable key; the existing P9 shadow-canary logic remains the behavior oracle so no ranking/canary semantics are redefined.

**Tech Stack:** Node.js 24 ESM, PostgreSQL/Supabase, PostgREST, Row Level Security, `node:test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-24-reference-graph-p10-runtime-projection-design.md`

## Global Constraints

- Final P9 base is `535a0f9e5354ba53493fc581d0eb5a60fca04e05`.
- Production source remains `legacy-control`; P10 performs no activation.
- `knowledge/design-references/scripts/query.mjs` remains byte-identical.
- P7 quick parity policy and P9 shadow-canary semantics remain unchanged.
- Standard/deep remain legacy-only and make no graph network request.
- Publishable-key callers receive no direct `reference_graph.*` table privileges.
- P9 runtime wrapper must no longer be executable by `anon` / `authenticated` after migration 009.
- P10 runtime roles receive SELECT-only projection access through RLS; no runtime write grants.
- P10 refresh authority is service-role-only.
- Current-date snapshot is mandatory; missing/stale projection fails closed to legacy.
- Security Advisor WARN/ERROR findings attributable to P9/P10 runtime surfaces must be zero.
- No advisor suppression/allowlist is accepted.
- No catalog/freshness/TTL/review/access/embedding/relation mutation.

## Review Focus

1. **Stale projection:** a previous-day projection must return no usable runtime candidates and the canary must fall back to legacy. Task 2 pins client validation; Task 1 pins RLS invisibility.
2. **Runtime write attempt:** `anon` / `authenticated` must fail INSERT/UPDATE/DELETE even though they can SELECT current rows. Task 1 DB smoke pins this.
3. **Refresh privilege escalation:** `anon` / `authenticated` must not execute the P10 refresh RPC, while `service_role` can. Task 1 pins grants.
4. **Projection drift:** refresh output must contain the complete P7 candidate fields with unique asset/legacy IDs and preserve canonical pool parity. Tasks 1 and 5 pin this.
5. **Transport failure/empty snapshot:** network errors, malformed JSON, duplicate IDs, empty current snapshot, or date mismatch must never disturb the authoritative legacy result. Tasks 2 and 3 pin this.

---

### Task 1: Migration 009 — RLS Runtime Projection

**Files:**
- Create: `reference-graph/schema/009_reference_graph_runtime_projection.sql`
- Create: `tests/reference-graph/p10-runtime-projection-sql.test.mjs`

**Interfaces:**
- Consumes: `public.reference_graph_quick_candidate_pool_p7(jsonb)` from migration 007 and historical P9 wrapper from migration 008.
- Produces:
  - table `public.reference_graph_quick_runtime_projection_p10`
  - service-role-only function `public.reference_graph_refresh_quick_runtime_projection_p10()`
  - closed P9 runtime grants for `anon` / `authenticated`.

- [ ] **Step 1: Write the failing migration-contract tests**

Pin:

- migration 009 exists;
- projection has exactly the 15 P7 candidate columns plus `snapshot_date` and `refreshed_at`;
- RLS is enabled;
- SQL grants SELECT only to `anon, authenticated`;
- SELECT policy requires `snapshot_date = current_date`;
- P9 wrapper execute is revoked from `anon, authenticated`;
- P10 refresh RPC is `SECURITY DEFINER`, no-argument/current-date-only, and granted only to `service_role`;
- refresh inserts from `reference_graph_quick_candidate_pool_p7(jsonb_build_object('reference_date', current_date::text))`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

`node --test tests/reference-graph/p10-runtime-projection-sql.test.mjs`

Expected: FAIL because migration 009 does not exist.

- [ ] **Step 3: Implement migration 009**

Use one atomic refresh function: delete/replace the prior snapshot and insert the certified P7 current-date pool with one shared refresh timestamp.

- [ ] **Step 4: Add fresh-Postgres runtime privilege smoke**

On migrations `001→009`, assert:

- service role refresh returns a non-empty summary;
- anon/auth SELECT current rows succeeds;
- previous-day rows are hidden by RLS;
- anon/auth INSERT/UPDATE/DELETE fail;
- anon/auth P9 wrapper execution fails;
- anon/auth P10 refresh execution fails;
- service-role refresh succeeds;
- P6/P7/operator grants remain closed.

- [ ] **Step 5: Run focused + full Reference Graph tests**

Run:

`node --test tests/reference-graph/p10-runtime-projection-sql.test.mjs`

then

`node --test tests/reference-graph/*.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message:

`feat: add RLS runtime projection for quick graph pool`

---

### Task 2: Publishable-Key Projection Client

**Files:**
- Create: `reference-graph/p10-runtime-client.mjs`
- Create: `tests/reference-graph/p10-runtime-client.test.mjs`

**Interfaces:**
- Consumes: PostgREST table surface `reference_graph_quick_runtime_projection_p10`.
- Produces:

```js
fetchP10QuickCandidatePool({
  supabaseUrl,
  publishableKey,
  fetchImpl = fetch,
  timeoutMs = 1500,
  expectedDate,
}) -> Promise<{ candidates, transport }>
```

- [ ] **Step 1: Write failing client tests**

Pin:

- GET, never RPC POST;
- only `apikey` runtime credential;
- deterministic `asset_id` ordering;
- expected-date filter in URL;
- valid current snapshot succeeds;
- empty pool fails closed;
- stale/date-mismatched row fails;
- duplicate asset or legacy IDs fail;
- malformed JSON / non-2xx / timeout fail;
- source contains no `SUPABASE_SERVICE_ROLE_KEY` or service-role parameter.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

`node --test tests/reference-graph/p10-runtime-client.test.mjs`

Expected: module missing.

- [ ] **Step 3: Implement the minimal client**

Do not add retry logic or fallback selection here; this module only validates transport. Canary fallback remains in the existing P9 canary behavior.

- [ ] **Step 4: Run focused + P9/P10 transport tests**

Run:

`node --test tests/reference-graph/p9-runtime-client.test.mjs tests/reference-graph/p10-runtime-client.test.mjs`

Expected: PASS with P9 historical behavior unchanged.

- [ ] **Step 5: Commit**

Commit message:

`feat: add publishable runtime projection client`

---

### Task 3: P10 Canary Operator and Receipt

**Files:**
- Create: `reference-graph/p10-receipt.mjs`
- Create: `reference-graph/cli/p10-runtime-canary.mjs`
- Create: `tests/reference-graph/p10-receipt.test.mjs`
- Create: `tests/reference-graph/p10-runtime-canary-cli.test.mjs`

**Interfaces:**
- Consumes:
  - `fetchP10QuickCandidatePool(...)`
  - existing `runP9ShadowCanary(...)` behavior oracle
  - target binding helpers.
- Produces:
  - `reference-graph.p10-runtime-projection.v1` receipt;
  - read-only quick shadow-canary CLI using P10 transport.

Receipt fields must include:

- target + P9 base SHA + P10 implementation SHA;
- projection migration identity;
- snapshot date / candidate count / canonical hash;
- runtime privilege/advisor result;
- 24-case record/pattern canary summary;
- fallback verification;
- `least_privilege_transport_ready`;
- `quick_shadow_canary_ready`;
- `production_activation_ready: false`;
- `production_source: legacy-control`;
- `activation_performed: false`.

- [ ] **Step 1: Write failing receipt tests**

Pin terminal decision logic:

- security/advisor WARN ⇒ least-privilege false;
- stale/missing projection ⇒ canary false;
- 24/24 exact + clean security ⇒ transport/canary ready;
- production activation always false in P10;
- credential-shaped fields are rejected by secret scan.

- [ ] **Step 2: Write failing CLI tests**

Pin:

- quick uses P10 transport + existing P9 shadow-canary logic;
- standard/deep make no fetch;
- publishable key is accepted but never emitted;
- strict mode may return non-zero on canary failure without changing authoritative records;
- no service-role environment variable is consumed.

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

`node --test tests/reference-graph/p10-receipt.test.mjs tests/reference-graph/p10-runtime-canary-cli.test.mjs`

- [ ] **Step 4: Implement receipt + CLI minimally**

Reuse `runP9ShadowCanary()` directly; do not fork its ranking/hydration/pattern logic.

- [ ] **Step 5: Run P9/P10 canary regression suite**

Run:

`node --test tests/reference-graph/p9-runtime-canary*.test.mjs tests/reference-graph/p10-*.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message:

`feat: add P10 projection canary evidence contract`

---

### Task 4: Permanent Governance and Documentation

**Files:**
- Modify: `.github/workflows/verify-reference-graph.yml`
- Create: `tests/reference-graph/p10-ci-contract.test.mjs`
- Modify: `reference-graph/README.md`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: permanent P10 CI gate before any live activation review.

- [ ] **Step 1: Write failing CI contract test**

Require permanent workflow to:

- scan optional P10 evidence with `assertSecretFreeP10Receipt()`;
- preserve immutable P3–P9 evidence;
- execute migrations `001→009`;
- run P10 projection/grant/RLS smoke;
- assert P9 runtime wrapper is closed after migration 009;
- assert production `query.mjs` blob remains pinned;
- reject service-role references in P10 runtime/client/CLI;
- keep standard/deep legacy-only.

- [ ] **Step 2: Run CI-contract test and confirm RED**

- [ ] **Step 3: Extend permanent governance + README**

Do not remove P9 historical tests; update live post-migration expectations to reflect P10 closing the P9 public grant.

- [ ] **Step 4: Run full Reference Graph governance on branch head**

Expected: all Reference Graph tests, secret scans, immutable evidence checks, migrations `001→009`, P4/P6/P7/P9/P10 smokes green.

- [ ] **Step 5: Commit**

Commit message:

`ci: verify P10 runtime projection security`

---

### Task 5: Dedicated Supabase Projection + Live Canary Evidence

**Files:**
- Create: `reference-graph/evidence/p10-runtime-projection-evidence.json`
- Temporary execution artifacts/workflows are allowed only during measurement and must be removed before final verification.

**Interfaces:**
- Consumes: final tested P10 implementation SHA, migration 009, P10 client/CLI/receipt.
- Produces: canonical secret-free P10 evidence; no production routing change.

- [ ] **Step 1: Freeze implementation SHA and target**

Require permanent Reference Graph governance green before live DDL.

Target:

`vrznfnxzlxaavpqbzbzd / agent-hub-reference-graph / eu-central-1`

- [ ] **Step 2: Apply migration 009**

Immediately verify:

- projection table + RLS/policy;
- P9 anon/auth execute revoked;
- P10 refresh service-role-only;
- no unrelated grants changed.

- [ ] **Step 3: Refresh current projection through service-role-only path**

Record snapshot date, refresh time, candidate count, metadata-complete count, unique legacy IDs, and canonical pool hash.

Require equality with the current certified/offline P7 pool before canary execution.

- [ ] **Step 4: Run live publishable-key transport probe**

Verify normal HTTP GET from the P10 client, no service-role credential, current snapshot only.

- [ ] **Step 5: Run all 24 quick shadow-canary cases**

Require:

- 24/24 exact ordered records;
- 24/24 exact ordered patterns;
- 0 mismatches;
- 24/24 legacy authoritative.

Also execute failure-path fixtures for stale/empty projection, malformed payload, standard/deep no-network behavior.

- [ ] **Step 6: Run Supabase Security Advisor after DDL/refresh**

Gate on zero P9/P10-attributable WARN/ERROR findings. Do not whitelist the old P9 warnings.

- [ ] **Step 7: Generate canonical P10 receipt**

Use `create/finalize/assertSecretFree` P10 receipt code, bind tested implementation SHA and live evidence, and keep:

`production_activation_ready = false`

`production_source = legacy-control`

`activation_performed = false`

- [ ] **Step 8: Commit only durable evidence**

Remove all temporary live-run helpers before commit.

Commit message:

`evidence: record P10 runtime projection safety`

---

### Task 6: Final Verification, Review, and PR Update

**Files:**
- No planned production-code changes; only fixes from verified review findings.

- [ ] **Step 1: Run permanent Reference Graph governance on final evidence head**

Require complete green result.

- [ ] **Step 2: Confirm inherited Release Governance status separately**

If it remains red at `Test catalog discovery audit / write-swift skill must exist`, record it as inherited and do not repair it in P10.

- [ ] **Step 3: Whole-branch P9→P10 scope review**

Confirm:

- no temporary workflows/files;
- no production `query.mjs` change;
- no catalog/freshness/TTL/review/access mutation;
- no P7 scoring/ranking change;
- no public `SECURITY DEFINER` runtime entry point;
- no service-role runtime client path;
- no activation/routing change.

- [ ] **Step 4: Update stacked Draft PR P10 → P9**

Document final SHAs, governance runs, advisor state, projection hash, canary parity, receipt decision, and inherited release failure.

Keep PR **draft, open, unmerged**.

- [ ] **Step 5: Stop at P10 boundary**

If P10 is green, report runtime transport/canary readiness only. A later phase must explicitly decide production activation and refresh operations.