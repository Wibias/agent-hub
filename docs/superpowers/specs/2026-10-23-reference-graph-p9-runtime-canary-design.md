# Reference Graph P9 — Least-Privilege Runtime Canary Design

## Intent

P8 proved that the graph-native **quick** handoff is exact, but correctly blocked production activation because the live graph transport still depends on the broad Supabase `service_role`. P9 removes that credential blocker without changing the normal production query path.

P9 is a transport-and-canary phase, not an activation phase.

## Starting point

Final P8 evidence head: `619e0b490420f5292dd4bf16ae36cded4013f7d5`.

P8 established:

- quick graph handoff is exact for records and patterns;
- current live/offline candidate pools are equivalent;
- standard and deep remain legacy-only;
- `knowledge/design-references/scripts/query.mjs` remains the production runtime and is local/offline;
- production source is `legacy-control`;
- the sole activation blocker is use of the broad Supabase `service_role` in a production runtime.

## Goals

1. Expose the already-certified P7 quick candidate pool through a least-privilege runtime surface that does not require `service_role` in the client process.
2. Make the runtime surface narrower than the operator surface: no arbitrary SQL, no historical-date parameter, no write capability, no semantic/embedding RPC access.
3. Add a read-only **shadow canary CLI** that exercises the real remote transport, runs the frozen P7 policy locally, hydrates canonical local records, compares record and pattern handoff, and still returns/records the legacy result.
4. Fail closed to legacy on timeout, transport error, malformed/duplicate candidates, unknown legacy IDs, or handoff mismatch.
5. Produce durable P9 evidence proving least privilege and exact shadow handoff on the dedicated target.
6. Keep activation as a separate later decision.

## Non-goals

- Do not modify production routing.
- Do not modify `knowledge/design-references/scripts/query.mjs`.
- Do not enable graph serving for standard/deep.
- Do not grant `anon` or `authenticated` access to historical P7/P6/operator RPCs.
- Do not expose embeddings, relations, arbitrary filters, historical reference dates, or write operations.
- Do not change catalog data, freshness, TTL, review/access status, P7 ranking, or quality gates.
- Do not merge P7/P8/P9 or perform a production cutover.

## Approaches considered

### A. Narrow PostgREST RPC + separate shadow-canary CLI — selected

Create one additive runtime RPC with no parameters. It delegates to the already-certified P7 candidate-pool function using `current_date`, returns only the P7 candidate fields, and is executable by Supabase `anon` / `authenticated` roles. The client uses only a publishable/anon API key, which is intentionally non-privileged. A separate P9 shadow CLI consumes this surface and never changes the production result.

Why selected:

- removes `service_role` from the client runtime;
- reuses certified P7 candidate semantics instead of duplicating them;
- exposes one read-only capability and nothing else;
- is easy to revoke by migration/GRANT change;
- makes rollback operationally trivial because production still uses legacy.

### B. Supabase Edge Function holding `service_role` — rejected

This hides the credential from the local process but still makes the broad service role part of the production request path. It does not actually eliminate the P8 trust-boundary concern.

### C. Modify `query.mjs` to serve graph results directly — rejected for P9

That would combine least-privilege transport work with production activation. P8 explicitly requires a separate activation decision. P9 therefore proves the transport in shadow mode while keeping `query.mjs` byte-identical.

## Runtime database surface

Add migration:

`reference-graph/schema/008_reference_graph_runtime_canary.sql`

Add exactly one public runtime function:

```sql
public.reference_graph_quick_candidate_pool_runtime_p9()
```

Contract:

- no arguments;
- `STABLE`;
- `SECURITY DEFINER`;
- fixed `search_path`;
- bounded statement timeout;
- calls `reference_graph_quick_candidate_pool_p7` with `reference_date = current_date`;
- returns the same 15 P7 candidate fields in the same order/semantics;
- executable by `anon`, `authenticated`, and `service_role` only;
- historical P7/P6 RPC grants remain unchanged;
- no table privileges are granted to `anon` or `authenticated`.

