# Reference Graph P7 Lexical Parity Design

## Status

Design for a stacked P7 phase on final P6 head `0dc105ef4a1ea3f9b6512598a4f5996e2be95c5f`.

P7 remains experimental, draft, unmerged, and non-cutover. Production remains `legacy-control` throughout this phase.

## Goal

Prove that the Reference Graph can reproduce the established **quick-profile legacy lexical selection semantics** from graph-resident data without benchmark-specific weights, expected IDs, freshness inflation, or semantic fusion.

P7 is a correctness/parity phase, not a retrieval-optimization phase.

## Why P7 Exists

P6 fixed two real structural mismatches:

1. surface/platform are preferences/coverage constraints, not hard eligibility filters;
2. weak semantic evidence must not blindly displace lexical candidates.

Those changes were correct but did not produce quality parity. Final P6 live evidence showed:

- P5 legacy lexical baseline: overlap `0.59375`, top-1 `0.75`;
- P6 lexical: overlap `0.4895833333`, top-1 `0.7916666667`;
- P6 guarded hybrid: overlap `0.4270833333`, top-1 `0.7083333333`.

The remaining mismatch is now primarily **scoring semantics**.

The legacy quick selector scores a record with more information than P6 uses:

- exact surface `+60`;
- exact platform `+15`;
- token overlap across `job + dimensions + surface` versus `recordSearchText(record)`, multiplied by `5`;
- `multiStateFlow +4`;
- `ordinaryOrFailureProne +3`;
- `evidenceClass === TESTED +3`;
- `accessStatus === AVAILABLE +2`;
- visual-request boost `+25` for `visual-verified`;
- visual-request penalty `-20` for help/docs/guide/support/marketing page roles;
- dynamic product/source/topology repeat penalties `20/8/6`;
- constructive quick coverage.

P6 intentionally implemented only the frozen `60/15/5` relevance values plus `20/8/6` diversity. It therefore did **not** implement full legacy lexical semantics.

## Core Decision

P7 will implement a **graph-native parity selector** for quick requests.

It will not tune a new ranking model.

The P7 selector must be a faithful independent implementation of the pre-existing legacy quick policy using graph-resident fields only. Test code may compare P7 output to the legacy selector; production P7 code must not import the legacy selector, design-reference catalog, shadow cases, expected IDs, or historical evidence.

## Correctness Before Candidate Pruning

P7 will deliberately retrieve the complete **currently eligible graph pool** for each quick request before ranking.

At the current control date this pool is 275 assets. This is acceptable for a bounded correctness phase.

Why:

- the legacy selector ranks the complete eligible record pool;
- a query-token-only candidate prefilter can exclude records that still rank through surface/platform and static evidence bonuses;
- a top-N prefilter cannot be proven parity-safe under dynamic diversity penalties without a separate bound;
- optimizing candidate generation before semantic parity is proven would confound correctness and performance.

P7 will record latency but will not introduce ANN, a learned prefilter, or benchmark-tuned pruning.

A later phase may optimize candidate generation after P7 establishes a parity oracle.

## Data Representation Parity

### Existing graph search text

`adaptLegacyDesignReference()` already stores a chunk containing:

- title;
- product;
- page role;
- first-screen job;
- topology;
- traversal;
- responsive behavior;
- visual world;
- strengths;
- weaknesses;
- transferable decisions;
- flow states;
- tags.

Legacy `recordSearchText()` contains the same fields plus:

- `surfaceFamily`;
- `motion`.

Therefore P7 can reconstruct the legacy token set as:

`chunk search text + surface_family + motion`.

Tokenization must match the legacy selector exactly: lowercase ASCII `[a-z0-9]`, split non-alphanumeric runs, keep tokens longer than one character, set semantics.

### Missing static score fields

Current asset metadata does not persist all static legacy score fields. P7 will extend `adaptLegacyDesignReference()` metadata with:

- `evidence_class`;
- `ordinary_or_failure_prone`;
- `multi_state_flow`.

No `contentText` field may change in this metadata-enrichment step.

Because asset/chunk identity is derived from source/locator plus content hash, metadata-only enrichment must preserve:

- source IDs;
- asset IDs;
- chunk IDs;
- asset content hashes;
- chunk `text_hash`;
- persisted embedding compatibility.

The dedicated target may be re-imported only after tests prove this identity invariant.

## Migration 007

Add a parallel service-role-only RPC:

`public.reference_graph_quick_candidate_pool_p7(jsonb)`

It returns every current eligible asset for a reference date with the graph-resident fields required by the P7 parity selector.

Hard eligibility remains exactly:

- current asset version;
- `review_status = reviewed`;
- access status `AVAILABLE` or `PAYWALLED`;
- `last_verified_at + ttl_days >= reference_date`.

Surface and platform are **not** SQL eligibility predicates.

The RPC must return, per asset:

- asset ID;
- legacy ID;
- product;
- surface family;
- platform;
- page role;
- motion;
- source family;
- deterministic topology;
- access status;
- evidence class;
- ordinary/failure-prone boolean;
- multi-state-flow boolean;
- tags;
- concatenated chunk search text.

Ordering is deterministic by asset ID. No query text or benchmark information is accepted by the RPC.

P5 and P6 RPCs remain unchanged.

## Pure P7 Parity Policy

Create a pure JS selector:

`selectP7ParityLexicalResults({ candidates, request, maxItems })`

