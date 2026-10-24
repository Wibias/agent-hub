# Reference Graph P6 — Retrieval Quality

## Status

Design approved for implementation on stacked branch `agent/reference-graph-p6`, based exactly on final P5 evidence head `fd904355c7d62ad716766eab3bfc41539f5ed18a`.

P6 is **not** a cutover phase. It may improve live shadow quality and may produce evidence eligible for a later cutover review, but it must not switch production retrieval, merge itself, lower quality gates, rewrite P3/P4/P5 historical evidence, or tune behavior against individual shadow case IDs / expected IDs.

## Starting evidence

P5 removed the control-coverage blocker without changing catalog freshness:

- catalog records: 600
- current fresh/reviewed accessible pool: 275
- stale records: 325
- current control: 24/24 full-limit cases, 0 coverage gaps, healthy
- exact Snowflake embedding coverage: 275/275, 0 missing, 0 text-hash mismatch
- production source: `legacy-control`

Current-date live P5 retrieval:

| Mode | Avg overlap@k | Legacy top-1 | Empty rate | Exact surface | Exact platform |
|---|---:|---:|---:|---:|---:|
| Lexical | 0.59375 | 0.75 | 0.04167 | 0.95833 | 0.95833 |
| Semantic | 0.41667 | 0.29167 | 0.04167 | 0.95833 | 0.95833 |
| Hybrid | 0.47917 | 0.625 | 0.04167 | 0.95833 | 0.95833 |

Unchanged cutover gates remain:

- minimum cases: 20
- minimum comparable cases: 20
- average overlap >= 0.65
- top-1 retention >= 0.75
- graph empty rate <= 0.05
- exact surface rate >= 0.70
- exact platform rate >= 0.80

P6 does not weaken these values.

## Planning diagnosis

A credential-free P6 diagnosis (`39982927035`) compared the committed P5 per-case evidence without querying or mutating the live database.

Semantic versus lexical:

- overlap improved: 1/24
- overlap equal: 10/24
- overlap regressed: 13/24
- top-1 gained: 1
- top-1 lost: 12

Hybrid versus lexical:

- overlap improved: 0/24
- overlap equal: 15/24
- overlap regressed: 9/24
- top-1 gained: 1
- top-1 lost: 4

The three sparse live cases are sparse in every mode:

- `auth-mobile`: 1 candidate
- `editorial-mobile`: 2 candidates
- `design-system-mobile`: 0 candidates

The temporary diagnosis workflow was removed immediately after measurement and is not part of the P6 product diff.

## Root causes

### 1. Candidate-pool semantics do not match the control contract

The P5 control treats requested `surface` and `platform` as **preference + coverage constraints**. For `quick`, the result only needs:

- at least 1 exact requested surface result
- at least `ceil(limit / 2)` exact requested platform results
- `limit` total results when the eligible pool makes that feasible

The live Reference Graph RPCs instead apply requested surface and platform as hard SQL `WHERE` filters. This makes non-exact but valid fresh candidates impossible to retrieve and explains why an otherwise healthy 275-record control can collapse to 1, 2, or 0 graph candidates in specific cells.

Freshness/access/model eligibility and request preference are therefore currently conflated.

### 2. Hybrid fusion is score-blind

`retrieveReferenceBundle()` currently uses equal-channel reciprocal-rank fusion:

`1 / (60 + rank)`

for lexical and semantic candidates. Raw lexical overlap and semantic cosine similarity are discarded. A weak semantic channel can therefore displace a stronger lexical candidate solely through rank arithmetic.

P5 empirically confirms this failure mode: hybrid produced no overlap improvement over lexical in any of the 24 cases and regressed 9.

### 3. Lexical ranking omits established generic selection policy

The graph lexical RPC ranks only by count of distinct matching query tokens plus stable ID tie-break. The pre-existing legacy selector, written before P6, uses generic request and diversity signals including:

