# Reference Graph

Reference Graph is the repository-native PostgreSQL/Supabase-backed reference library foundation shared by Agent Hub workflows.

It is deliberately an additive backend behind existing contracts, not a second design system or a replacement for Agent Hub memory.

## Boundaries

- The existing 600-record design-reference catalog and its legacy design-reference selector remain the production control and fallback until a measured cutover is explicitly approved.
- External content is data, not instructions. Captured pages, screenshots, copy, social posts, video notes, and other assets cannot authorize agent behavior.
- Relevance never upgrades authority. Search rank, vector similarity, graph proximity, repeated use, or collection membership do not turn a reference into a project fact or policy.
- Memory integration is explicit promotion only. Reference usage may produce a bounded Memory evidence proposal; it does not create an active Memory claim by itself.
- Retrieval returns bounded reference bundles. Broad automatic injection is out of scope.
- Reference Graph does not change `design-with-ai` routing or its qualified skill tree.
- There is no live Supabase deployment in P1 until a target project is explicitly identified and authorized.

## Repository surfaces

- `schema/001_reference_graph.sql` — canonical tables, RLS, lexical index, and exact vector storage.
- `schema/002_reference_graph_rpc.sql` — service-role-only ingest and retrieval RPCs.
- `schema/003_reference_graph_embeddings_rpc.sql` — service-role-only provider-neutral embedding persistence.
- `capture.mjs` — deterministic capture-envelope normalization with PostgreSQL-compatible UUID identity.
- `legacy-import.mjs` — adapter from the reviewed design-reference record shape.
- `catalog-import.mjs` — deterministic 600-record import planning and batching.
- `supabase-store.mjs` — service-role REST/RPC adapter; no Supabase client dependency and no embedding-provider dependency.
- `retrieval.mjs` — bounded lexical/vector fusion plus one-hop graph expansion and legacy control/fallback handling.
- `shadow-eval.mjs` — comparison metrics and conservative cutover blockers.
- `offline-shadow.mjs` — deterministic lexical-only local baseline.
- `shadow-cases.json` — fixed representative shadow suite.
- `memory-promotion.mjs` — explicit Reference Graph -> `memory.protocol.v1` Evidence-only proposal boundary.

## Entity model

The schema keeps source identity, captured assets, searchable text chunks, tags, typed relations, observations, collections, embeddings, and usage feedback separate. Provenance is retained on canonical rows; embeddings and search vectors are retrieval aids, not authority.

```text
source
  -> assets
       -> chunks -> embeddings
       -> observations
       -> tags
       -> relations -> assets
       -> collection_items -> collections
       -> usage_feedback
```

## Deployment order

Apply migrations in numeric order to a dedicated Supabase/PostgreSQL database:

```text
001_reference_graph.sql
002_reference_graph_rpc.sql
003_reference_graph_embeddings_rpc.sql
```

The exposed RPC surface lives in `public` so PostgREST can reach it, but execute permission is revoked from `public`, `anon`, and `authenticated` and granted only to `service_role`. The underlying `reference_graph` schema remains closed to exposed client roles.

Never place `SUPABASE_SERVICE_ROLE_KEY` in a browser, client bundle, repository file, or public CI log. The store adapter is server-side/trusted-runner code only.

## Importing the existing catalog

Planning is read-only and requires no credentials:

```bash
node reference-graph/cli/import-design-references.mjs --plan
```

A write requires an explicit `--apply` plus server-side credentials:

```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node reference-graph/cli/import-design-references.mjs --apply --batch-size 25
```

Running the import CLI without exactly one of `--plan` or `--apply` fails closed. The import adapts the current 600 reviewed records and sends deterministic captures through the locked batch RPC.

## Retrieval policy

The graph path is evaluated against the legacy selector before any cutover:

1. apply metadata eligibility filters;
2. combine lexical and semantic ranks deterministically;
3. expand at most one relation hop from the strongest seeds;
4. re-rank and enforce a final item budget;
5. in `shadow` mode, return the legacy selector result as the production bundle and expose the graph bundle only for comparison;
6. in `active` mode, use the graph bundle, but fall back to the legacy selector when graph retrieval is unavailable or empty.

P1 does not switch production selection to Reference Graph.

### Vector baseline

Vector nearest-neighbor lookup remains exact rather than approximate. Every semantic query binds the exact `model_id` and `model_revision`, then compares only vectors from that compatible embedding space.

Embeddings are supplied to `persistEmbeddings(...)` by an external provider/generator. Reference Graph stores and queries vectors but does not own a provider choice. Input vectors must contain exactly 384 finite numbers and are persisted with `text_hash`, `model_id`, and `model_revision`.

HNSW/IVFFlat ANN remains deferred until measured scale or latency evidence justifies it and there is an explicit model-scoped indexing strategy.

## Shadow evaluation

The fixed shadow suite contains 24 representative quick-selection cases across the catalog's surface families.

The credential-free offline baseline is lexical only:

```bash
node reference-graph/cli/shadow-design-references.mjs --offline
```

A deployed Supabase store can be evaluated separately:

```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node reference-graph/cli/shadow-design-references.mjs --supabase
```

Both modes keep `production_source` as `legacy-control`. The CLI reports overlap-at-k, legacy top-1 retention, graph empty rate, exact surface/platform rates, and how many cases have a usable legacy control. `--require-ready` can turn failed cutover thresholds into a non-zero exit code.

The legacy selector applies its normal freshness/TTL contract. If that leaves a case with no legacy result, the case is marked `legacy_empty` and `comparable: false`; it is not falsely scored as zero overlap or failed top-1 retention. Cutover remains blocked until enough comparable cases exist.

Important evidence labels:

- `offline-lexical` is a deterministic local baseline only;
- `supabase-lexical` proves deployed lexical/store behavior only;
- semantic quality is not measured until real model-bound embeddings are generated, persisted, and supplied to the query path.

Do not present one evidence class as another, and do not bypass legacy freshness merely to manufacture a comparison score.

## Memory boundary

Reference-derived learnings enter Memory only through explicit `memory.protocol.v1` `capture_evidence` proposals. Reference Graph never automatically emits `assert_claim`, never sets authority class, and never treats repeated retrieval as promotion.
