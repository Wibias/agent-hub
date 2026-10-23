# Reference Graph P4 Freshness + Retrieval Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore an honestly fresh, benchmark-independent legacy control, persist complete exact-profile document embeddings to the dedicated Reference Graph target, and produce current-date live lexical/semantic/hybrid evidence without changing production routing.

**Architecture:** P4 keeps the reviewed design-reference library authoritative for freshness and uses explicit revalidation decisions rather than link-health timestamps. A deterministic planner processes the full stale maintainable reviewed population without consulting shadow labels. A new database migration makes deployed retrieval current-version and freshness aware, while the existing provider-neutral embedding pipeline gains exact text-hash completeness verification. The final read-only P4 operator binds evidence to the dedicated Supabase target and always keeps `legacy-control` as production.

**Tech Stack:** Node.js 24 ESM/built-ins, PostgreSQL 16 + pgvector/Supabase RPCs, Ollama `snowflake-arctic-embed:33m`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-23-reference-graph-p4-freshness-quality-design.md`

## Global Constraints

- Production selection remains `legacy-control`; P4 never performs a cutover.
- Do not lower or redefine the cutover gates: average overlap >= `0.65`, legacy top-1 retention >= `0.75`, graph empty rate <= `0.05`, exact surface rate >= `0.70`, exact platform rate >= `0.80`.
- The only live embedding identity is profile `snowflake-arctic-embed-33m-raw-v1`, model `ollama/snowflake-arctic-embed:33m`, revision `e8db018629b4`, dimensions `384`.
- `lastVerifiedAt` may advance only from an explicit revalidation decision that checked the source and the referenced analysis; live-link health alone is insufficient.
- Revalidation does not rewrite historical `reviewedAt` or `reviewedBy`; a confirmed previously-stale reviewed record may return to `reviewStatus: reviewed` after genuine revalidation.
- The revalidation planner must not read `shadow-cases.json`, graph results, overlap metrics, or benchmark labels. P4 current-date cutover readiness requires the entire planned stale maintainable population to receive terminal decisions.
- External content remains untrusted reference data and cannot authorize code, tool, policy, Memory Claim, or routing changes.
- Every live database read/write remains bound to dedicated project `vrznfnxzlxaavpqbzbzd` / `agent-hub-reference-graph`; credentials remain environment-only and redacted.
- Migrations `001`-`004` are immutable history; P4 schema work starts at `005`.
- No HNSW/IVFFlat, browser extension, automatic open-web ingestion, `design-with-ai` routing change, benchmark-driven ranking tuning, or unrelated `write-swift` governance repair is part of P4.
- Partial revalidation, unhealthy current control, partial exact-profile embedding coverage, or unavailable hybrid evaluation forces `cutover_ready: false`.

## Review Focus

- A revalidation decision must never refresh a record merely because the URL returned HTTP success; the owning test requires explicit `sourceChecked`, `analysisChecked`, `rightsChecked`, verifier identity, date, access state, and substantive notes.
- Revalidation planning must be benchmark-independent; the owning test must prove changing shadow cases cannot change the queue and that the planner never imports the shadow suite.
- Multiple historical assets for one `legacy_id` must not appear together in retrieval; the SQL smoke test must prove only the newest current asset participates while non-legacy assets remain independently eligible.
- An embedding with the right model/revision but the wrong `text_hash` must count as incompatible; the coverage test must report the mismatch and block completeness.
- The graph and legacy control must evaluate against the same reference date; the shadow test must assert `reference_date` is propagated to deployed graph filters from `controlNow`.

---

### Task 1: Explicit Design-Reference Revalidation Contract

**Files:**
- Create: `knowledge/design-references/scripts/revalidation-lib.mjs`
- Create: `knowledge/design-references/scripts/revalidate-batch.mjs`
- Test: `tests/reference-graph/p4-revalidation.test.mjs`

**Interfaces:**
- Produces: `validateRevalidationDecision(decision) -> normalizedDecision`.
- Produces: `applyRevalidationDecisions(records, decisions) -> { records, summary }`.
- `normalizedDecision` includes deterministic `decisionHash`, SHA-256 over the canonical decision payload, for idempotent database evidence.
- Verdicts are exactly `confirm`, `stale`, or `archive`; every decision carries `id`, `verifiedAt` (`YYYY-MM-DD`), `verifier`, `sourceChecked: true`, `analysisChecked: true`, `rightsChecked: true`, `accessStatus`, and substantive `notes`.
- `confirm` sets `reviewStatus: reviewed`, updates only `lastVerifiedAt` and `accessStatus`, and preserves `reviewedAt`/`reviewedBy`. `stale` and `archive` set the matching review status and update verified access/date only because a substantive revalidation actually occurred.
- A record requiring rewritten analysis is not patched by this interface; it is marked stale and any replacement analysis must use the existing candidate/review workflow.

- [ ] **Step 1: Write the failing revalidation contract tests**

Add tests named `confirm advances verification without rewriting review authority`, `confirm can restore a previously stale reviewed record`, `link-only decisions are rejected`, `stale and archive become ineligible review states`, `decision hashes are stable and content-sensitive`, `duplicate or unknown decisions fail closed`, and `untouched records remain byte-equivalent after internal fields are stripped`.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test tests/reference-graph/p4-revalidation.test.mjs`