The absence of a date/filter parameter is deliberate. Runtime callers may read only the current eligible quick pool, not use this wrapper as a general historical graph API.

## Runtime client

Create `reference-graph/p9-runtime-client.mjs`.

Primary interface:

```js
fetchP9QuickCandidatePool({
  supabaseUrl,
  publishableKey,
  fetchImpl = fetch,
  timeoutMs = 1500,
}) -> Promise<{ candidates, transport }>
```

Requirements:

- accepts `SUPABASE_PUBLISHABLE_KEY`; `SUPABASE_ANON_KEY` may be accepted as compatibility input by the CLI;
- calls only `/rest/v1/rpc/reference_graph_quick_candidate_pool_runtime_p9`;
- no service-role key parameter exists;
- sends no request body beyond `{}`;
- validates HTTP status and JSON shape;
- validates all candidate IDs/legacy IDs are non-empty and unique;
- aborts on timeout;
- never logs or persists API keys;
- returns transport timing/status metadata without credentials.

## Shadow canary

Create:

`reference-graph/cli/p9-runtime-canary.mjs`

The canary accepts the same request fields as the design-reference query surface plus target/key configuration. It is explicitly shadow-only.

For a `quick` request it:

1. loads canonical local records/patterns;
2. computes the normal legacy selection first;
3. fetches the current remote P9 candidate pool with the publishable key;
4. runs `selectP7ParityLexicalResults()` unchanged;
5. hydrates the returned legacy IDs through `hydrateP8LegacyIds()`;
6. runs canonical `selectPatterns()` on the graph-selected records;
7. compares ordered records and patterns to legacy;
8. optionally records **legacy** usage once, never graph usage;
9. emits the legacy records/patterns as the authoritative result plus a `graph_canary` diagnostic block.

For `standard` or `deep`, it performs no network request and emits legacy with `graph_canary.status = "legacy-only"`.

Any remote error or mismatch produces `graph_canary.status = "fallback"` while preserving a valid legacy result. A `--strict-canary` option may make canary failure non-zero for CI/operator use, but must not alter which records are authoritative.

## Canary decision contract

P9 does not have a graph-serving mode.

Permanent invariants:

```text
production_source = legacy-control
activation_performed = false
query.mjs unchanged
quick shadow canary only
standard/deep legacy-only
```

The canary is reversible by simply not invoking the P9 canary CLI. No production config rollback is required because production routing never changes.

## Security model

P9 must prove:

- `anon` and `authenticated` can execute only the P9 runtime wrapper needed by the canary;
- they still cannot execute P7 candidate RPC, P6 retrieval RPCs, embedding coverage, ingest, verification, or embedding-write RPCs;
- the wrapper has no arguments and exposes no historical date selection;
- no direct schema/table privileges are added;
- no `SUPABASE_SERVICE_ROLE_KEY` reference exists in the runtime client or canary CLI;
- committed artifacts remain secret-free.

A publishable/anon API key is not treated as a privileged credential, but its value must still never be committed into repository evidence.

## Evidence

P9 durable evidence:

`reference-graph/evidence/p9-runtime-canary-evidence.json`

It records:

- final P8 base SHA;
- clean P9 implementation SHA;
- target identity and migration 008 identity;
- RPC grants and negative privilege checks;
- live/offline current candidate-pool canonical hash equality;
- 24/24 quick shadow-canary record parity;
- 24/24 pattern parity;
- fallback-path verification;
- standard/deep no-network verification;
- transport latency summary;
- `service_role_used_by_canary: false`;
- `production_source: legacy-control`;
- `activation_performed: false`.

## Receipt / stop boundary

P9 receipt should distinguish **runtime-canary readiness** from production activation.

P9 may report:

```text
least_privilege_transport_ready: true
quick_shadow_canary_ready: true
production_activation_ready: false
production_source: legacy-control
activation_performed: false
```

P9 is complete when the least-privilege runtime surface and shadow canary are green, permanent governance is green, and durable evidence is committed.

A later phase must make a separate, explicit activation decision before `query.mjs` or production routing can return graph-selected results.
