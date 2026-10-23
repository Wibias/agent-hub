# Reference Graph P4 Freshness + Retrieval Quality Design

Date: 2026-10-23

Status: approved direction on `agent/reference-graph-p4`; no production cutover is authorized by this phase.

## Intent

P4 closes the two evidence gaps left by P3 before any cutover discussion can be meaningful:

1. on 2026-10-23 the legacy selector has only 2 fresh records under its existing `lastVerifiedAt + ttlDays` policy;
2. the dedicated live Reference Graph target has zero compatible persisted document embeddings, so deployed semantic and hybrid quality has not been measured.

P4 restores freshness honestly, persists the exact pinned embedding space, and then measures deployed lexical/semantic/hybrid retrieval. It does not manufacture timestamps, lower gates, change production routing, add ANN, add a browser extension, or wire Reference Graph into `design-with-ai` production selection.

## Existing semantics that P4 preserves

The committed design-reference library is reviewed evidence, not a link list. Its selector considers a record fresh when `daysSince(lastVerifiedAt) <= ttlDays`. The existing live `freshness-report.mjs` performs HEAD/GET health checks for maintenance triage, but it intentionally does not update `lastVerifiedAt`.

Therefore HTTP reachability alone is not revalidation. Advancing `lastVerifiedAt` requires an explicit decision that checked both the underlying source and whether the committed analysis still represents that source. A revalidation does not rewrite the historical `reviewedAt` or `reviewedBy` authority fields.

## Goals

- Add an explicit, deterministic revalidation contract for the maintainable reviewed catalog.
- Revalidate the full stale maintainable population in benchmark-independent waves before current-date retrieval quality is eligible for a cutover-readiness signal.
- Preserve `reviewedAt`/`reviewedBy` while allowing a confirmed reference to advance `lastVerifiedAt` and access state.
- Mark records that cannot be reconfirmed as stale or archived instead of silently refreshing them.
- Keep old Reference Graph captures as provenance while retrieving only the current eligible asset for each legacy reference.
- Make deployed graph eligibility follow the same review/access/TTL reference date as the legacy control.
- Persist real document embeddings for profile `snowflake-arctic-embed-33m-raw-v1`, model `ollama/snowflake-arctic-embed:33m`, revision `e8db018629b4`, dimensions `384`.
- Verify embedding compatibility by model, revision, dimensions, and exact chunk text hash.
- Measure current-date deployed lexical, semantic, and hybrid retrieval plus the fixed P2/P3 historical benchmark for regression comparison.
- Produce a durable, secret-free P4 receipt with revalidation completeness, current freshness, embedding completeness, quality metrics, latency, security evidence, and a conservative cutover-readiness signal.
- Keep the independent quality gates unchanged: average overlap >= 0.65, legacy top-1 retention >= 0.75, graph empty rate <= 0.05, exact surface rate >= 0.70, exact platform rate >= 0.80.

## Non-goals

- No production cutover or production-source change.
- No gate lowering or benchmark-specific hard-coding.
- No bulk timestamp reset from link health.
- No requirement that every historical record remain usable: stale/removed references may legitimately leave the active pool.
- No unattended open-web ingestion, crawler fleet, or browser extension.
- No `design-with-ai` adapter/routing change.
- No HNSW/IVFFlat index.
- No feedback-driven authority promotion.
- No unrelated repair of the inherited `write-swift` Release Governance failure.

## Anti-goals

P4 is a failure even if tests are green if it makes stale data look fresh without review evidence, revalidates only benchmark-selected records, substitutes another embedding model/revision, counts stale embeddings as compatible, exposes secrets, changes production routing, or declares cutover readiness from partial catalog/embedding/semantic evidence.

## Approaches considered

### A. Historical quality only

Generate embeddings and continue evaluating only at `2026-07-21` when all 600 records were fresh.

This is reproducible but leaves today's control unusable. Rejected as insufficient.

### B. Bulk freshness reset

Treat live-link success as sufficient to rewrite `lastVerifiedAt` across the catalog.

This is fast but converts availability into review evidence and breaks the library's authority contract. Rejected.

### C. Benchmark-targeted revalidation

Revalidate only records historically selected by the 24 shadow cases, plus alternates as needed.

This is cheaper, but it leaks benchmark labels into the current candidate pool and could artificially improve overlap/top-1 metrics. Rejected.

