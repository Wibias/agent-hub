# Reference Graph P11 Quick Runtime Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the P10 least-privilege projection into the real design-reference query entrypoint as a reversible, opt-in, quick-only graph authority path that is allowed to win only under exact record-and-pattern parity with the existing legacy result.

**Architecture:** A new focused runtime router computes the legacy result first, optionally evaluates the P10 publishable-key candidate pool for `quick`, and switches authority only when ordered records and ordered patterns are exactly equal. `query.mjs` remains the sole production CLI and prints the same JSON contract as before; standard/deep and all failures stay legacy. P11 adds activation-readiness evidence but deliberately leaves the repository default off.

**Tech Stack:** Node.js 24 ESM, existing design-reference selectors, P7 parity policy, P8 hydration, P10 REST/RLS client, Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-24-reference-graph-p11-quick-runtime-router-design.md`

## Global Constraints

- P10 final base is `43a81a3fb2ee42e083c7ca4bf6d132663c54d51d` and remains immutable.
- Production CLI stays `knowledge/design-references/scripts/query.mjs`; no second production command.
- Graph activation is requested only by exact `REFERENCE_GRAPH_QUICK_RUNTIME=graph`.
- Missing or any other activation value means legacy and zero graph network calls.
- `standard` and `deep` remain legacy-only and zero-network regardless of activation flag.
- Runtime graph transport uses only `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY`; service-role names/credentials are forbidden in P11 runtime code.
- P10 transport timeout remains 1500 ms.
- Graph authority requires exact ordered record IDs **and** exact ordered pattern IDs for the same request.
- Any graph transport, validation, hydration, selection, or parity failure returns the ordinary legacy result.
- Public `query.mjs` JSON keys and coverage-based exit semantics do not change.
- Usage is recorded exactly once against the authoritative returned records.
- No P7 ranking/scoring change and no catalog/projection/database mutation.
- P11 does not enable graph mode globally, merge the PR, or mark it ready.

## Review Focus

- An unknown activation flag value must not accidentally enable network access; Task 1 pins exact `graph` matching and zero fetch otherwise.
- A graph result with exact records but different patterns must remain legacy; Task 1 pins record-and-pattern parity separately.
- A usage-write error after an exact graph decision must not cause a second legacy write or change records; Task 1 pins exactly-once usage and non-fatal warning behavior.
- `standard` / `deep` with graph credentials present must still make zero fetches; Tasks 1 and 2 pin profile isolation at router and production-CLI boundaries.
- A current projection that contains an unknown local legacy ID must fail closed rather than returning partial graph output; Task 1 pins hydration failure fallback.

---

### Task 1: Pure Quick Runtime Authority Router

**Files:**
- Create: `reference-graph/p11-runtime-router.mjs`
- Test: `tests/reference-graph/p11-runtime-router.test.mjs`

**Interfaces:**
- Consumes:
  - `selectRecords(records, request)`
  - `selectPatterns(patterns, selected, request)`
  - `selectP7ParityLexicalResults({ candidates, request, maxItems })`
  - `hydrateP8LegacyIds({ records, legacyIds })`
  - `recordUsage(selected, request)` as default usage writer.
- Produces:
  - `runP11RuntimeQuery({ records, patterns, request, graphMode = 'legacy', fetchCandidatePool, recordUsageFn = recordUsage, recordUsageEnabled = true }) -> Promise<{ result, routing }>`
  - `result` is the existing public query result fields only.
  - `routing` contains `{ requested_mode, attempted, authoritative_source, record_exact, pattern_exact, reason }` and no remote error text.

- [ ] **Step 1: Write failing router tests**

Add tests asserting:

- default/missing mode returns legacy result and never calls `fetchCandidatePool`;
- any mode other than exact `graph` returns legacy and never fetches;
- `standard` and `deep` never fetch even with `graph` mode;
- quick graph exact ordered records + patterns sets `routing.authoritative_source === 'reference-graph'` and returns hydrated graph records/patterns;
- exact records but pattern mismatch returns legacy with reason `handoff-mismatch`;
- record mismatch returns legacy;
- transport throw, malformed candidate response, and unknown hydration ID all return the same legacy record/pattern IDs without surfacing the raw error;
- usage writer is called exactly once with the final authoritative records;
- usage writer failure is non-fatal and yields the existing usage warning text;
- `recordUsageEnabled: false` performs zero usage writes;
- public `result` keys are exactly `profile, requested, countsByStratum, coverage, coverageGaps, requiresTargetedResearch, usageWarning, records, patterns`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/reference-graph/p11-runtime-router.test.mjs`

