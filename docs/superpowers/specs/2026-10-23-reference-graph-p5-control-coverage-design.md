# Reference Graph P5 — Control Coverage + Comparable Live Shadow

## Status

Design approved for implementation on the stacked branch `agent/reference-graph-p5`, based exactly on final P4 evidence head `4621574eca88f30296452b25fcb04be3a496d7d5`.

P5 is intentionally **not** a cutover phase. It may produce evidence that is eligible for later cutover review, but it must not switch production retrieval, lower quality gates, merge itself, or rewrite the immutable P3/P4 evidence history.

## Problem

P4 completed a full benchmark-independent revalidation of the 600-record catalog and left an honest current population of 275 reviewed, accessible, fresh records plus 325 stale records. Exact Snowflake embedding coverage for the 275 currently eligible chunks is complete (`275/275`, no missing rows, no text-hash mismatch), but the current legacy control is still unhealthy because 3 of the 24 fixed quick-profile control requests report coverage gaps.

A credential-free P5 planning diagnosis on 2026-10-23 showed that the three failures are all **platform coverage** failures, not result-count failures:

- `authenticated-home × native-mobile`: selected platform coverage `1/2`, even though the current catalog already contains **8** fresh exact `authenticated-home × native-mobile` records.
- `auth-onboarding × native-mobile`: selected platform coverage `1/2`; the exact cell has only **1** fresh record.
- `design-system-craft × native-mobile`: selected platform coverage `0/2`; the exact cell has **0** fresh records.

The same diagnosis evaluated every taxonomy `surfaceFamily × platform` cell against a derived quick default exact-cell floor of 2 and found three underfilled cells (`auth-onboarding/native-mobile`, `design-system-craft/native-mobile`, `public-home/native-mobile`). That inventory observation is useful context, but it is **not** the selector's actual coverage contract: the selector requires a minimum number of selected records matching the requested surface and a minimum number matching the requested platform, and those records do not have to be the same records.

The critical finding is therefore that P4's 3 control gaps do **not** prove that stale records need to be refreshed. The legacy selector already computes generic coverage requirements, but only checks them **after** ranking. It does not construct the result set so that those requirements are met when the eligible pool makes them feasible.

Planning diagnosis:

- GitHub Actions run: `39911236955`
- artifact: `p5-gap-diagnosis`
- artifact ZIP SHA-256: `33733eea16e0bf95224751cfc20198fd5c1439beebf7884531b549db7d01e132`
- reference time: `2026-10-23T12:00:00.000Z`
- eligible records: `275`
- stale records: `325`
- quick default limit: `4`
- quick platform minimum: `2`

The temporary diagnostic workflow was removed immediately after measurement and is not part of the P5 product diff.

## Decision

P5 will repair the **existing quick-profile selection contract**, not manufacture freshness.

For `profile: quick`, `selectRecords()` already declares these post-selection coverage requirements:

- requested surface: at least **1** selected result with the exact `surfaceFamily`
- requested platform: at least `ceil(limit / 2)` selected results with the exact `platform`
- requested total: exactly `limit` results when enough eligible records exist

P5 makes those requirements constructive: when a feasible result set exists in the current eligible pool, quick selection must deterministically return a set satisfying them. Ranking remains score-driven within the feasible set. When no feasible set exists, the selector must still return the best deterministic bounded result and report the remaining coverage gap honestly.

This repair is intentionally limited to the **quick profile**. Standard/deep selection has additional quota behavior and is not needed to resolve the P5 control blocker. Extending constructive coverage to those profiles without an independent requirement would expand production behavior unnecessarily.

## Why stale records are not a P5 recovery target

The 325 stale records were just reviewed in P4 and deliberately made ineligible because their previous analysis could not be safely confirmed. Re-running the same records merely because a benchmark control is red would couple maintenance authority to evaluation pressure.

P5 therefore has these rules:

1. No stale record becomes reviewed merely to improve coverage.
2. No `lastVerifiedAt`, TTL, review status, surface family, or platform is changed as a side effect of P5 selector work.
3. P5 does not freeze a stale-record recovery population.
4. If the generic quick selector repair cannot make the current control healthy using the existing 275 eligible records, P5 ends with `no-cutover` evidence. A later maintenance phase may then define a new research/acquisition project independently of the shadow benchmark.

This keeps P4's revalidation authority intact and prevents benchmark leakage.

## Benchmark independence

The P5 selector implementation must not import, read, inspect, or special-case:

- `reference-graph/shadow-cases.json`
- shadow case IDs
- expected legacy IDs
- P3/P4 quality scores
- the three diagnosed failing case names

Tests for the selector repair use synthetic records and generic quick requests. Permanent CI must include a source-level guard that fails if the selector/coverage implementation depends on the shadow-case fixture.

The fixed 24-case suite remains an **evaluation consumer only**.

## Selection architecture

### Existing ranking stays authoritative

The current selector's eligibility, base score, diversity penalty, stable ID tie-break, and result limit remain unchanged except where choosing the next unconstrained candidate would make the declared quick coverage requirements impossible to satisfy with the remaining slots.

P5 must not increase the platform score, add case-specific bonuses, alter freshness policy, or tune ranking weights against observed benchmark outputs.

### Quick coverage feasibility

Add a focused helper in `knowledge/design-references/scripts/selection.mjs` (or a small sibling module if the implementation becomes clearer) that evaluates whether a partial quick selection can still satisfy:

- `minimumSurface = request.surface ? 1 : 0`
- `minimumPlatform = request.platform ? ceil(request.limit / 2) : 0`
- final selected count `request.limit`

For a candidate under consideration, feasibility is computed against the still-unselected eligible pool. Because quick coverage has only two binary predicates (exact surface and exact platform) and no stratum quotas, feasibility can be decided deterministically from counts of:

- records matching both predicates
- surface-only records
- platform-only records
- records matching neither

The selector chooses the highest existing adjusted-score candidate that leaves a feasible completion. If no candidate can preserve feasibility, it falls back to the existing deterministic best candidate and later reports the real gap.

This is not a new quality threshold. It makes the selector obey constraints it already reports as required.

### Preserve diversity behavior

The existing diversity penalty is recalculated from the records already selected. Feasibility filters candidates; it does not replace the scoring function. Among candidates that keep the requested quick coverage feasible, the same adjusted score and stable ID tie-break decide the next result.

### Infeasible requests fail honestly

Synthetic tests must cover pools where:

- surface coverage is impossible
- platform coverage is impossible
- both are individually possible but cannot both fit in the remaining result limit

The selector must remain deterministic and must return `coverageGaps` rather than fabricate or duplicate records.

## Current-control gate

After the selector repair is implemented and verified, P5 re-evaluates the current control at a fixed P5 reference time using the same current catalog.

P5 may proceed to live retrieval quality measurement only when:

- case count = 24
- full-limit case count = 24
- cases with coverage gaps = 0
- current control `healthy = true`

No P5 step may change the 275/325 P4 freshness split before this gate is evaluated.

## Embedding gate

Before semantic or hybrid live measurement, P5 must re-check the exact pinned profile:

- profile: `snowflake-arctic-embed-33m-raw-v1`
- model: `ollama/snowflake-arctic-embed:33m`
- revision: `e8db018629b4`
- dimensions: `384`

At the P5 reference date the eligible current chunks must have:

- coverage rate = `1`
- compatible count = eligible chunk count
- missing count = `0`
- text-hash mismatch count = `0`

If catalog eligibility is unchanged, P5 expects the P4 state (`275/275`). It must measure rather than assume it.

## Comparable live shadow

Only after both current-control and embedding gates pass may P5 execute current-date live modes against the dedicated Supabase target:

