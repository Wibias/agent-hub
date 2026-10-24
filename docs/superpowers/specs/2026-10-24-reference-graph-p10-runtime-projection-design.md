# Reference Graph P10 — Least-Privilege Runtime Projection Design

## Intent

P9 proved that the certified quick graph handoff can be exercised over a Supabase publishable key without using the broad `service_role` in the client process. Its 24-case shadow canary was exact for both ordered records and patterns and always kept legacy authoritative.

P9 also found a real security blocker: the publishable-key transport is a public `SECURITY DEFINER` RPC. Supabase Security Advisor correctly reports one WARN for anonymous execution and one WARN for authenticated execution.

P10 removes that blocker without weakening the advisor gate, without broadening access to the Reference Graph, and without activating graph routing.

## Starting point

Final P9 clean head:

`535a0f9e5354ba53493fc581d0eb5a60fca04e05`

P9 established:

- publishable-key HTTP transport works;
- current quick candidate pool is 275/275 complete and equivalent to the certified P7 pool;
- 24/24 quick canary cases have exact ordered record handoff;
- 24/24 quick canary cases have exact pattern handoff;
- transport/malformed-payload failures fall back to legacy;
- standard/deep perform no graph network call;
- no service-role credential is used by the canary;
- production remains `legacy-control`;
- activation is blocked by exactly two P9-attributable Security Advisor WARN findings on the public `SECURITY DEFINER` wrapper.

## Goals

1. Remove public execution of the P9 `SECURITY DEFINER` runtime wrapper.
2. Expose only the already-certified quick candidate fields through a read-only projection with Row Level Security.
3. Keep all underlying Reference Graph tables, P6/P7/operator RPCs, write surfaces, embeddings, and historical filters inaccessible to publishable-key callers.
4. Populate the projection only through an operator/service-role refresh path.
5. Make runtime freshness fail closed: callers may read only a snapshot whose `snapshot_date = current_date`.
6. Re-run the exact P9 publishable-key shadow canary against the projection and require 24/24 ordered record and pattern parity.
7. Require zero P10/P9-attributable Security Advisor WARN/ERROR findings before marking least-privilege transport ready.
8. Keep production routing unchanged and require a later explicit activation phase.

## Non-goals

- Do not modify `knowledge/design-references/scripts/query.mjs`.
- Do not activate graph-selected results in production.
- Do not serve standard/deep from the graph.
- Do not change P7 ranking/scoring/coverage semantics.
- Do not mutate catalog freshness, TTL, review status, access status, IDs, chunks, embeddings, or relations.
- Do not grant publishable-key callers direct access to `reference_graph.*` tables.
- Do not suppress, whitelist, or reinterpret Supabase Security Advisor findings.
- Do not add a server-side service-role proxy or Edge Function.
- Do not add automated scheduling in P10; a missing daily refresh must fail closed to legacy.

## Approaches considered

### A. Public RLS-backed projection table + service-role-only refresh — selected

Create one dedicated table in the exposed `public` schema containing only the 15 fields required by the frozen P7 parity selector plus snapshot metadata. Enable RLS and grant `SELECT` only to `anon` and `authenticated`, with a policy requiring `snapshot_date = current_date`.

A separate no-argument refresh RPC rebuilds the projection from the service-role-only P7 pool. That refresh RPC remains `SECURITY DEFINER`, but only `service_role` may execute it.

Why selected:

- removes public `SECURITY DEFINER` execution entirely;
- gives runtime roles no access to underlying graph tables;
- publishes no more candidate data than P9 already returned;
- makes stale snapshots invisible automatically;
- keeps refresh authority operator-only;
- is reversible by revoking table SELECT and dropping the projection;
- preserves the exact P7 policy and P9 canary semantics.

### B. `SECURITY INVOKER` runtime function over Reference Graph tables — rejected

A true invoker function would require `anon` / `authenticated` to possess the underlying table/view privileges needed by the query. That broadens the trust boundary beyond the single certified candidate projection.

### C. Edge Function holding `service_role` — rejected

This removes the database linter warning but merely relocates the broad privileged credential into another production service. P8 explicitly identified that trust boundary as undesirable.

## Database design

Add migration:

`reference-graph/schema/009_reference_graph_runtime_projection.sql`

### Runtime projection

Create:

`public.reference_graph_quick_runtime_projection_p10`

Columns:

- `asset_id uuid primary key`
- `legacy_id text unique not null`
- `product text`
- `surface_family text`
- `platform text`
- `page_role text`
- `motion text`
- `source_family text`
- `topology text`
- `access_status text`
- `evidence_class text`
- `ordinary_or_failure_prone boolean not null`
- `multi_state_flow boolean not null`
- `tags jsonb not null`
- `search_text text not null`
- `snapshot_date date not null`
- `refreshed_at timestamptz not null`

The first 15 columns are exactly the fields consumed by `selectP7ParityLexicalResults()`. P10 does not expose source URLs, provenance, observations beyond topology, embeddings, relations, verification history, or write metadata.

### Runtime privileges

- enable RLS on the projection;
- revoke all table privileges from `public`, `anon`, and `authenticated`;
- grant only `SELECT` to `anon` and `authenticated`;
- add one SELECT policy for `anon, authenticated`:

```sql
using (snapshot_date = current_date)
```

Runtime roles receive no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, or TRIGGER privilege.

### P9 closure

Migration 009 revokes `anon` and `authenticated` execution on:

`public.reference_graph_quick_candidate_pool_runtime_p9()`

The function may remain for historical/operator inspection, but it is no longer a publishable-key surface. This is required for the two P9 advisor WARN findings to disappear.

