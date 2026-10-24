# Reference Graph P11 — Reversible Quick Runtime Router Design

## Intent

P10 proved that the certified quick Reference Graph candidate pool can be served through a least-privilege publishable-key transport with 24/24 record and pattern parity, zero P9/P10-attributable Security Advisor warnings, and deterministic fallback. P11 integrates that proven transport into the real design-reference query entrypoint without making graph activation the default and without broadening support beyond `quick`.

The production boundary remains conservative: the legacy selector is always computed first and remains the fallback oracle. The graph path may become authoritative only for a `quick` request when an explicit runtime activation flag is enabled **and** the graph-selected ordered records and ordered patterns exactly match the legacy result for that same request. Any transport, snapshot, payload, hydration, selection, pattern, or parity failure returns the unchanged legacy result.

P11 therefore creates a reversible production routing mechanism, not an automatic rollout.

## Goals

- Add one small production runtime router between `query.mjs` and the existing selection/pattern/usage functions.
- Keep the default source legacy when no activation flag is present.
- Permit graph authority only for `quick` and only when `REFERENCE_GRAPH_QUICK_RUNTIME=graph` exactly.
- Use P10's publishable-key current-date projection transport; never use service-role credentials at runtime.
- Reuse the frozen P7 quick ranking policy, P8 hydration logic, and existing pattern selection.
- Require exact ordered record and pattern parity before returning the graph-derived hydrated result.
- Fail closed to the normal legacy result for every graph-side failure.
- Keep the public `query.mjs` JSON shape and exit-code semantics unchanged.
- Record usage exactly once for the authoritative returned records.
- Keep `standard` and `deep` fully local and guarantee zero graph network calls.
- Produce durable activation-readiness evidence without changing the repository default to graph.

## Non-goals

- No new ranking weights, scoring rules, candidate fields, or benchmark tuning.
- No catalog, freshness, TTL, review, access, embedding, relation, or projection mutation.
- No new Supabase DDL.
- No support for graph-backed `standard` or `deep`.
- No service-role runtime credential.
- No hidden background refresh of the P10 projection.
- No automatic global activation in P11.
- No second production query command.

## Anti-goals

P11 must not make availability depend on the graph. If Supabase is down, the key is missing, the snapshot is stale, the payload is malformed, the graph disagrees with legacy, or the local catalog cannot hydrate a graph ID, the user must receive the same valid legacy result they would have received before P11.

P11 must also not create a benchmark-specific allowlist. Exact parity is checked per live request against the existing production selector; no shadow-case IDs or expected benchmark outputs may appear in production router code.

## Existing Boundary

`knowledge/design-references/scripts/query.mjs` currently owns argument parsing, profile/limit validation, legacy record selection, pattern selection, usage recording, JSON output, and coverage-derived exit status. Its output is consumed as the production design-reference query contract.

P10 provides:

- `fetchP10QuickCandidatePool({ supabaseUrl, publishableKey, fetchImpl, timeoutMs, expectedDate })`
- least-privilege REST/RLS access to `reference_graph_quick_runtime_projection_p10`
- a current-date snapshot gate
- 275/275 candidate parity with the certified P7 pool.

P7/P8 provide:

- `selectP7ParityLexicalResults({ candidates, request, maxItems })`
- `hydrateP8LegacyIds({ records, legacyIds })`
- existing legacy `selectPatterns(...)` behavior.

P9 already proves the correct comparison semantics for ordered records and ordered patterns, but it deliberately always returns legacy. P11 extracts that boundary into a production router with an explicit opt-in authority decision.

## Approaches Considered

### 1. Put transport and fallback directly inside `query.mjs`

This has the smallest file count, but it mixes argument parsing, network transport, graph ranking, parity checks, usage recording, and fallback in the production CLI. That makes failure-path testing harder and turns `query.mjs` into a policy file. Rejected.

### 2. Small runtime router, with `query.mjs` as a thin caller — chosen

Create a focused `reference-graph/p11-runtime-router.mjs` that receives already-loaded records, patterns, and a validated request. It computes legacy first, optionally evaluates the P10 path, decides authority, records usage exactly once, and returns both the unchanged public result and private routing metadata for tests/evidence. `query.mjs` remains responsible for CLI parsing and prints only the public result.

This keeps the existing command stable, isolates the risky decision, and gives one deterministic unit for fallback and rollback tests.

### 3. Add a separate graph-aware production query command

This preserves `query.mjs` byte-for-byte, but creates two production entrypoints and forces all callers/docs/indexes to migrate. It increases rollout surface without improving safety. Rejected.

## Activation Contract

The only activation flag is:

`REFERENCE_GRAPH_QUICK_RUNTIME=graph`

Rules:

- Missing flag: legacy, zero graph fetch.
- Any value other than exact `graph`: legacy, zero graph fetch.
- `standard` / `deep`: legacy, zero graph fetch regardless of flag.
- `quick` + `graph`: graph attempt is allowed only when both `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are non-empty.
- Missing graph transport configuration fails closed to legacy with zero network activity.
- No `SUPABASE_SERVICE_ROLE_KEY` lookup is permitted anywhere in P11 runtime code.

The repository default therefore remains legacy even after P11 lands. A later explicit operator/deployment phase may set the activation flag outside the repository.

## Router Contract

Create:

```js
runP11RuntimeQuery({
  records,
  patterns,
  request,
  graphMode = 'legacy',
  fetchCandidatePool,
  recordUsageFn,
  recordUsageEnabled = true,
}) -> Promise<{ result, routing }>
```

`result` preserves the existing public `query.mjs` fields exactly:

- `profile`
- `requested`
- `countsByStratum`
- `coverage`
- `coverageGaps`
- `requiresTargetedResearch`
- `usageWarning`
- `records`
- `patterns`

`routing` is internal evidence and is never printed by production `query.mjs`. It contains only non-secret state such as requested mode, attempted flag, authoritative source, parity booleans, and a bounded failure reason.

The legacy selection is always computed first. For an eligible graph attempt:

1. Fetch P10 candidates.
2. Rank with `selectP7ParityLexicalResults`.
3. Hydrate graph legacy IDs through `hydrateP8LegacyIds`.
4. Select graph patterns with the existing `selectPatterns`.
5. Compare ordered legacy vs graph record IDs and ordered pattern IDs.
6. Graph becomes authoritative only when both comparisons are exact.
7. Otherwise return legacy.

No remote error text is exposed in the public result or durable routing evidence.

## Usage Semantics

Usage is recorded once, after authority is decided, against the records actually returned.

Because graph authority requires exact ordered parity with legacy, this should normally be the same IDs; nevertheless, the router must not write once for legacy and again for graph. A usage-write failure remains non-fatal and preserves the existing warning semantics.

## CLI Integration

`query.mjs` keeps argument validation and the public output schema. It changes from direct selection to one top-level `await runP11RuntimeQuery(...)` call.

For a quick graph attempt, the CLI builds `fetchCandidatePool` using `fetchP10QuickCandidatePool` with:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- current UTC date as `expectedDate`
- a bounded timeout pinned by P11.

The CLI does not print routing metadata, credentials, transport errors, or candidate-pool internals.

Exit status remains based only on the returned authoritative result's coverage gaps: `2` when gaps exist, otherwise `0`.

## Failure and Rollback Matrix

| Condition | Network | Authority | Public behavior |
|---|---:|---|---|
| flag missing / not `graph` | 0 | legacy | identical legacy result |
| standard/deep | 0 | legacy | identical legacy result |
| quick graph + missing URL/key | 0 | legacy | identical legacy result |
| network/timeout/non-2xx | attempted | legacy | identical legacy result |
| stale/empty/malformed/duplicate projection | attempted | legacy | identical legacy result |
| unknown local hydration ID | attempted | legacy | identical legacy result |
| record mismatch | attempted | legacy | identical legacy result |
| pattern mismatch | attempted | legacy | identical legacy result |
| exact record + pattern parity | attempted | graph | same public records/patterns as legacy |

Rollback is operationally trivial: remove or change `REFERENCE_GRAPH_QUICK_RUNTIME`; no DDL, catalog mutation, or repository revert is required.

## Security and Secret Boundary

- Runtime graph reads use only a publishable key.
- Service-role environment names are forbidden in P11 runtime/router/CLI source.
- The P10 projection remains the only public data surface.
- Router/evidence must reject credential-shaped fields.
- Existing P10 Security Advisor zero-WARN/ERROR state is immutable evidence and remains a P11 prerequisite.

## Verification Strategy

P11 must prove five independent properties:

1. **Default safety:** no flag means byte-/structure-equivalent legacy output and zero network.
2. **Profile isolation:** standard/deep never network even when graph activation is requested.
3. **Parity-gated authority:** quick graph can be authoritative only with exact ordered records and patterns.
4. **Fail-closed behavior:** every transport/payload/hydration/parity failure returns the same legacy output and writes usage once.
5. **Live controlled activation:** a publishable-key run with the activation flag enabled produces 24/24 exact quick results while a paired default-off run stays legacy; production default remains off.

Permanent governance must also pin P10 evidence, prevent benchmark leakage, prevent service-role runtime references, and verify the production query's public JSON keys/exit semantics.

## P11 Stop Boundary

P11 stops when the production entrypoint contains a tested, reversible, opt-in quick graph authority path and controlled live activation evidence is green.

P11 does **not** set `REFERENCE_GRAPH_QUICK_RUNTIME=graph` globally, does not change standard/deep, and does not merge or mark the stacked PR ready. A separate deployment/operations decision is required to turn the flag on for normal users.