1. lexical
2. semantic using the exact pinned Snowflake query provider
3. hybrid using the existing RRF fusion path

The existing quality thresholds remain unchanged:

- minimum cases: `20`
- minimum comparable cases: `20`
- minimum average overlap: `0.65`
- minimum top-1 retention: `0.75`
- maximum graph empty rate: `0.05`
- minimum exact surface rate: `0.70`
- minimum exact platform rate: `0.80`

No threshold may be lowered and no ranking weight may be tuned after looking at P5 shadow outcomes.

If the exact query embedding provider is unavailable in the execution harness, semantic/hybrid are recorded as unavailable and P5 remains `no-cutover`. No synthetic or substitute vectors are allowed.

## Target and write boundary

All live Reference Graph checks remain bound to the dedicated project only:

- purpose: `agent-hub-reference-graph`
- project ref: `vrznfnxzlxaavpqbzbzd`
- region: `eu-central-1`

P5 does not require a database migration or catalog import for the selector repair. Live quality work is read-only unless a later implementation finding proves a write is necessary; such a finding must stop execution and require a new reviewed design rather than silently expanding P5.

## P5 receipt

Add a terminal P5 receipt contract that records:

- exact target binding
- tested implementation SHA and verification run
- fixed P5 reference time
- selector contract verification
- current-control health
- exact embedding coverage
- lexical/semantic/hybrid availability and summaries
- unchanged quality thresholds
- production source
- blockers
- final decision

`production_source` must remain `legacy-control` regardless of score.

A P5 receipt may set `eligible_for_cutover_review: true` only when:

- selector contract verification succeeded
- current control is healthy
- exact embedding coverage is complete
- live hybrid evidence is available
- live hybrid summary reports `cutover_ready: true`
- every required P5 phase is successful

Even then P5 does **not** perform cutover.

## Evidence artifacts

Durable artifacts:

- `reference-graph/evidence/p5-control-coverage-evidence.json`
- `reference-graph/evidence/p5-live-shadow-evidence.json`

The first binds the selector-contract repair and current-control gate. The second is the terminal live receipt. Both must be secret-free and bind the tested implementation SHA.

## CI and regression requirements

Permanent Reference Graph governance must verify:

- synthetic quick selection satisfies surface/platform minima whenever feasible
- selector remains deterministic
- infeasible pools still report coverage gaps
- quick coverage repair preserves limit, uniqueness, eligibility, diversity scoring order within feasible candidates, and stable ID tie-break behavior
- standard/deep behavior is unchanged by focused regression fixtures
- selector implementation does not depend on `shadow-cases.json` or case IDs
- P3 and P4 historical evidence remains immutable
- P5 receipt keeps `production_source = legacy-control`
- P5 cannot become review-eligible with unhealthy control, partial/mismatched embeddings, unavailable hybrid evidence, or sub-threshold hybrid quality
- committed P5 evidence is secret-free

## Non-goals

P5 does not include:

- production cutover or routing change to Reference Graph
- merge of P3, P4, or P5
- freshness inflation or blanket revalidation of the 325 stale records
- benchmark-driven source targeting
- threshold lowering
- ranking-weight tuning from P5 outcomes
- ANN / HNSW / IVFFlat
- browser extension or capture UI
- automatic open-web ingestion
- `design-with-ai` routing changes
- unrelated `write-swift` Release Governance repair

## Exit conditions

P5 ends in one of two valid states.

### Comparable evidence available

The repaired generic quick selector makes the current control healthy, exact embeddings remain complete, and current-date live lexical/semantic/hybrid evidence is collected. The receipt records whether unchanged gates pass. Production still remains `legacy-control`.

### Still blocked

If the current 275-record eligible pool cannot satisfy the generic quick coverage contract after the selector repair, or exact semantic execution is unavailable, or quality remains below gates, P5 records the blocker and ends `no-cutover` without changing freshness authority, thresholds, or production routing.