### Operator refresh

Create:

`public.reference_graph_refresh_quick_runtime_projection_p10()`

Contract:

- no arguments;
- current-date only;
- `SECURITY DEFINER` with fixed search path and bounded timeout;
- executable by `service_role` only;
- atomically replaces projection rows with the output of `reference_graph_quick_candidate_pool_p7({ reference_date: current_date })`;
- stamps every row with the same `snapshot_date = current_date` and `refreshed_at` timestamp;
- returns a small summary containing snapshot date and candidate count;
- never accepts arbitrary filters or historical dates.

Because public roles cannot execute the refresh function, its `SECURITY DEFINER` status is not a public privilege escalation surface.

## Freshness and fail-closed behavior

The projection is a snapshot, not catalog authority.

Runtime callers query only rows where `snapshot_date = current UTC/database date`. RLS independently enforces the same condition.

If refresh has not run for the current date:

- publishable-key runtime receives an empty candidate pool;
- the P10 client treats the empty/stale snapshot as unavailable;
- the shadow/production adapter falls back to legacy;
- no stale graph result becomes authoritative.

P10 deliberately does not add a scheduler. A later activation phase may decide how refresh is scheduled or coupled to catalog/revalidation operations.

## Runtime client

Create:

`reference-graph/p10-runtime-client.mjs`

Primary interface:

```js
fetchP10QuickCandidatePool({
  supabaseUrl,
  publishableKey,
  fetchImpl = fetch,
  timeoutMs = 1500,
  expectedDate = new Date().toISOString().slice(0, 10),
})
```

The client:

- uses HTTP `GET` against `/rest/v1/reference_graph_quick_runtime_projection_p10`;
- sends only the publishable key in `apikey`;
- selects only the candidate fields plus `snapshot_date` / `refreshed_at`;
- filters `snapshot_date=eq.<expectedDate>` and orders by `asset_id` for deterministic transport;
- validates response JSON, unique asset IDs and legacy IDs;
- validates every row belongs to the expected snapshot date;
- requires a non-empty pool;
- never accepts or references a service-role key;
- never writes to Supabase;
- never logs or persists the publishable key.

## Shadow canary reuse

P10 does not invent a new ranking/canary algorithm.

The existing transport-agnostic `runP9ShadowCanary()` remains the behavior oracle:

1. legacy selection remains authoritative;
2. P10 fetches the current projection;
3. frozen `selectP7ParityLexicalResults()` ranks the projection locally;
4. canonical records are hydrated locally;
5. canonical pattern selection runs locally;
6. ordered records and patterns are compared to legacy;
7. any transport, validation, empty snapshot, or mismatch failure falls back to legacy.

Create a thin P10 CLI/operator only to bind the new transport and produce P10 evidence.

## Security gate

P10 live verification must prove all of the following simultaneously:

- P9 runtime wrapper: `anon_execute = false`, `authenticated_execute = false`;
- P10 refresh RPC: `anon_execute = false`, `authenticated_execute = false`, `service_role_execute = true`;
- P10 projection: anon/auth SELECT current snapshot succeeds;
- P10 projection: anon/auth INSERT/UPDATE/DELETE fail;
- underlying `reference_graph.*` tables remain inaccessible;
- P6/P7/operator/write RPC grants remain unchanged/closed;
- no service-role credential path exists in the P10 runtime client/CLI;
- Supabase Security Advisor has **zero WARN/ERROR findings attributable to P9/P10 runtime surfaces**.

The existing INFO-only closed-by-default RLS notices are not P10 blockers.

## Canary gate

After operator refresh, the live projection must prove:

- candidate pool non-empty;
- metadata complete for every candidate;
- unique `legacy_id` values;
- canonical live projection hash equals the committed/offline P7 candidate-pool hash for the same current snapshot;
- 24/24 quick canary cases exact on ordered records;
- 24/24 quick canary cases exact on ordered patterns;
- 0 mismatches;
- 24/24 cases remain legacy authoritative;
- standard/deep perform no graph network request;
- transport/malformed/stale/empty-snapshot paths fall back to legacy.

## Receipt / decision contract

Durable evidence:

`reference-graph/evidence/p10-runtime-projection-evidence.json`

Schema:

`reference-graph.p10-runtime-projection.v1`

The receipt distinguishes security/canary readiness from activation:

```text
least_privilege_transport_ready = true only when advisor + grants are clean
quick_shadow_canary_ready = true only when exact canary is green
production_activation_ready = false in P10
production_source = legacy-control
activation_performed = false
```

P10 may become **activation-review eligible**, but it never changes `query.mjs` or production routing.

## Permanent governance

Extend Reference Graph governance to enforce:

- migration stack `001→009`;
- P9 wrapper closed to anon/auth after migration 009;
- P10 projection RLS + SELECT-only runtime grants;
- P10 refresh RPC service-role-only;
- current-snapshot RLS behavior;
- stale-snapshot invisibility;
- runtime write denials;
- P7 candidate parity after refresh;
- P10 runtime/client secret scan and explicit absence of service-role references;
- immutable P9 evidence and inherited P3–P8 evidence;
- no production `query.mjs` modification.

## Stop boundary

P10 is complete when:

- projection transport is live on the dedicated target;
- the two P9 advisor WARN findings are gone;
- no new P10 WARN/ERROR security findings exist;
- publishable-key projection transport is verified;
- 24/24 record and pattern canary parity is exact;
- permanent governance is green;
- durable secret-free evidence is committed;
- production remains `legacy-control`;
- no activation and no merge occur.

A later phase must make the explicit production activation decision and define refresh operations before graph-selected quick results may become authoritative.