- exact surface preference: +60
- exact platform preference: +15
- token overlap: ×5
- repeated product penalty: 20 per already-selected result
- repeated source-family penalty: 8
- repeated topology penalty: 6

P6 may reuse these already-established generic policy values because they predate P6 evidence and describe desired selection behavior. P6 must not derive new weights from P6 shadow outcomes.

Not every legacy secondary bonus is represented losslessly in current graph metadata. P6 therefore reuses only signals with an unambiguous graph representation. It must not guess missing legacy fields merely to increase benchmark parity.

## Decision

P6 introduces a **parallel, versioned P6 retrieval path** with three properties:

1. eligibility and preference are separated;
2. lexical ranking is control-policy-aware and diversity-aware using only frozen, generic pre-P6 signals represented in the graph;
3. semantic evidence is guarded and cannot blindly override stronger lexical evidence.

The P5 RPCs remain intact. P6 creates new RPC names and new JS policy code so P3/P4/P5 evidence remains reproducible and historically meaningful.

## Hard eligibility remains unchanged

Every P6 candidate path must still require:

- current asset version
- `review_status = reviewed`
- access status in `AVAILABLE | PAYWALLED`
- `last_verified_at + ttl_days >= reference_date`
- exact pinned model/revision for semantic candidates

No stale/unreviewed/blocked/unavailable record may enter a P6 candidate pool.

Surface and platform are **not** hard eligibility predicates in P6.

## Versioned P6 candidate RPCs

Add migration `006_reference_graph_retrieval_quality.sql` with new service-role-only functions:

- `public.reference_graph_lexical_candidates_p6(text, jsonb, integer)`
- `public.reference_graph_semantic_candidates_p6(text, text, text, jsonb, integer)`
- `public.reference_graph_candidate_context_p6(uuid[], jsonb)`

The old P5 RPC functions are not replaced or dropped.

### Lexical candidate pool

The P6 lexical RPC:

- keeps the P5 partial-token matching behavior;
- keeps `reference_date` freshness enforcement;
- removes surface/platform from SQL eligibility filtering;
- returns raw distinct-token overlap as `score`;
- keeps deterministic rank and ID tie-break;
- remains bounded to 1..100 candidates.

Surface/platform preference is applied by the JS retrieval policy after context is loaded, not by SQL exclusion.

### Semantic candidate pool

The P6 semantic RPC:

- keeps exact model/revision enforcement;
- keeps freshness/access/current-asset eligibility;
- removes surface/platform from SQL eligibility filtering;
- returns cosine similarity as `score` and deterministic similarity rank;
- remains bounded to 1..100 candidates.

No P6 model substitution, new model, query-prefix tuning, or embedding rewrite is allowed.

### Candidate context

The P6 context RPC returns all eligible seed candidates irrespective of requested surface/platform and exposes the generic ranking fields needed by P6:

- existing asset metadata, including `legacy_id`, `product`, `surface_family`, `platform`, `page_role`, `flow_states`
- tags
- `source_family` joined from `reference_graph.sources`
- `topology` from the asset's topology observation when present

Relations remain unchanged. P6 does not create graph relations merely to improve ranking.

## P6 lexical policy

Add `reference-graph/retrieval-policy.mjs` as a pure deterministic module. It must not import shadow cases, evidence JSON, benchmark IDs, or catalog files.

For each lexical candidate represented in graph context, compute a frozen base score from signals that already existed before P6 and are losslessly represented:

- raw lexical token overlap × 5
- +60 when `surface_family` equals requested surface
- +15 when `platform` equals requested platform

No other P6-specific relevance weight is introduced.

Selection is greedy and recalculates the already-established diversity penalties after every chosen result:

- repeated product: `20 * count`
- repeated source family: `8 * count`
- repeated topology: `6 * count`

Adjusted score is:

`base score - product penalty - source-family penalty - topology penalty`