### D. Full benchmark-independent revalidation + exact-profile embeddings + remeasurement

Revalidate every stale maintainable previously reviewed reference in deterministic maintenance waves, without consulting shadow-case membership. Then import the resulting catalog, persist the exact pinned embedding space, and evaluate current-date retrieval.

Selected because it repairs the evidence surface without weakening provenance or contaminating the benchmark.

## Revalidation contract

P4 introduces explicit revalidation decisions with exactly three verdicts:

- `confirm`: the source was checked and the committed analysis still materially represents it;
- `stale`: the source/analysis could not be reconfirmed as current enough for normal selection;
- `archive`: the reference should remain provenance only.

Every decision includes:

- stable record ID;
- `verifiedAt` date;
- verifier identity;
- `sourceChecked: true`;
- `analysisChecked: true`;
- `rightsChecked: true`;
- observed access status;
- substantive notes.

`confirm` sets `reviewStatus` to `reviewed`, updates `lastVerifiedAt` and access status, and preserves the original `reviewedAt` and `reviewedBy`. This also allows a previously stale reviewed record to return to `reviewed` after genuine revalidation.

`stale` and `archive` set the matching review status. A failed attempt with no valid decision changes nothing. A live-link health result is only triage input and never becomes a revalidation decision by itself.

If the analysis has changed enough that the committed record needs substantive edits, P4 does not silently patch it under a verification event. The record is marked stale and any rewritten analysis goes through the existing candidate/review workflow, which owns new review authority.

## Revalidation population and waves

The P4 revalidation target is benchmark-independent:

- include every non-archived record that is already `reviewed` or `stale` and is stale under the current reference date;
- keep currently fresh reviewed records as already satisfied;
- exclude candidates and archived records from P4 revalidation completeness.

The planner sorts the entire pending population deterministically by maintenance risk/age and emits bounded waves for operator execution. Shadow-case membership, legacy expected results, overlap scores, and graph results are forbidden planner inputs.

P4 current-date cutover readiness requires the entire planned revalidation population to have terminal decisions. The run must not stop merely because the 24 shadow cases become fillable; doing so would selection-bias the candidate pool.

## Reference Graph current-version and freshness model

Existing capture identity already preserves history: changed searchable content creates a new deterministic asset/chunk ID, while unchanged content reuses the same deterministic identity. P4 keeps this behavior.

Migration `005` adds a current eligible legacy-asset projection and verification ledger without rewriting migrations `001`-`004`:

- for assets with a non-empty `legacy_id`, retrieval uses exactly the newest asset for that legacy reference (`captured_at`, then deterministic ID tie-break);
- assets without a `legacy_id` remain independently eligible;
- old assets remain stored as provenance;
- deployed lexical, semantic, and context paths share one eligibility rule;
- eligibility requires `review_status = reviewed`, access status `AVAILABLE` or `PAYWALLED`, and `last_verified_at + ttl_days >= reference_date`;
- `reference_date` is supplied by the shadow/control evaluation and defaults to the database current date only when omitted.

P4 also places per-record access status on asset metadata. Existing source-level access metadata remains for compatibility but is not sufficient when multiple legacy records share one canonical source.

The verification ledger is append-only evidence about P4 revalidation actions. It does not itself grant review authority or make an asset eligible; eligibility continues to derive from the reviewed catalog metadata imported into the asset.

## Embedding completeness

The only accepted live embedding identity is:

```text
profile:  snowflake-arctic-embed-33m-raw-v1
model:    ollama/snowflake-arctic-embed:33m
revision: e8db018629b4
dims:     384
```

P4 adds the existing SHA-256 content identity to chunk metadata so deployed coverage can verify that an embedding belongs to the current chunk text, not merely the same chunk/model key.

Before semantic/hybrid evidence is eligible for cutover-readiness evaluation:

- every eligible current searchable chunk has a compatible exact-profile embedding;
- model ID and revision match exactly;
- dimensions are exactly 384 finite numbers;
- persisted `text_hash` equals the current chunk hash;
- missing and hash-mismatched rows count as incomplete;
- persistence is idempotent;
- no alternate model is substituted.

Generating embeddings for stale historical chunks is permitted for the fixed historical regression benchmark, but those rows do not inflate current-date coverage.