Expected: FAIL because `revalidation-lib.mjs` does not exist.

- [ ] **Step 3: Implement the pure library and explicit plan/apply CLI**

Implement the interfaces above. `revalidate-batch.mjs` supports exactly one of `--plan` or `--apply`, requires `--review-log <jsonl>`, validates every resulting record with the existing production validator, and rewrites only JSONL shards containing changed IDs. `--plan` performs no writes and reports touched IDs/files plus the normalized summary.

- [ ] **Step 4: Verify focused behavior and untouched catalog validity**

Run:

```bash
node --test tests/reference-graph/p4-revalidation.test.mjs
node knowledge/design-references/scripts/validate.mjs --production
```

Expected: PASS; tests do not alter committed catalog data.

- [ ] **Step 5: Commit**

```bash
git add knowledge/design-references/scripts/revalidation-lib.mjs knowledge/design-references/scripts/revalidate-batch.mjs tests/reference-graph/p4-revalidation.test.mjs
git commit -m "feat: add explicit design reference revalidation"
```

### Task 2: Benchmark-Independent Full Revalidation Planner

**Files:**
- Create: `reference-graph/revalidation-plan.mjs`
- Create: `reference-graph/cli/plan-revalidation.mjs`
- Test: `tests/reference-graph/p4-revalidation-plan.test.mjs`

**Interfaces:**
- Consumes only catalog records, `isFresh(...)`, current reference time, optional completed decision IDs, and a bounded wave size.
- Produces: `planP4RevalidationQueue({ records, currentNow, completedIds = [], waveSize = 50 }) -> { target_ids, already_fresh_ids, pending_ids, completed_ids, excluded_ids, waves, complete }`.
- `target_ids` contains every non-archived record whose `reviewStatus` is `reviewed` or `stale` and which is stale at `currentNow`; candidates and archived records are excluded with explicit reasons. Currently fresh reviewed records are reported separately and require no P4 decision.
- Pending IDs are sorted deterministically by stale review state first, then oldest `lastVerifiedAt`, shortest TTL, then stable record ID. `waves` are fixed slices of `pending_ids`; wave boundaries never depend on benchmark quality or control health.

- [ ] **Step 1: Write RED tests for population, determinism, and anti-leakage**

Test that every stale maintainable reviewed/stale record enters `target_ids`; fresh reviewed records do not; candidate/archive records are excluded; repeated plans are byte-stable; completed IDs disappear from pending but remain in target/completed; wave size changes only boundaries, not target membership; and queue output is unchanged when an unrelated shadow-case fixture is modified.

Also statically assert `revalidation-plan.mjs` does not import `shadow-cases.json`, `shadow-eval.mjs`, or graph retrieval modules.

- [ ] **Step 2: Confirm RED**

Run: `node --test tests/reference-graph/p4-revalidation-plan.test.mjs`

Expected: FAIL because the planner does not exist.

- [ ] **Step 3: Implement planner and read-only CLI**

