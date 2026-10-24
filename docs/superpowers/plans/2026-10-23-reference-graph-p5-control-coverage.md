# Reference Graph P5 Control Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing quick-profile legacy selector constructively satisfy its declared surface/platform coverage contract when feasible, then collect current-date comparable live Reference Graph evidence without changing production routing.

**Architecture:** Add a small benchmark-independent quick-coverage feasibility helper beside the legacy selector and use it only to reject greedy choices that would make already-declared quick coverage minima impossible to complete. Keep standard/deep behavior unchanged, keep P4 freshness decisions untouched, and gate all P5 live lexical/semantic/hybrid evaluation behind a healthy current legacy control plus exact pinned-model embedding completeness. P5 produces terminal secret-free evidence but never performs cutover.

**Tech Stack:** Node.js 24 ESM, `node:test`, existing design-reference selector/catalog, existing Reference Graph shadow/evaluation/store modules, PostgreSQL/Supabase pgvector target `vrznfnxzlxaavpqbzbzd`, GitHub Actions governance.

**Spec:** `docs/superpowers/specs/2026-10-23-reference-graph-p5-control-coverage-design.md`

## Global Constraints

- Base exactly on P4 evidence head `4621574eca88f30296452b25fcb04be3a496d7d5`.
- Production source remains exactly `legacy-control`; P5 performs no production cutover.
- P4's 275 reviewed/fresh versus 325 stale split is authority input, not a target to manipulate.
- Do not change `lastVerifiedAt`, TTL, review status, surface family, platform, or catalog contents to improve P5 scores.
- Quick coverage minima remain the existing contract: requested surface minimum `1`; requested platform minimum `ceil(limit / 2)`.
- Standard/deep selection behavior must remain unchanged.
- Selector implementation must not import/read `reference-graph/shadow-cases.json`, shadow case IDs, expected IDs, or historical quality scores.
- Existing cutover thresholds remain unchanged: `20` cases, `20` comparable, overlap `0.65`, top-1 `0.75`, graph-empty `0.05`, surface `0.70`, platform `0.80`.
- Exact embedding profile remains `snowflake-arctic-embed-33m-raw-v1` / `ollama/snowflake-arctic-embed:33m` / revision `e8db018629b4` / `384` dimensions.
- No synthetic or substitute semantic vectors.
- Live work is bound only to Supabase project `vrznfnxzlxaavpqbzbzd` in `eu-central-1`.
- No ANN/HNSW/IVFFlat, browser extension, automatic open-web ingestion, `design-with-ai` routing change, or unrelated `write-swift` repair.
- P5 PR remains draft and unmerged unless separately requested.

## Review Focus

1. A high-scoring wrong-platform candidate must not consume a slot that makes feasible quick platform coverage impossible; Task 2 pins this with a synthetic ranking fixture.
2. Surface and platform minima can overlap on the same record; Task 1 pins the two-predicate feasibility arithmetic so it does not over-reserve slots.
3. An actually infeasible pool must preserve deterministic best-effort selection and report gaps rather than deadlock or duplicate records; Tasks 1 and 2 pin this.
4. The focused quick repair must not alter standard/deep output ordering or deep stratum allocation; Task 2 pins exact regression fixtures.
5. P5 must not turn a healthy-control fix into an automatic cutover when semantic execution is unavailable or quality is below gates; Task 4 pins terminal receipt blockers.

---

### Task 1: Quick coverage feasibility contract

**Files:**
- Create: `knowledge/design-references/scripts/quick-coverage.mjs`
- Create: `tests/reference-graph/p5-quick-coverage.test.mjs`

**Interfaces:**
- Consumes: quick request shape already accepted by `selectRecords()` (`profile`, `limit`, optional `surface`, optional `platform`).
- Produces: `quickCoverageRequirements(request)` and `canCompleteQuickCoverage({ selectedRecords, remainingRecords, request })`.

- [ ] **Step 1: Write failing tests for requirements and feasible overlap**

Create `tests/reference-graph/p5-quick-coverage.test.mjs` with synthetic records and assertions that:

```js
assert.deepEqual(quickCoverageRequirements({
  profile: 'quick', limit: 4, surface: 'authenticated-home', platform: 'native-mobile',
}), { minimumSurface: 1, minimumPlatform: 2 });
```