It supports `profile === quick` only.

For each candidate it computes the legacy quick base score exactly:

1. query token set from `job + dimensions + surface`;
2. search token set from `search_text + surface_family + motion`;
3. exact surface `+60`;
4. exact platform `+15`;
5. overlap token count `×5`;
6. multi-state flow `+4`;
7. ordinary/failure-prone `+3`;
8. TESTED evidence `+3`;
9. AVAILABLE access `+2`;
10. for visual requests, `visual-verified +25`, otherwise page-role help/docs/guide/support/marketing `-20`.

Selection then applies the existing dynamic diversity penalties:

- repeated product `20` each;
- repeated source family `8` each;
- repeated topology `6` each.

Quick constructive coverage remains:

- if a surface is requested: at least 1 exact-surface result when jointly feasible;
- if a platform is requested: at least `ceil(maxItems / 2)` exact-platform results when jointly feasible;
- overlapping predicates count for both;
- infeasible coverage stays deterministic and reports gaps honestly.

Every candidate must carry a non-empty `legacy_id`. Final score ties must be resolved by `legacy_id.localeCompare(...)`, exactly matching the legacy selector's `record.id` ordering. `asset_id` is transport identity only and must never decide a parity tie.

## Parity Testing Strategy

P7 must prove semantic equivalence without reading benchmark outcomes in production.

Tests will include:

1. synthetic score decomposition for every static bonus and penalty;
2. visual request boost/penalty behavior;
3. constructive coverage and infeasible coverage;
4. permutation/tie determinism, including a fixture where asset-ID order disagrees with legacy-ID order;
5. metadata-only import identity invariance;
6. a test-only parity harness that projects committed design-reference records through `adaptLegacyDesignReference()` and compares P7 selected legacy IDs with `selectRecords()` at a fixed date;
7. randomized/synthetic quick requests independent of the 24 shadow cases;
8. the existing 24 cases as a regression check only, never as production input.

The anti-leakage CI guard must reject production P7 references to:

- `shadow-cases.json`;
- P5/P6/P7 evidence files;
- known case IDs;
- expected legacy IDs;
- per-case scores.

## Live Re-import

P7 may re-import the committed 600-record catalog to the dedicated Supabase target **only to enrich metadata**.

Before and after re-import evidence must prove:

- source count unchanged;
- asset count unchanged at 600;
- current asset count unchanged at 600;
- chunk count unchanged at 600;
- embedding count unchanged at 600;
- current fresh eligible pool unchanged at 275;
- exact Snowflake coverage remains 275/275;
- no text-hash mismatches;
- no new assets/chunks are created from metadata enrichment.

Run the re-import twice and require idempotent counts/IDs.

No catalog source JSONL record, review status, TTL, verification date, or access authority is changed by P7.

## P7 Operator

Add a read-only P7 quality operator with modes:

- `--current-control`;
- `--candidate-pool`;
- `--supabase-p7-parity-lexical`.

The live parity mode uses only the P7 candidate-pool RPC and pure P7 policy.

Semantic embeddings are not part of the terminal P7 retrieval path. Existing embeddings remain intact and are checked after metadata re-import only to prove no identity drift.

## P7 Receipt

The P7 receipt binds:

- P6 base SHA;
- P7 implementation SHA;
- target identity;
- migration 007 hash/history;
- metadata re-import identity evidence;
- current control health;
- graph candidate-pool count;
- P7 parity lexical evaluation;
- unchanged quality gates;
- production source `legacy-control`.

P7 may set `eligible_for_cutover_review: true` only if all of the following are true:

- every phase succeeds;
- current control is 24/24 with zero coverage gaps;
- metadata re-import preserved all graph identities/counts;
- exact embedding compatibility remains 275/275 after re-import;
- all 24 evaluation cases are comparable;
- P7 parity lexical passes every unchanged quality gate.

Even then P7 never performs cutover.

## Quality Gates

Unchanged:

- at least 20 cases;
- at least 20 comparable cases;
- average overlap `>= 0.65`;
- legacy top-1 retention `>= 0.75`;
- graph empty rate `<= 0.05`;
- exact surface rate `>= 0.70`;
- exact platform rate `>= 0.80`.

No threshold lowering is permitted.

## Historical Evidence

P3, P4, P5 and P6 evidence remain immutable.

P7 must preserve the P6 negative result rather than overwrite it. P7 evidence is a new artifact.

## Live Target

Only:

- project ref `vrznfnxzlxaavpqbzbzd`;
- project `agent-hub-reference-graph`;
- region `eu-central-1`.

No production database or alternate project may be used.

## Non-goals

P7 does not:

- tune weights against the 24 cases;
- add semantic/hybrid ranking;
- add ANN or vector indexes;
- optimize candidate-pool size;
- mutate freshness/review/TTL authority;
- fabricate relations;
- change standard/deep legacy behavior;
- cut over production;
- merge the stacked PR;
- repair unrelated `write-swift` release governance.

## Stop Boundary

P7 ends after:

1. implementation is fully tested;
2. migration 007 and metadata parity import are live only on the dedicated target;
3. 24-case P7 parity lexical evidence is committed;
4. permanent Reference Graph governance is green on the final evidence head;
5. stacked P7 PR remains draft/open/unmerged;
6. decision is recorded as either `NO CUTOVER` or `eligible_for_cutover_review: true`.

No production route changes happen in P7.