Expected: FAIL only because `reference-graph/p11-runtime-router.mjs` does not exist.

- [ ] **Step 3: Implement `runP11RuntimeQuery(...)`**

Implementation decisions pinned by the spec:

- compute legacy selection/patterns before graph work;
- graph attempt only for `request.profile === 'quick' && graphMode === 'graph'`;
- missing/non-function fetcher is a bounded `missing-runtime-config` fallback, not an exception to caller;
- graph selection uses P7 policy, local hydration uses P8 helper, pattern selection uses the existing pattern selector;
- exact ordered IDs on both records and patterns are required;
- catch all graph-side errors and expose only bounded reason `graph-runtime-error`;
- record usage once after authority decision;
- use the existing warning wording from production query for usage failure.

- [ ] **Step 4: Run focused + full Reference Graph tests**

Run:

```bash
node --test tests/reference-graph/p11-runtime-router.test.mjs
node --test tests/reference-graph/*.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add reference-graph/p11-runtime-router.mjs tests/reference-graph/p11-runtime-router.test.mjs
git commit -m "feat: add reversible P11 quick runtime router"
```

---

### Task 2: Integrate the Existing Production Query CLI

**Files:**
- Modify: `knowledge/design-references/scripts/query.mjs`
- Test: `tests/reference-graph/p11-query-cli.test.mjs`

**Interfaces:**
- Consumes:
  - `runP11RuntimeQuery(...)` from Task 1.
  - `fetchP10QuickCandidatePool({ supabaseUrl, publishableKey, fetchImpl, timeoutMs, expectedDate })`.
- Produces:
  - existing `query.mjs` command with unchanged public JSON and exit semantics;
  - activation env `REFERENCE_GRAPH_QUICK_RUNTIME`;
  - transport env `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`.

- [ ] **Step 1: Write failing CLI contract tests**

Tests must assert:

- production CLI delegates selection/usage to `runP11RuntimeQuery` rather than calling `selectRecords`/`recordUsage` directly;
- default execution of a real quick fixture with `--no-record-usage` and no activation env returns the same JSON keys, ordered record IDs, pattern IDs, and exit code as a direct legacy `selectRecords` + `selectPatterns` calculation;
- standard and deep CLI invocations ignore graph activation/config and remain legacy-only;
- activation is exact-string only (`graph`);
- the graph fetch closure is created only when quick + graph + non-empty URL/key are present;
- P10 fetch uses `timeoutMs: 1500` and current UTC `YYYY-MM-DD` as `expectedDate`;
- source does not reference `SUPABASE_SERVICE_ROLE_KEY` or `service_role`;
- router `routing` metadata is not printed in public JSON.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/reference-graph/p11-query-cli.test.mjs`

Expected: FAIL because production CLI still directly runs legacy selection.

- [ ] **Step 3: Modify `query.mjs` minimally**

Keep argument/profile/limit validation. Load records/patterns once, build the existing request, create an optional P10 fetch closure only under the exact quick graph configuration, call `await runP11RuntimeQuery(...)`, print only `result`, and set exit code from `result.coverageGaps.length`.

Do not add source/routing/debug fields to output.

- [ ] **Step 4: Run focused + design-reference regression tests**

Run:

```bash
node --test tests/reference-graph/p11-query-cli.test.mjs
node --test knowledge/design-references/tests/*.test.mjs
node --test tests/reference-graph/*.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add knowledge/design-references/scripts/query.mjs tests/reference-graph/p11-query-cli.test.mjs
git commit -m "feat: wire opt-in P11 quick routing into production query"
```

---

### Task 3: Activation-Readiness Receipt

**Files:**
- Create: `reference-graph/p11-receipt.mjs`
- Test: `tests/reference-graph/p11-receipt.test.mjs`

**Interfaces:**
- Produces:
  - `createP11Receipt({ binding, baseSha, gitSha, verificationAt, referenceTime })`
  - `recordP11Phase(receipt, { phase, status, detail, error })`
  - `finalizeP11Receipt(receipt, { defaultOff, liveActivatedCanary, fallbackVerification, profileIsolation, security, blockers })`
  - `assertSecretFreeP11Receipt(receipt)`
- Required phases: `preflight`, `router`, `live_canary`, `rollback`.

- [ ] **Step 1: Write failing receipt tests**

Pin:

- schema `reference-graph.p11-activation-readiness.v1`;
- production source defaults to `legacy-control` and `activation_performed` remains false;
- `quick_activation_ready` can become true only when all four phases succeed, default-off is verified, 24/24 activated canary record+pattern exactness passes, fallback matrix passes, standard/deep no-network passes, publishable transport is used, and P10-attributable advisor WARN/ERROR count is zero;
- `repository_default_graph_enabled` must remain false;
- any blocker, missing phase, service-role runtime mode, mismatch, fallback failure, or standard/deep network use forces false;
- secret scanner rejects publishable/service keys, bearer/JWT-like values, passwords, and raw authorization headers anywhere in receipt.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/reference-graph/p11-receipt.test.mjs`

Expected: FAIL on missing module.

- [ ] **Step 3: Implement the terminal receipt contract**

Use the existing P8–P10 receipt style: fail closed, clone on phase updates, preserve bounded public evidence only, and never infer readiness from a single boolean when structural counts are available.

- [ ] **Step 4: Run focused + full tests**

Run:

```bash
node --test tests/reference-graph/p11-receipt.test.mjs
node --test tests/reference-graph/*.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add reference-graph/p11-receipt.mjs tests/reference-graph/p11-receipt.test.mjs
git commit -m "feat: add P11 activation readiness receipt"
```

---

### Task 4: Permanent P11 Governance and Documentation

**Files:**
- Modify: `.github/workflows/verify-reference-graph.yml`
- Modify: `reference-graph/README.md`
- Create: `tests/reference-graph/p11-ci-contract.test.mjs`

**Interfaces:**
- Consumes P10 durable evidence and P11 runtime/router/receipt contracts.
- Produces permanent CI guarantees for the P11 activation mechanism while keeping default production legacy.

- [ ] **Step 1: Write failing P11 CI-contract tests**

Require the permanent workflow to:

- secret-scan `reference-graph/evidence/p11-quick-activation-evidence.json` with `assertSecretFreeP11Receipt` when present;
- pin immutable P10 evidence: least-privilege ready, quick shadow ready, activation false, blockers empty, 275 projection rows, 24/24 canary, zero advisor WARN/ERROR;
- statically forbid shadow-case IDs / expected benchmark outputs in `p11-runtime-router.mjs` and production `query.mjs`;
- statically forbid service-role runtime credential names in P11 router/query/runtime client path;
- run a production default-off quick query and compare ordered records/patterns to direct legacy selection;
- run standard/deep with graph activation env and a network sentinel proving zero fetches;
- keep P10 migration/RLS/P9-closure smokes intact.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/reference-graph/p11-ci-contract.test.mjs`

Expected: FAIL because P11 governance steps are absent.

- [ ] **Step 3: Extend permanent governance and README**

Do not delete or rename historical security gates. Add P11-only checks after immutable P10 verification. Document activation flag, default-off behavior, fail-closed semantics, and operator-only nature of future activation.

- [ ] **Step 4: Run full permanent governance**

Expected:

- all Reference Graph tests green;
- secret scans green;
- P3–P10 immutable gates green;
- migrations 001–009 green;
- P4/P6/P7/P9/P10 DB smokes green;
- P11 default-off/profile-isolation gates green.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/verify-reference-graph.yml reference-graph/README.md tests/reference-graph/p11-ci-contract.test.mjs
git commit -m "ci: govern P11 reversible quick activation"
```

---

### Task 5: Full Verification and Controlled Live Activation Canary

**Files:**
- No permanent production-code change expected.
- Temporary isolated workflow/branch allowed for publishable-key execution; it must not remain in the P11 PR tree.

**Interfaces:**
- Uses production `query.mjs`, P10 projection transport, and the exact P11 activation flag.
- Produces bounded live evidence inputs for Task 6.

- [ ] **Step 1: Freeze and verify the implementation SHA**

Run the complete permanent Reference Graph governance and the design-reference library tests on the clean P11 implementation head. Record the successful run ID and SHA.

- [ ] **Step 2: Verify live P10 prerequisites read-only**

On `vrznfnxzlxaavpqbzbzd` verify:

- target `ACTIVE_HEALTHY`;
- migration 009 remains present;
- current P10 projection has 275 rows for current UTC snapshot date;
- P10 projection/source equivalence remains true;
- Security Advisor P9/P10 WARN/ERROR count remains zero.

No DDL or projection refresh is part of P11 unless the snapshot is legitimately absent/stale; if refresh is required, use only the existing service-role-only P10 refresh RPC and record that operator action explicitly.

- [ ] **Step 3: Run a default-off production query matrix**

For all 24 frozen quick cases invoke the actual production `query.mjs` with no activation flag and no record-usage. Record that all remain legacy-equivalent and no graph transport is attempted.

- [ ] **Step 4: Run a controlled activated production query matrix**

In an isolated Actions branch using only a publishable key, set `REFERENCE_GRAPH_QUICK_RUNTIME=graph` and invoke the actual production `query.mjs` for all 24 cases. Compare public JSON to paired default-off outputs.

Require:

- 24/24 ordered record IDs exact;
- 24/24 ordered pattern IDs exact;
- 24/24 coverage/exit semantics exact;
- zero credential/raw transport data in artifact.

Because public JSON intentionally hides routing metadata, the same workflow must also call `runP11RuntimeQuery` with the production transport to prove `authoritative_source === 'reference-graph'` for all 24 activated cases.

- [ ] **Step 5: Run live rollback/fallback probes**

In the isolated runner prove:

- intentional transport failure returns paired legacy output;
- missing key returns paired legacy output with zero fetch;
- stale/empty/malformed payload returns paired legacy output;
- standard/deep perform zero fetch even with activation env;
- usage spy is called exactly once in activated exact and fallback cases.

- [ ] **Step 6: Remove every temporary workflow/branch file from P11 tree**

The P11 PR must contain no publishable key, no live-run workflow, and no temporary artifact file.

---

### Task 6: Canonical P11 Evidence, Whole-Branch Review, and Draft PR Update

**Files:**
- Create: `reference-graph/evidence/p11-quick-activation-evidence.json`
- Modify only if needed for durable documentation: `reference-graph/README.md`

**Interfaces:**
- Consumes Task 5 run IDs/counts/digests plus `p11-receipt.mjs`.
- Produces final P11 durable evidence while leaving activation default off.

- [ ] **Step 1: Generate receipt through production receipt code**

Use actual `createP11Receipt → recordP11Phase → finalizeP11Receipt → assertSecretFreeP11Receipt`. Do not hand-write a receipt-like JSON.

The final receipt may report `quick_activation_ready: true`, but must preserve:

- `repository_default_graph_enabled: false`;
- `production_source: legacy-control` for the repository default;
- `activation_performed: false` as the durable repository state;
- `standard: legacy-only` and `deep: legacy-only`.

- [ ] **Step 2: Commit only secret-free durable evidence**

No publishable key, Authorization header, raw response header, or temporary workflow may enter the P11 tree.

- [ ] **Step 3: Run fresh permanent governance on the evidence head**

Require Reference Graph governance success on exactly the final evidence head. Treat the inherited `write-swift skill must exist` Release Governance failure separately and do not repair it in P11.

- [ ] **Step 4: Whole-branch review P10 → P11**

Verify:

- only planned router/query/receipt/governance/docs/tests/evidence surfaces changed;
- no DDL, catalog, freshness, TTL, review, access, embedding, or ranking changes;
- no service-role runtime path;
- default graph activation is off;
- standard/deep remain no-network legacy-only;
- public query JSON schema and exit semantics remain unchanged;
- no temporary live workflow/key/artifact exists in the PR tree.

- [ ] **Step 5: Update stacked Draft PR**

PR base: `agent/reference-graph-p10`.

Document tested implementation SHA, final evidence SHA, governance run, controlled live canary results, rollback/fallback proof, and the explicit statement that P11 creates an activation-ready mechanism but **does not globally activate it**.

Keep PR draft/open/unmerged.