`plan-revalidation.mjs` accepts `--now <YYYY-MM-DD>` and optional `--completed <review-log.jsonl>` plus `--wave-size <1..100>`. It validates completed decisions through Task 1, prints deterministic plan JSON, and performs no network calls or writes.

- [ ] **Step 4: Verify the real catalog plan is reproducible and benchmark-independent**

Run twice:

```bash
node reference-graph/cli/plan-revalidation.mjs --now 2026-10-23 --wave-size 50 > /tmp/p4-revalidation-a.json
node reference-graph/cli/plan-revalidation.mjs --now 2026-10-23 --wave-size 50 > /tmp/p4-revalidation-b.json
cmp /tmp/p4-revalidation-a.json /tmp/p4-revalidation-b.json
```

Expected: identical output; `target_ids` covers the full stale maintainable population rather than a shadow-case subset.

- [ ] **Step 5: Commit**

```bash
git add reference-graph/revalidation-plan.mjs reference-graph/cli/plan-revalidation.mjs tests/reference-graph/p4-revalidation-plan.test.mjs
git commit -m "feat: plan unbiased reference revalidation waves"
```

### Task 3: Current-Version and Freshness-Aware Database Retrieval

**Files:**
- Modify: `reference-graph/capture.mjs`
- Modify: `reference-graph/legacy-import.mjs`
- Create: `reference-graph/schema/005_reference_graph_freshness.sql`
- Test: `tests/reference-graph/p4-freshness-sql.test.mjs`

**Interfaces:**
- `normalizeReferenceCapture(...)` adds the existing SHA-256 text identity to `chunk.metadata.text_hash`; deterministic IDs remain unchanged.
- `adaptLegacyDesignReference(...)` copies record `access_status` into asset metadata in addition to existing source metadata.
- Migration `005` creates `reference_graph.source_verifications` with primary key `decision_hash`, `legacy_id`, `verdict`, `verified_at`, `verifier`, `access_status`, `notes`, `metadata`, `created_at`; all tables remain RLS/closed by default.
- Migration `005` creates `reference_graph.current_assets`, selecting one newest asset for each non-empty `legacy_id` by `captured_at DESC, id DESC`, while including every non-legacy asset independently.
- Migration `005` creates service-role-only `public.reference_graph_record_verifications(jsonb)` using `decision_hash` for idempotency.
- Migration `005` replaces lexical/semantic/context behavior so every candidate passes the same current-asset plus eligibility semantics.
- Eligibility requires asset provenance `review_status = reviewed`, per-asset `access_status` (fallback to source metadata only for pre-P4 rows) in `AVAILABLE|PAYWALLED`, and `last_verified_at + ttl_days >= reference_date`; `reference_date` comes from `p_filters.reference_date` and otherwise defaults to `current_date`.
- Migration `005` adds service-role-only `public.reference_graph_embedding_coverage(p_model_id text, p_model_revision text, p_reference_date date)` returning current eligible chunk count, compatible count, missing count, text-hash mismatch count, and coverage rate.

- [ ] **Step 1: Write RED metadata/SQL contract tests**

Assert chunk `text_hash` equals the embedding-pipeline SHA-256 for identical content, asset metadata carries its own access status, migration `005` never edits `001`-`004`, verification rows are idempotent by `decision_hash`, and the migration closes the new surfaces from `public`, `anon`, and `authenticated` while granting only required service-role execution.

- [ ] **Step 2: Confirm RED**

Run: `node --test tests/reference-graph/p4-freshness-sql.test.mjs`

Expected: FAIL for missing P4 metadata/migration.

- [ ] **Step 3: Implement metadata additions and migration `005`**

Keep history append-only. Candidate/context paths must consume `reference_graph.current_assets` and the same eligibility logic. Coverage counts an embedding as compatible only when model/revision match and persisted `text_hash` equals `chunk.metadata->>'text_hash'`.

- [ ] **Step 4: Run Node tests plus a fresh PostgreSQL smoke**

Apply `001` through `005` to a fresh pgvector PostgreSQL 16 database. Seed two historical assets with one `legacy_id`, one non-legacy asset, reviewed/stale/unavailable variants, exact and mismatched embeddings, plus duplicate verification writes.