If a trusted runner cannot reach both the pinned local Ollama model and Supabase, P4 may export deterministic exact-profile embedding rows from the Ollama-capable runner and import that artifact through the trusted database path. The artifact contains no Supabase credentials and is bound by model digest and artifact hash.

## Shadow evaluation

P4 has two clearly separated evidence clocks:

1. **Current-date evidence** after full revalidation: the primary P4 decision evidence.
2. **`2026-07-21T12:00:00.000Z` historical benchmark**: regression comparison with P2/P3 only.

For each evaluation, graph filters receive the same reference date used by the legacy selector. A historical healthy control cannot masquerade as current freshness.

Lexical, semantic, and hybrid modes are measured independently with the fixed 24-case suite. Semantic/hybrid failures caused by missing provider/model/coverage remain explicitly unavailable/incomplete; fabricated zero-quality scores are forbidden.

P4 does not tune runtime ranking against the 24-case labels by default. If complete, unbiased current data and exact-profile embeddings still miss the existing gates, the receipt records that blocker. Any later ranking optimization should be a separately reviewable phase with its own anti-overfitting design.

## Cutover-readiness semantics

`cutover_ready` is only an evidence signal. It may be true only when all of the following are true:

- full benchmark-independent P4 revalidation is complete;
- current control health is healthy;
- exact current embedding coverage is complete;
- live hybrid evaluation is available;
- the existing quality gates pass;
- required P4 phases/security checks have no blocker.

Even then, `production_source` remains `legacy-control`. P4 cannot change routing. A future cutover requires a separately authorized phase.

## Safety and failure behavior

- Every live database read/write is bound to dedicated project `vrznfnxzlxaavpqbzbzd` (`agent-hub-reference-graph`).
- Service-role credentials remain environment-only and are redacted from diagnostics and receipts.
- Invalid/incomplete revalidation decisions fail closed.
- Partial revalidation forces `cutover_ready: false`.
- Partial/mismatched embedding coverage forces `cutover_ready: false`.
- Missing sources are evidence, not deletion instructions.
- Old captures remain auditable.
- External content remains `untrusted_reference_data`.
- Anonymous/authenticated roles remain denied from privileged RPCs.

## File-level direction

- `knowledge/design-references/scripts/revalidation-lib.mjs` owns pure revalidation decision validation/application.
- `knowledge/design-references/scripts/revalidate-batch.mjs` owns explicit plan/apply rewriting of reviewed JSONL shards.
- `reference-graph/revalidation-plan.mjs` owns benchmark-independent deterministic maintenance waves.
- `reference-graph/schema/005_reference_graph_freshness.sql` owns current-version/freshness/verification/coverage SQL.
- `reference-graph/embedding-pipeline.mjs` remains the provider-neutral vector-row boundary.
- `reference-graph/live-shadow.mjs` and `shadow-eval.mjs` remain retrieval/evaluation owners.
- `reference-graph/p4-receipt.mjs` owns terminal P4 phase/evidence state.
- permanent Reference Graph CI executes the complete P4 contract against fresh PostgreSQL/pgvector.

## Acceptance criteria

P4 is complete when:

- revalidation decisions are explicit, deterministic, tested, and cannot be replaced by link-health success;
- the revalidation planner is benchmark-independent and the entire stale maintainable population receives terminal decisions or is recorded as incomplete;
- `reviewedAt`/`reviewedBy` are not silently rewritten by verification;
- stale/archive decisions are ineligible for normal selection;
- prior capture provenance remains available while deployed retrieval selects only the current legacy asset;
- graph eligibility uses the same reference date/access/review/TTL semantics as the legacy control;
- live import remains idempotent;
- exact-profile current embedding coverage is measured by model/revision/text hash and is complete before semantic/hybrid cutover-readiness evaluation;
- current-date lexical, semantic, and hybrid live evidence is recorded where available, with the historical benchmark separately labeled;
- no benchmark-label-driven ranking change is folded into P4;
- the durable P4 receipt is secret-free, terminal, and bound to the final verified implementation SHA;
- permanent Reference Graph CI passes migrations `001` through `005` and exposed-role denial checks;
- no production routing change, gate weakening, ANN, browser capture, `design-with-ai` integration, or unrelated Release Governance repair is included.