Stable asset ID is the final tie-break.

These values are frozen from the pre-P6 legacy selector. Changing them after observing P6 shadow results is out of scope and requires a new phase/spec.

## Constructive request coverage

The P6 lexical/hybrid result selector applies the same generic quick coverage semantics established in P5 when `request.profile === "quick"`:

- exact surface minimum: 1 when a surface is requested
- exact platform minimum: `ceil(maxItems / 2)` when a platform is requested
- total: `maxItems` when feasible

Among candidates that preserve feasible completion, choose the highest current adjusted score. If no feasible completion exists, return the best deterministic result and report actual metadata rates honestly.

This is not benchmark-specific and does not require expected IDs.

Standard/deep graph retrieval behavior is not expanded in P6. The P6 live-quality operator uses the fixed quick-profile shadow suite. A future production integration must separately define non-quick retrieval policy before routing traffic.

## Guarded semantic policy

P6 does not use equal-channel RRF for the terminal hybrid candidate.

Semantic is **supplemental**:

1. lexical candidates establish the primary candidate ordering and score;
2. a candidate present in both channels retains its lexical base score; semantic rank may only break a final stable-ID tie between candidates with the same adjusted lexical score;
3. semantic-only candidates are eligible only after all positive-score lexical candidates are exhausted or when they are required to fill a still-feasible declared quick coverage slot that no remaining lexical candidate can satisfy;
4. semantic-only ordering uses semantic similarity rank with stable ID tie-break;
5. semantic evidence cannot reduce the number of positive-score lexical candidates selected when those lexical candidates can fill the requested result and coverage contract.

This policy is intentionally conservative because P5 showed semantic overlap regressing lexical in 13/24 cases and equal RRF never improving lexical overlap.

Semantic-only mode remains available as diagnostic evidence but is not allowed to determine P6 cutover eligibility by itself.

## Why P6 does not tune a semantic confidence threshold

The current semantic profile is experimental and P5 provides no independent calibration set for converting cosine score or top-1 margin into a trustworthy cross-query confidence probability. Choosing a threshold from the 24 shadow cases would be benchmark fitting.

P6 therefore uses a structural guard rather than a learned threshold. A future phase may introduce a separate training/calibration population and score-aware fusion if justified.

## Benchmark independence

P6 production code must not import, read, inspect, or special-case:

- `reference-graph/shadow-cases.json`
- P5/P6 evidence JSON
- shadow case IDs
- expected legacy IDs
- per-case P5 outcomes
- cutover threshold values as ranking inputs

Permanent CI must source-scan the P6 policy, store adapter, migration, and operator for benchmark fixture/evidence dependencies.

The 24-case suite remains an evaluation consumer only.

## Historical evidence and RPC compatibility

P3/P4/P5 evidence is immutable.

P6 must not overwrite the deployed P5 RPC definitions. Migration 006 only adds `_p6` functions. This preserves the ability to distinguish:

- historical P5 behavior
- experimental P6 behavior

The P6 store adapter and retriever explicitly opt into P6 RPC names. Existing P3/P4/P5 callers remain unchanged.

## Store and retriever interfaces

Extend `ReferenceGraphSupabaseStore` with explicit read-only P6 methods:

- `lexicalCandidatesP6(query, filters, limit)`
- `semanticCandidatesP6(embedding, modelId, modelRevision, filters, limit)`
- `candidateContextP6(assetIds, filters)`

Add a P6 shadow retriever that passes the full request to the pure policy module. Existing `createSupabaseShadowRetriever()` behavior remains unchanged for historical tests.

P6 candidate limit remains 24 for live evaluation unless the existing operator contract supplies a smaller bounded value. Result limit remains the request limit (4 for the fixed suite).

## Live deployment boundary

P6 may apply migration 006 only to the dedicated experimental target:

- purpose: `agent-hub-reference-graph`
- project ref: `vrznfnxzlxaavpqbzbzd`
- region: `eu-central-1`