Assert: only newest legacy + non-legacy are candidates; stale/unavailable records are excluded at requested date; a historical date can make the expected reviewed asset eligible; hash mismatch lowers coverage; duplicate decision hash does not duplicate ledger evidence; `anon` and `authenticated` cannot execute privileged RPCs.

Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add reference-graph/capture.mjs reference-graph/legacy-import.mjs reference-graph/schema/005_reference_graph_freshness.sql tests/reference-graph/p4-freshness-sql.test.mjs
git commit -m "feat: add freshness aware reference graph retrieval"
```

### Task 4: Reference-Date Plumbing and Supabase Verification APIs

**Files:**
- Modify: `reference-graph/shadow-eval.mjs`
- Modify: `reference-graph/supabase-store.mjs`
- Modify: `reference-graph/live-shadow.mjs`
- Test: `tests/reference-graph/p4-live-freshness.test.mjs`

**Interfaces:**
- `runCatalogShadowEvaluation(...)` adds `reference_date: controlNow.toISOString().slice(0, 10)` to every graph retrieval filter.
- `ReferenceGraphSupabaseStore.recordVerifications(rows)` calls `reference_graph_record_verifications`.
- `ReferenceGraphSupabaseStore.embeddingCoverage(modelId, modelRevision, referenceDate)` calls `reference_graph_embedding_coverage` and returns its JSON object.
- Existing lexical/semantic/hybrid retrievers preserve `reference_date` unchanged when forwarding filters.

- [ ] **Step 1: Write RED propagation/store tests**

Assert `controlNow = 2026-10-23T12:00:00Z` produces graph filter `reference_date: "2026-10-23"`; all three live retriever modes preserve it; verification rows include deterministic decision hashes; new store methods use exact RPC names/arguments; service credentials remain redacted from failures.

- [ ] **Step 2: Confirm RED**

Run: `node --test tests/reference-graph/p4-live-freshness.test.mjs`

Expected: FAIL because date propagation/store methods are absent.

- [ ] **Step 3: Implement the minimal plumbing**

Do not add a second JavaScript freshness policy. The legacy selector remains the control policy; deployed graph freshness is enforced by SQL using the same explicit reference date.

- [ ] **Step 4: Verify focused and prior P3 live-shadow tests**

Run:

```bash
node --test tests/reference-graph/p4-live-freshness.test.mjs tests/reference-graph/p3-live-shadow.test.mjs tests/reference-graph/p3-latency.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add reference-graph/shadow-eval.mjs reference-graph/supabase-store.mjs reference-graph/live-shadow.mjs tests/reference-graph/p4-live-freshness.test.mjs
git commit -m "feat: align live graph and control reference dates"
```

### Task 5: Exact-Profile Embedding Export and Completeness Gate

**Files:**
- Modify: `reference-graph/embedding-pipeline.mjs`
- Modify: `reference-graph/cli/embed-design-references.mjs`
- Test: `tests/reference-graph/p4-embedding-completeness.test.mjs`

**Interfaces:**
- Produces: `summarizeExpectedEmbeddingRows(rows, profile) -> { row_count, model_id, model_revision, dimensions, text_hash_count }`.
- CLI modes become exactly one of `--plan`, `--export-rows <path>`, or `--apply`.
- `--export-rows` requires the pinned Ollama model but no Supabase credentials, writes deterministic JSON containing only exact-profile embedding rows plus public profile metadata, and secret-scans the serialized artifact before writing.
- `--apply` keeps explicit `--allow-experimental`, persists rows, then calls `store.embeddingCoverage(...)`; it exits non-zero unless current eligible coverage is `1`, missing count is `0`, and text-hash mismatch count is `0`.
- Embedding generation continues over the whole committed catalog so the fixed historical benchmark also has exact-profile document vectors; current coverage counts only current eligible chunks.

- [ ] **Step 1: Write RED export/completeness tests**

Cover deterministic row ordering, pinned model/revision/dimensions, rejection of NaN/wrong dimensions, no Supabase requirement for export mode, apply-mode failure when coverage reports one missing row, and failure on one text-hash mismatch even when model/revision match.

- [ ] **Step 2: Confirm RED**

Run: `node --test tests/reference-graph/p4-embedding-completeness.test.mjs`

Expected: FAIL on missing mode/coverage behavior.

- [ ] **Step 3: Implement export and hard completeness verification**

Reuse `buildEmbeddingRows(...)` and `OllamaEmbeddingProvider`; do not introduce another model adapter. Export sorts by `chunk_id`. `--apply` reports coverage JSON but never changes the profile's `experimental` or `cutoverApproved: false` state.

- [ ] **Step 4: Verify embedding regressions**

Run:

```bash
node --test tests/reference-graph/p4-embedding-completeness.test.mjs tests/reference-graph/p2-embedding-pipeline.test.mjs tests/reference-graph/p2-ollama-embeddings.test.mjs tests/reference-graph/p2-profile.test.mjs
node reference-graph/cli/embed-design-references.mjs --plan
```

Expected: PASS; plan mode performs no Ollama/Supabase calls.

- [ ] **Step 5: Commit**

```bash
git add reference-graph/embedding-pipeline.mjs reference-graph/cli/embed-design-references.mjs tests/reference-graph/p4-embedding-completeness.test.mjs
git commit -m "feat: gate P4 on exact embedding completeness"
```

### Task 6: P4 Receipt and Read-Only Quality Operator

**Files:**
- Create: `reference-graph/p4-receipt.mjs`
- Create: `reference-graph/cli/p4-live-quality.mjs`
- Test: `tests/reference-graph/p4-receipt.test.mjs`
- Test: `tests/reference-graph/p4-operator.test.mjs`

**Interfaces:**
- `P4_PHASES = ["preflight", "revalidation", "import", "embeddings", "shadow"]`.
- Produces `createP4Receipt(...)`, `recordP4Phase(...)`, `finalizeP4Receipt(...)`, `assertSecretFreeP4Receipt(...)` with P3 terminal-failure/order semantics.
- Receipt stores `revalidation: { target_count, terminal_decision_count, confirm_count, stale_count, archive_count, complete }` separately from current control health.
- `finalizeP4Receipt(...)` may set `cutover_ready: true` only when revalidation is complete, current control health is healthy, exact current embedding coverage is complete, live hybrid evaluation is available and its existing summary gates are green, all required phases are successful/non-blocking, and no P4 blocker remains.
- `production_source` is always `legacy-control`; `eligible_for_cutover_review` may mirror a green evidence signal but performs no route change.
- `p4-live-quality.mjs` is read-only: preflight, current control health, import stats, embedding coverage, lexical/semantic/hybrid shadow evidence, and receipt output. It never applies migrations, edits catalog records, imports captures, persists vectors, or changes routing.

- [ ] **Step 1: Write RED receipt/operator tests**

Test ordered phases, terminal failure, credential-shaped field rejection, explicit secret-value rejection, partial revalidation forcing no-cutover, unhealthy current control forcing no-cutover, incomplete/hash-mismatched embeddings forcing no-cutover, missing hybrid forcing no-cutover, green hybrid still leaving production on legacy, and every operator network mode requiring target binding before network work.

- [ ] **Step 2: Confirm RED**

Run:

```bash
node --test tests/reference-graph/p4-receipt.test.mjs tests/reference-graph/p4-operator.test.mjs
```

Expected: FAIL because P4 receipt/operator do not exist.

- [ ] **Step 3: Implement receipt and read-only operator**

Reuse P3 target binding/redaction, existing shadow evaluator/retrievers, and exact profile query provider. Do not copy credentials into phase detail. `--receipt-out <path>` writes only after secret validation.

- [ ] **Step 4: Verify P4 and P3 safety contracts together**

Run:

```bash
node --test tests/reference-graph/p4-receipt.test.mjs tests/reference-graph/p4-operator.test.mjs tests/reference-graph/p3-receipt.test.mjs tests/reference-graph/p3-cli-targeting.test.mjs tests/reference-graph/p3-secret-scan.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add reference-graph/p4-receipt.mjs reference-graph/cli/p4-live-quality.mjs tests/reference-graph/p4-receipt.test.mjs tests/reference-graph/p4-operator.test.mjs
git commit -m "feat: add P4 live quality evidence contract"
```

### Task 7: Permanent CI and Operator Documentation

**Files:**
- Modify: `.github/workflows/verify-reference-graph.yml`
- Modify: `reference-graph/README.md`
- Modify: `knowledge/design-references/README.md`
- Test: `tests/reference-graph/p4-ci-contract.test.mjs`

**Interfaces:**
- Permanent CI runs every Reference Graph test, secret-scans P3/P4 committed artifacts, executes migrations `001` through `005` on fresh pgvector PostgreSQL 16, and smoke-tests current-asset selection, explicit reference-date freshness, embedding text-hash coverage, idempotent verification evidence, and anon/authenticated RPC denial.
- Documentation explains that link health is triage only, full stale maintainable revalidation is benchmark-independent, `reviewedAt` is not rewritten by verification, exact embedding export/apply/verify commands, current-vs-historical evidence clocks, and no-cutover boundary.

- [ ] **Step 1: Write RED CI contract test**

Assert the workflow executes `005_reference_graph_freshness.sql`, includes the P4 evidence files in committed-artifact secret scanning when present, and contains smoke assertions for current asset, freshness date, hash mismatch, verification idempotency, and exposed-role denial.

- [ ] **Step 2: Confirm RED**

Run: `node --test tests/reference-graph/p4-ci-contract.test.mjs`

Expected: FAIL against the P3-only workflow.

- [ ] **Step 3: Update workflow and docs**

Preserve all prior P3 gates. Do not add live credentials to CI. Document full revalidation rather than a benchmark-targeted shortcut.

- [ ] **Step 4: Run the complete local contract suite**

Run:

```bash
node --test tests/reference-graph/*.test.mjs
python3 skills/security-review-redirect/scripts/scan_secrets.py reference-graph
node knowledge/design-references/scripts/validate.mjs --production
node reference-graph/cli/import-design-references.mjs --plan
node reference-graph/cli/plan-revalidation.mjs --now 2026-10-23 --wave-size 50
node reference-graph/cli/embed-design-references.mjs --plan
node reference-graph/cli/shadow-design-references.mjs --offline --control-date 2026-07-21
```

Expected: all P4-owned tests/scans pass. The known unrelated Release Governance `write-swift` baseline failure, if still present, is recorded separately rather than repaired here.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/verify-reference-graph.yml reference-graph/README.md knowledge/design-references/README.md tests/reference-graph/p4-ci-contract.test.mjs
git commit -m "ci: verify P4 freshness and quality contracts"
```

### Task 8: Full Live Revalidation, Embeddings, Shadow Evidence, and Final Receipt

**Files:**
- Create during execution: `reference-graph/evidence/p4-revalidation-results.json`
- Create during execution: `reference-graph/evidence/p4-freshness-quality-evidence.json`
- Modify during execution: only design-reference JSONL shards touched by valid revalidation decisions, plus regenerated design-reference indexes.
- Temporary during execution only: a branch-only embedding-export workflow/artifact if the trusted runner cannot directly reach both Ollama and Supabase; remove it before final verification.

**Interfaces:**
- Live target: dedicated project `vrznfnxzlxaavpqbzbzd` (`agent-hub-reference-graph`, `eu-central-1`).
- Revalidation evidence binds the initial complete target-ID set, every terminal decision hash, wave execution, final counts, and unresolved IDs. No raw screenshots/page bodies or secrets are committed.
- Final receipt binds the exact implementation SHA tested before the receipt-only commit, exact embedding model/revision, revalidation completeness, current and historical control health separately, exact-profile coverage, live lexical/semantic/hybrid summaries, latency, security/RPC checks, thresholds, blockers, and decision.

- [ ] **Step 1: Freeze the benchmark-independent revalidation population**

Run the committed planner at the execution date before inspecting shadow results. Commit or hash the initial `target_ids` set into P4 revalidation evidence. Run existing live `freshness-report.mjs` only for access/maintenance triage.

Expected: one immutable benchmark-independent stale maintainable target population plus currently-fresh/excluded counts.

- [ ] **Step 2: Revalidate every planned record in deterministic waves**

For each wave, inspect the current underlying source and the committed analysis. Produce Task 1 decisions. Use `confirm` only when the analysis remains materially valid; use `stale`/`archive` otherwise. If a source needs rewritten analysis, mark it stale and use the existing candidate/review workflow rather than disguising the rewrite as verification.

Apply each wave with `revalidate-batch.mjs --plan` first, then `--apply`, and update the completed-decision ledger. Do **not** stop when shadow cases become fillable. Continue until every frozen target ID has a terminal valid decision or record the run incomplete.

Expected: every changed `lastVerifiedAt` is backed by a decision hash; `reviewedAt`/`reviewedBy` remain historical unless a separate existing review workflow legitimately creates a new reviewed record.

- [ ] **Step 3: Validate/reindex and import the revalidated catalog twice**

Run production catalog validation/build-index, then apply the existing bound import to the dedicated Supabase target twice. Persist normalized P4 verification ledger rows through the service-only RPC. Compare counts after both imports.

Expected: second import/verification persistence is idempotent; old changed-content assets remain provenance history; current retrieval exposes only newest eligible legacy versions.

- [ ] **Step 4: Generate and persist exact-profile document embeddings**

Preferred path: run `embed-design-references.mjs --apply --allow-experimental --target reference-graph/target.json` on a trusted runner that can reach the pinned local Ollama model and bound Supabase target. If one runner cannot safely reach both, use permanent `--export-rows` on an isolated Ollama-capable runner, bind artifact SHA-256 and verified model digest, then import those exact rows through the trusted database/admin path. Never substitute another model.

Expected: current P4 embedding coverage reports `coverage_rate: 1`, `missing_count: 0`, `text_hash_mismatch_count: 0`. Historical benchmark chunks also have exact-profile vectors if still present in the catalog.

- [ ] **Step 5: Run current-date quality evidence only after full revalidation**

First evaluate current legacy control health. If revalidation is incomplete or current control remains unhealthy after honest stale/archive decisions, record the blocker and keep `cutover_ready: false`; do not widen freshness artificially.

When current control is healthy, run deployed lexical, semantic, and hybrid shadow modes with the same current reference date for graph and control. Separately run/retain the fixed `2026-07-21T12:00:00.000Z` benchmark for P2/P3 regression comparison.

Expected: current and historical clocks are labeled separately; all available modes report actual metrics across the fixed suite; provider/coverage unavailability is not converted into fabricated quality scores.

- [ ] **Step 6: Record conservative decision and durable evidence**

Create `p4-revalidation-results.json` and `p4-freshness-quality-evidence.json`. Derive `cutover_ready` only from Task 6. Do not tune RRF/lexical/query behavior against the 24 cases inside P4 to chase the thresholds.

Even if all gates are green, leave `production_source: legacy-control`; P4 only makes a future cutover review eligible.

- [ ] **Step 7: Run final implementation verification and self-review**

Run the full Reference Graph governance workflow on the final implementation SHA, broad secret scan, production catalog validation, fresh migrations `001`-`005`, and branch diff against P3. Confirm there are no `design-with-ai` routing/cutover changes, no ANN, no benchmark-targeted revalidation logic, and no unrelated governance repair.

Expected: all P4-owned gates green. Any unchanged inherited Release Governance failure is documented with base evidence.

- [ ] **Step 8: Bind receipt to the final verified implementation and commit evidence**

Write the final tested implementation SHA and successful Reference Graph governance run into the receipt, secret-scan it, commit durable catalog/evidence/index changes, then verify the receipt commit with permanent Reference Graph governance.

```bash
git add reference-graph/evidence/p4-revalidation-results.json reference-graph/evidence/p4-freshness-quality-evidence.json knowledge/design-references/data knowledge/design-references/index.json knowledge/design-references/INDEX.md
git commit -m "chore: record P4 freshness and quality evidence"
```

Expected final state: P4 evidence complete or honestly blocked, PR still draft/unmerged unless explicitly authorized, production source still `legacy-control`, and no cutover performed.
