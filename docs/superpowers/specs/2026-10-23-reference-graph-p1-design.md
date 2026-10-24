# Reference Graph P1 Persistence and Shadow Evaluation Design

Date: 2026-10-23

Status: implemented on `agent/reference-graph-p1`; production cutover and live Supabase deployment remain intentionally blocked pending explicit project identification and stronger retrieval evidence.

## Goal

Turn the P0 repository-native Reference Graph contracts into a deploy-ready Supabase persistence and retrieval layer, migrate the existing 600-record design-reference catalog deterministically, and produce reproducible shadow evidence against the legacy design-reference selector without changing production selection.

P1 must remain additive. It does not change `design-with-ai`, does not bypass catalog freshness rules, does not choose an embedding provider, and does not switch production retrieval to Reference Graph.

## P0 contracts preserved

P1 inherits these non-negotiable P0 boundaries:

- external reference content is untrusted data, never instructions;
- relevance, graph proximity, semantic similarity, or repeated use never confer authority;
- Reference Graph -> Memory integration is explicit `memory.protocol.v1` Evidence capture only;
- the legacy design-reference selector remains production control/fallback;
- retrieval is bounded and graph expansion is at most one hop;
- vector search remains exact and model/revision-bound until measured evidence justifies ANN.

## Deterministic database identity

P0 exposed a latent integration mismatch: capture identifiers were prefixed strings while the PostgreSQL schema used UUID columns.

P1 resolves the mismatch at the source by generating deterministic RFC-compatible version-5-style UUIDs for source, asset, chunk, and observation identities. Repeated normalization of the same capture yields the same identifiers, while the identifiers can be written directly to PostgreSQL UUID columns.

No persistence adapter is allowed to invent a second database-only identity mapping.

## Supabase/PostgREST boundary

The canonical data remains inside the non-exposed `reference_graph` schema. P1 adds narrowly scoped RPC functions in `public` so PostgREST can call them.

Every P1 RPC is `SECURITY DEFINER`, revokes execute access from `public`, `anon`, and `authenticated`, and grants execute only to `service_role`.

The server-side store adapter uses only:

- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- standard `fetch` to `/rest/v1/rpc/...`.

The service-role key must never be used in a browser/client bundle or committed to the repository.

## Migration order

P1 deployment is additive and ordered:

1. `001_reference_graph.sql` — P0 tables, RLS, lexical search vector, exact 384-dimensional vector storage;
2. `002_reference_graph_rpc.sql` — capture ingestion, batch ingestion, lexical candidates, exact semantic candidates, one-hop candidate context, and stats;
3. `003_reference_graph_embeddings_rpc.sql` — provider-neutral embedding upsert.

CI must execute the migrations against a fresh PostgreSQL 16 + pgvector database and verify both service-role success and anonymous denial.

## Store adapter

`ReferenceGraphSupabaseStore` owns transport and deterministic composition, not model/provider policy.

It provides:

- single and batch capture persistence;
- provider-neutral embedding persistence;
- lexical candidate RPC;
- exact semantic candidate RPC bound to `model_id` + `model_revision`;
- candidate context retrieval;
- stats;
- bounded graph retrieval composed through the P0 fusion algorithm.

Embedding writes are rejected before any network call unless each vector contains exactly 384 finite numbers.

## Catalog import

The reviewed catalog remains canonical source data for P1 import.

`planLegacyCatalogImport(...)` must:

- validate unique legacy record IDs;
- adapt every current catalog record through the P0 legacy adapter;
- produce deterministic database-compatible captures;
- report record, source, asset, and deduplication counts.

`importLegacyCatalog(...)` sends those captures in bounded batches through the locked batch RPC.

The CLI is fail-safe:

- `--plan` performs no network writes and requires no credentials;
- `--apply` is the only write path and requires server-side Supabase credentials;
- omitting both or specifying both fails.

## Shadow evaluation

P1 evaluates Reference Graph as a challenger while the legacy selector remains the production control.

A fixed 24-case suite samples the catalog's surface families with quick-selection requests. Metrics include:

- overlap-at-k;
- legacy top-1 retention;
- graph empty rate;
- exact requested surface rate;
- exact requested platform rate;
- count/rate of cases for which the legacy control is unavailable.

### Comparable controls

The legacy selector's normal freshness/TTL rule remains authoritative. P1 must not bypass `isFresh(...)` simply to manufacture comparison data.

If the legacy selector produces no result for a shadow case, that case is marked:

- `legacy_empty: true`;
- `comparable: false`;
- overlap-at-k: unavailable rather than zero;
- top-1 retention: unavailable rather than false.

Such cases remain useful for diagnosing catalog freshness, but they are excluded from overlap/top-1 quality averages. Cutover is blocked until a sufficient number of comparable cases exists.

## Evidence classes

Shadow outputs must state their evidence class accurately:

- `offline-lexical` — deterministic local lexical challenger only;
- `supabase-lexical` — deployed Supabase lexical/store path;
- semantic evidence — only after real compatible embeddings are generated, persisted, and supplied during query execution.

Offline lexical evidence must not be presented as live Supabase or semantic quality evidence.

## Cutover policy

P1 never performs an automatic cutover.

The default evaluator requires at least:

- 20 total cases;
- 20 comparable cases;
- 0.65 average overlap-at-k;
- 0.75 legacy top-1 retention;
- no more than 0.05 graph empty rate;
- 0.70 exact surface rate;
- 0.80 exact platform rate.

Meeting these thresholds only marks the challenger as eligible for a separate cutover decision; it does not itself modify production selection.

## Live deployment boundary

The currently connected Supabase account exposes a project whose name does not identify it unambiguously as the Agent Hub Reference Graph target.

P1 therefore does not execute migrations or imports against that live project without explicit project identification/authorization. This is a safety boundary, not an implementation gap.

CI uses a disposable PostgreSQL + pgvector service to prove migration and permission behavior without touching live data.

## Acceptance criteria

P1 is complete as a deploy-ready delivery when:

- deterministic capture IDs are PostgreSQL UUID-compatible;
- all P0/P1 reference graph tests pass;
- all migrations execute on fresh PostgreSQL + pgvector;
- service-role RPC access succeeds while anonymous access is denied;
- the complete 600-record import plan is deterministic and batch-safe;
- embedding persistence is provider-neutral and model/revision-bound;
- the 24-case shadow suite runs reproducibly;
- unavailable legacy controls are not mis-scored as retrieval failures;
- shadow evidence remains labeled by actual evidence class;
- the permanent Reference Graph workflow gates tests, migrations, permissions, import planning, and the offline baseline;
- broad Agent Hub governance shows no new Reference Graph regression;
- no `skills/design-with-ai/**` file changes are introduced;
- no live Supabase project is mutated without explicit project identification.