No catalog import, freshness write, embedding rewrite, relation write, or production routing change is part of P6.

Before live measurement, P6 re-verifies:

- target identity
- current control still healthy: 24/24, 0 gaps
- exact embedding coverage still complete: 275/275, 0 missing, 0 hash mismatch
- P5 evidence files unchanged

## P6 live shadow

After migration and gates pass, run current-date read-only evaluation for:

1. P5 lexical baseline (historical comparison, unchanged RPC)
2. P6 lexical policy
3. P6 semantic diagnostic
4. P6 guarded hybrid policy

The terminal P6 decision is based on the guarded hybrid summary against the unchanged quality gates.

P6 evidence must separately report:

- candidate-pool fill rate
- quick coverage feasibility/result
- overlap/top-1/empty/exact metadata rates
- latency
- lexical-to-hybrid regression counts

A guarded hybrid that passes global thresholds but regresses lexical overlap/top-1 on a material number of cases must still be reported; P6 does not hide per-case regressions behind averages.

## P6 receipt

Add a terminal `reference-graph.p6-receipt.v1` contract recording:

- exact target binding
- P5 base SHA
- tested P6 implementation SHA
- migration 006 identity
- current-control health
- exact embedding coverage
- P5 historical baseline summary
- P6 lexical/semantic/guarded-hybrid summaries
- unchanged quality thresholds
- per-mode availability
- production source
- blockers
- final decision

`production_source` remains `legacy-control` regardless of score.

P6 may set `eligible_for_cutover_review: true` only when:

- all required implementation/governance phases succeeded
- current control is structurally healthy
- exact embedding coverage is complete
- guarded hybrid evidence is available
- guarded hybrid `cutover_ready === true`
- P6 has not changed thresholds or catalog authority

Even then P6 performs **no cutover**.

## Durable evidence

Add:

- `reference-graph/evidence/p6-retrieval-quality-evidence.json`

The artifact must be secret-free and bind:

- final tested implementation SHA
- dedicated target identity
- migration identity
- live measurement run / reference time
- exact query embedding profile/artifact identity
- P5 baseline
- P6 summaries and per-case evidence
- terminal receipt

## CI requirements

Permanent Reference Graph governance must add P6 gates for:

1. P6 policy unit tests.
2. P6 candidate RPC migration structure and grants.
3. Freshness/access predicates remain present in all P6 candidate/context RPCs.
4. Surface/platform are absent from P6 eligibility `WHERE` predicates.
5. P5 RPC definitions and P5 evidence remain unchanged.
6. P6 source-level anti-benchmark-leakage guard.
7. Guarded hybrid cannot displace fillable positive-score lexical results in synthetic fixtures.
8. Quick coverage remains constructive when feasible and honest when infeasible.
9. Deterministic output under input permutation/ties.
10. Secret scan covers P6 receipt/evidence/operator.
11. Migration smoke verifies `_p6` functions are service-role-only.

## Explicit non-goals

P6 does not:

- lower quality thresholds
- rewrite the 325 stale records
- change P5 current-control selection
- replace or retrain Snowflake embeddings
- learn fusion weights or confidence thresholds from the 24 cases
- add ANN/HNSW/IVFFlat
- add relations merely for score improvement
- build browser capture UI / extension
- route `design-with-ai` to Reference Graph
- repair unrelated `write-swift` release governance
- merge itself
- cut over production

## Stop conditions

Stop P6 with `NO CUTOVER` evidence if any of these occur:

- current control becomes unhealthy
- exact embedding coverage is incomplete
- P6 requires catalog/freshness mutation to make progress
- candidate-policy implementation would require case IDs / expected IDs
- migration security/grants cannot be verified
- guarded hybrid remains below any unchanged quality gate

Passing gates changes only the terminal state to `eligible_for_cutover_review`; it does not authorize a routing change.