Also assert that one record matching both predicates can satisfy one unit of both requirements and therefore consumes one slot, not two.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/reference-graph/p5-quick-coverage.test.mjs`

Expected: FAIL because `quick-coverage.mjs` does not exist.

- [ ] **Step 3: Implement `quickCoverageRequirements(request)`**

In `knowledge/design-references/scripts/quick-coverage.mjs` export:

```js
export function quickCoverageRequirements(request)
```

Requirements:
- throw unless `request.profile === 'quick'`
- `minimumSurface = request.surface ? 1 : 0`
- `minimumPlatform = request.platform ? Math.ceil(request.limit / 2) : 0`

- [ ] **Step 4: Implement `canCompleteQuickCoverage({ selectedRecords, remainingRecords, request })`**

Export:

```js
export function canCompleteQuickCoverage({ selectedRecords, remainingRecords, request })
```

The helper must:
- require arrays for selected/remaining
- reject duplicate IDs across the two arrays
- require enough total records to reach `request.limit`
- compute remaining surface/platform deficits after `selectedRecords`
- count remaining records matching both, surface-only, and platform-only
- use `minimumSlotsNeeded = surfaceNeed + platformNeed - Math.min(bothAvailable, surfaceNeed, platformNeed)`
- return `false` when either predicate has insufficient remaining candidates or `minimumSlotsNeeded` exceeds remaining slots
- return `true` otherwise

- [ ] **Step 5: Add infeasible and deterministic-input tests**

Assert `false` when surface availability is missing, platform availability is missing, or both requirements cannot fit in remaining slots. Assert record array order does not affect the boolean result.

- [ ] **Step 6: Run focused tests GREEN**

Run: `node --test tests/reference-graph/p5-quick-coverage.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add knowledge/design-references/scripts/quick-coverage.mjs tests/reference-graph/p5-quick-coverage.test.mjs
git commit -m "feat: add quick selection coverage feasibility"
```

### Task 2: Make quick selection coverage-aware without retuning ranking

**Files:**
- Modify: `knowledge/design-references/scripts/selection.mjs`
- Modify: `tests/reference-graph/p5-quick-coverage.test.mjs`
- Test: `knowledge/design-references/tests/library.test.mjs`

**Interfaces:**
- Consumes: `canCompleteQuickCoverage()` from Task 1 and the existing scored candidate list inside `selectRecords()`.
- Produces: unchanged public `selectRecords(records, request, options)` return shape; quick selection becomes coverage-constructive only when the full eligible pool is feasible.

- [ ] **Step 1: Write a failing synthetic selector test**

Build a quick `limit: 4` pool where existing scoring strongly prefers four exact-surface web records but at least two eligible native-mobile records exist. Assert after P5 that:

```js
assert.equal(result.selected.length, 4);
assert.equal(result.coverage.exactSurface >= 1, true);
assert.equal(result.coverage.exactPlatform >= 2, true);
assert.deepEqual(result.coverageGaps, []);
```

Reverse the input records and assert identical selected IDs.

- [ ] **Step 2: Verify RED against the current greedy selector**

Run: `node --test tests/reference-graph/p5-quick-coverage.test.mjs`

Expected: the new selector fixture fails platform coverage.

- [ ] **Step 3: Integrate feasibility filtering into `selectRecords()`**

Modify only the quick-profile candidate choice:

- evaluate once whether the initial eligible pool can satisfy the quick coverage contract
- keep the existing eligibility, score calculation, diversity penalty, candidate sort, quotas, stable ID tie-break, and selected-record shape
- when initial quick coverage is feasible, choose the first already-sorted candidate for which the hypothetical selected set plus remaining eligible records still passes `canCompleteQuickCoverage()`
- when initial quick coverage is infeasible, choose the existing first candidate exactly as before
- do not change score constants (`60`, `15`, token overlap multiplier, diversity penalties, visual boosts/penalties)

- [ ] **Step 4: Add best-effort infeasible regression**

Create a quick pool with only one matching platform record. Assert the selector still returns the requested number when total eligible supply allows it, remains deterministic, and reports the platform gap.

- [ ] **Step 5: Pin standard/deep behavior**

Add synthetic `standard` and `deep` fixtures whose selected ID sequences are captured from the P4 selector before the quick guard is enabled. Assert P5 returns the same sequences and deep `selectedByStratum` remains equal to `allocateDeep(limit)`.

- [ ] **Step 6: Run selector and library tests GREEN**

Run:

```bash
node --test tests/reference-graph/p5-quick-coverage.test.mjs
node --test knowledge/design-references/tests/library.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add knowledge/design-references/scripts/selection.mjs tests/reference-graph/p5-quick-coverage.test.mjs
git commit -m "fix: honor quick selection coverage constraints"
```

### Task 3: Prove the current legacy control becomes healthy without catalog mutation

**Files:**
- Create: `tests/reference-graph/p5-current-control.test.mjs`
- Modify: `reference-graph/shadow-eval.mjs` only if a generic diagnostic field is required by the test; do not change thresholds or case definitions

**Interfaces:**
- Consumes: `loadRecords()`, fixed evaluation-only `shadow-cases.json`, `assessLegacyControlHealth()`.
- Produces: regression evidence that the unchanged P4 catalog at reference time `2026-10-23T12:00:00.000Z` has a healthy control after the generic quick selector repair.

- [ ] **Step 1: Write the current-control regression test**

Assert exactly:

```js
assert.equal(health.fresh_pool_count, 275);
assert.equal(health.case_count, 24);
assert.equal(health.full_limit_case_count, 24);
assert.equal(health.cases_with_coverage_gaps, 0);
assert.deepEqual(health.blockers, []);
assert.equal(health.healthy, true);
```

Also hash or deep-compare the loaded catalog authority fields before/after evaluation to prove the check is read-only.

- [ ] **Step 2: Run the regression test**

Run: `node --test tests/reference-graph/p5-current-control.test.mjs`

Expected after Task 2: PASS. If it fails, stop and diagnose; do **not** refresh stale records or alter thresholds inside this task.

- [ ] **Step 3: Add benchmark-independence source guard**

In the same test, read `knowledge/design-references/scripts/selection.mjs` and `quick-coverage.mjs` and assert neither contains `shadow-cases`, diagnosed case IDs, or imports from `reference-graph` evaluation fixtures.

- [ ] **Step 4: Verify P3/P4 evidence immutability**

Assert the committed P3 historical control remains 600 fresh / 0 gaps and the P4 receipt remains 275 fresh / 3 gaps / `no-cutover`; P5 fixes current code behavior but never rewrites those historical receipts.

- [ ] **Step 5: Run all Reference Graph tests**

Run: `node --test tests/reference-graph/*.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add tests/reference-graph/p5-current-control.test.mjs reference-graph/shadow-eval.mjs
git commit -m "test: gate P5 on healthy current control"
```

### Task 4: Add P5 operator and terminal receipt gates

**Files:**
- Create: `reference-graph/p5-receipt.mjs`
- Create: `reference-graph/cli/p5-live-quality.mjs`
- Create: `tests/reference-graph/p5-receipt.test.mjs`
- Create: `tests/reference-graph/p5-operator.test.mjs`

**Interfaces:**
- Consumes: target binding, `assessLegacyControlHealth()`, `REFERENCE_EMBEDDING_PROFILE`, `ReferenceGraphSupabaseStore`, existing live shadow retrievers and summary shape.
- Produces: read-only P5 evidence operator plus `createP5Receipt()`, `recordP5Phase()`, `finalizeP5Receipt()`, `assertSecretFreeP5Receipt()`.

- [ ] **Step 1: Write failing receipt tests**

Define required ordered phases:

```js
['preflight', 'selector', 'embeddings', 'shadow']
```

Tests must assert terminal failure semantics and that finalization forces `production_source: 'legacy-control'`.

- [ ] **Step 2: Pin P5 finalization blockers**

Tests must independently prove `eligible_for_cutover_review` remains false for:
- selector contract not verified
- unhealthy current control
- incomplete or text-hash-mismatched embeddings
- semantic/hybrid unavailable
- hybrid summary below any unchanged quality gate

A fully green synthetic receipt may set `eligible_for_cutover_review: true` but must still keep `production_source: 'legacy-control'` and must not expose a cutover action.

- [ ] **Step 3: Implement `p5-receipt.mjs` minimally**

Use the P4 receipt style, but only P5 phases and fields. Export:

```js
createP5Receipt({ binding, gitSha, verificationAt, referenceTime })
recordP5Phase(receipt, { phase, status, detail })
finalizeP5Receipt(receipt, { selectorContract, currentControlHealth, embeddingCoverage, evaluations, blockers })
assertSecretFreeP5Receipt(receipt, secrets)
```

- [ ] **Step 4: Write failing P5 operator tests**

The CLI must expose exactly read-only modes:

- `--current-control`
- `--embedding-coverage`
- `--supabase-lexical`
- `--supabase-semantic`
- `--supabase-hybrid`

Network modes require `--target`; current-control stays credential-free. All modes accept `--reference-date YYYY-MM-DD`; receipt output must be secret-free.

- [ ] **Step 5: Implement `reference-graph/cli/p5-live-quality.mjs`**

Reuse existing P4/P3 store and live-shadow code. Do not add write RPCs, migrations, model substitution, or production routing changes.

- [ ] **Step 6: Run focused receipt/operator tests GREEN**

Run:

```bash
node --test tests/reference-graph/p5-receipt.test.mjs
node --test tests/reference-graph/p5-operator.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add reference-graph/p5-receipt.mjs reference-graph/cli/p5-live-quality.mjs tests/reference-graph/p5-receipt.test.mjs tests/reference-graph/p5-operator.test.mjs
git commit -m "feat: add P5 live quality receipt gate"
```

### Task 5: Extend permanent governance for P5

**Files:**
- Modify: `.github/workflows/verify-reference-graph.yml`
- Modify: `tests/reference-graph/p4-ci-contract.test.mjs` or create `tests/reference-graph/p5-ci-contract.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–4 tests and evidence path conventions.
- Produces: permanent CI gates for generic quick coverage, anti-leakage, current-control health, receipt secrecy, and unchanged historical evidence.

- [ ] **Step 1: Write failing CI contract assertions**

Assert workflow text includes:
- P5 tests through the existing `tests/reference-graph/*.test.mjs` glob
- current P5 control-health verification requiring zero coverage gaps
- immutable P3/P4 evidence verification
- P5 evidence secret scan when files exist
- no requirement to run temporary P5 planning workflows

- [ ] **Step 2: Add permanent current-control gate**

Update governance so the current branch must report at `2026-10-23`:
- `fresh_pool_count = 275`
- `full_limit_case_count = 24`
- `cases_with_coverage_gaps = 0`
- `healthy = true`

Keep the separate immutable P4 receipt expectation at 3 historical gaps.

- [ ] **Step 3: Add source-level anti-benchmark-leakage check**

CI must fail if production selector/quick-coverage implementation references `shadow-cases.json` or the diagnosed case IDs.

- [ ] **Step 4: Run all Reference Graph tests and secret scanner**

Run:

```bash
node --test tests/reference-graph/*.test.mjs
python3 skills/security-review-redirect/scripts/scan_secrets.py reference-graph
```

Expected: PASS / no common secret patterns.

- [ ] **Step 5: Commit Task 5**

```bash
git add .github/workflows/verify-reference-graph.yml tests/reference-graph/p5-ci-contract.test.mjs
git commit -m "ci: enforce P5 control coverage gates"
```

### Task 6: Verify the final implementation head before live evidence

**Files:**
- No intended product changes; fixes discovered by verification belong in the owning task's files.

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: one implementation SHA with permanent Reference Graph governance green, used by P5 evidence receipts.

- [ ] **Step 1: Run full local-equivalent verification**

Run:

```bash
node --test tests/reference-graph/*.test.mjs
node --test knowledge/design-references/tests/library.test.mjs
node reference-graph/cli/p5-live-quality.mjs --current-control --reference-date 2026-10-23
python3 skills/security-review-redirect/scripts/scan_secrets.py reference-graph
```

Expected: all tests pass, current control healthy with 275 fresh records and 0 gaps, secret scan clean.

- [ ] **Step 2: Push and require permanent Reference Graph governance green**

Record the exact workflow run ID and implementation SHA. Do not treat the inherited unrelated Release Governance failure as a P5 failure; verify it is still the same pre-existing `write-swift` baseline issue.

- [ ] **Step 3: Self-review the P4→P5 implementation diff**

Check specifically for:
- ranking-weight changes
- catalog freshness/status edits
- benchmark fixture imports in production code
- accidental temporary workflows
- new write surfaces
- cutover/routing changes

Fix any P5-owned issue and repeat Steps 1–2.

### Task 7: Collect current-date live P5 evidence on the dedicated target

**Files:**
- Create during final evidence commit: `reference-graph/evidence/p5-control-coverage-evidence.json`
- Create during final evidence commit: `reference-graph/evidence/p5-live-shadow-evidence.json`
- Temporary execution workflows/scripts, if required, must be deleted before the evidence commit.

**Interfaces:**
- Consumes: final tested implementation SHA, dedicated target, P5 operator/receipt, exact embedding profile.
- Produces: durable read-only live evidence and final P5 decision.

- [ ] **Step 1: Read the Supabase execution skill and verify target binding**

Confirm only:
- project ref `vrznfnxzlxaavpqbzbzd`
- project name `agent-hub-reference-graph`
- region `eu-central-1`
- project healthy

Stop on mismatch.

- [ ] **Step 2: Measure current control first**

Execute the committed P5 current-control path for reference date `2026-10-23`. Require 24/24 full-limit cases, 0 gap cases, and `healthy: true` before any quality score is promoted as comparable.

If unhealthy, record terminal `no-cutover` evidence and skip comparable live shadow scoring.

- [ ] **Step 3: Measure exact embedding completeness**

Using the committed exact-profile coverage path require:
- eligible chunk count measured from live target
- compatible count = eligible count
- missing = 0
- text-hash mismatch = 0
- coverage = 1

Expected if authority is unchanged: `275/275`.

- [ ] **Step 4: Generate exact Snowflake query embeddings without substitutes**

Use the pinned model/revision. A temporary credential-free GitHub Actions job may install/run the exact provider and export query vectors as an artifact. Bind the artifact SHA-256 in evidence and delete the workflow afterward.

If exact provider execution is unavailable, mark semantic/hybrid unavailable and finish `no-cutover`.

- [ ] **Step 5: Execute live lexical, semantic, and hybrid retrieval read-only**

Use the committed live RPCs/store semantics and the same fixed 24 evaluation requests at the current reference date. Do not persist query embeddings or change live catalog rows.

For connector-safe execution, exported exact query vectors and read-only Supabase SQL/RPC calls are allowed; any temporary helper must be fixed-scope, secret-free/inert after use, and absent from the final branch.

- [ ] **Step 6: Evaluate unchanged thresholds**

Record each mode's case-level results, overlap/top-1/empty/surface/platform summary, latency, and blockers using the existing summary implementation. Do not tune weights or thresholds after observing results.

- [ ] **Step 7: Build durable P5 evidence through `finalizeP5Receipt()`**

`p5-control-coverage-evidence.json` must bind:
- implementation SHA/run
- selector contract
- P4 authority counts unchanged
- current control health

`p5-live-shadow-evidence.json` must bind:
- target
- reference time
- embedding profile/coverage
- lexical/semantic/hybrid evidence or explicit availability blockers
- unchanged thresholds
- `production_source: legacy-control`
- final `eligible_for_cutover_review` and decision

Run `assertSecretFreeP5Receipt()` on committed evidence.

- [ ] **Step 8: Verify evidence-head governance**

Push the evidence commit and require permanent Reference Graph governance green on that exact head. Confirm temporary execution files are absent and the PR remains draft/unmerged.

- [ ] **Step 9: Commit final evidence**

```bash
git add reference-graph/evidence/p5-control-coverage-evidence.json reference-graph/evidence/p5-live-shadow-evidence.json
git commit -m "chore: record P5 comparable live shadow evidence"
```

### Task 8: Final branch review and PR state

**Files:**
- Modify PR body only unless review finds a P5-owned defect.

**Interfaces:**
- Consumes: final evidence head and all verification results.
- Produces: reviewable draft P5 PR stacked on P4 with no merge/cutover action.

- [ ] **Step 1: Compare exact P4 base to P5 head**

Review `4621574eca88f30296452b25fcb04be3a496d7d5...HEAD` for scope drift.

- [ ] **Step 2: Verify safety boundaries**

Require:
- no catalog freshness/status mutation introduced solely for P5
- no threshold lowering
- no model substitution
- no ANN
- no production graph routing/cutover
- no unrelated Release Governance repair
- no temporary workflow left behind

- [ ] **Step 3: Update the draft PR with final measured facts**

PR base: `agent/reference-graph-p4`.

Document implementation SHA, evidence head, current-control health, embedding coverage, live mode results/availability, final receipt blockers, governance runs, and inherited Release Governance status.

- [ ] **Step 4: Stop at reviewable P5 boundary**

Do not merge. Do not cut over. If `eligible_for_cutover_review` becomes true, report that as evidence for a separate later decision only.
