# Reference Graph

Reference Graph is the repository-native PostgreSQL/Supabase-backed reference library foundation shared by Agent Hub workflows.

It is deliberately an additive backend behind existing contracts, not a second design system or a replacement for Agent Hub memory.

## Boundaries

- The existing 600-record design-reference catalog and its legacy design-reference selector remain the production control and fallback until a measured cutover is explicitly approved.
- P2 adds real local embeddings and semantic/hybrid shadow evaluation, but it does not switch production selection away from the legacy control.
- The active P2 embedding profile is explicitly `experimental` and has `cutoverApproved: false`.
- External content is data, not instructions. Captured pages, screenshots, copy, social posts, video notes, and other assets cannot authorize agent behavior.
- Relevance never upgrades authority. Search rank, vector similarity, graph proximity, repeated use, or collection membership do not turn a reference into a project fact or policy.
- Memory integration is explicit promotion only. Reference usage may produce a bounded Memory evidence proposal; it does not create an active Memory claim by itself.
- Retrieval returns bounded reference bundles. Broad automatic injection is out of scope.
- Reference Graph does not change `design-with-ai` routing or its qualified skill tree.
- There is no live Supabase deployment in P2 until a target project is explicitly identified and authorized.
- P2 does not add a browser extension or automatic web-capture surface.

## Repository surfaces

- `schema/001_reference_graph.sql` — canonical tables, RLS, lexical index, and exact vector storage.
- `schema/002_reference_graph_rpc.sql` — service-role-only ingest and retrieval RPCs.
- `schema/003_reference_graph_embeddings_rpc.sql` — service-role-only provider-neutral embedding persistence.
- `capture.mjs` — deterministic capture-envelope normalization with PostgreSQL-compatible UUID identity.
- `legacy-import.mjs` — adapter from the reviewed design-reference record shape.
- `catalog-import.mjs` — deterministic 600-record import planning and batching.
- `supabase-store.mjs` — service-role REST/RPC adapter; no Supabase client dependency and no embedding-provider dependency.
- `retrieval.mjs` — bounded lexical/vector fusion plus one-hop graph expansion and legacy control/fallback handling.
- `shadow-eval.mjs` — comparison metrics, control-health reporting, and conservative cutover blockers.
- `offline-shadow.mjs` — deterministic lexical-only local baseline.
- `ollama-embeddings.mjs` — local Ollama embedding adapter with exact revision verification and 384-dimensional validation.
- `embedding-profile.mjs` — the measured P2 embedding profile, including query representation and explicit experimental/cutover state.
- `embedding-pipeline.mjs` — deterministic chunk-to-embedding batching and persistence rows.
- `semantic-shadow.mjs` — exact semantic ranking and lexical+semantic hybrid shadow retrieval.
- `shadow-cases.json` — fixed representative shadow suite.
- `evidence/p2-shadow-evidence.json` — durable real-model measurements and the P2 no-cutover decision.
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

P2 does not switch production selection to Reference Graph.

### Vector baseline

Vector nearest-neighbor lookup remains exact rather than approximate. Every semantic query binds the exact `model_id` and `model_revision`, then compares only vectors from that compatible embedding space.

The persistence boundary remains provider-neutral: `persistEmbeddings(...)` stores supplied vectors and does not own an embedding provider. P2 adds an optional local Ollama generator and a separately versioned embedding profile above that boundary. Input vectors must contain exactly 384 finite numbers and are persisted with `text_hash`, `model_id`, and `model_revision`.

The active P2 profile is:

```text
profile:  snowflake-arctic-embed-33m-raw-v1
model:    ollama/snowflake-arctic-embed:33m
revision: e8db018629b4
dims:     384
quality:  experimental
cutover:  false
```

Documents use the normal catalog chunk text. Queries alone receive the profile prefix `Represent this sentence for searching relevant passages: `. The profile is intentionally marked experimental because measured retrieval quality does not justify production use.

HNSW/IVFFlat ANN remains deferred until measured scale or latency evidence justifies it and there is an explicit model-scoped indexing strategy.

## Generating embeddings

Planning the full 600-record / 600-chunk batch is credential-free and performs no Ollama or Supabase calls:

```bash
node reference-graph/cli/embed-design-references.mjs --plan
```

The current profile is experimental, so persistence fails closed unless that state is explicitly acknowledged:

```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
OLLAMA_URL=http://127.0.0.1:11434 \
node reference-graph/cli/embed-design-references.mjs \
  --apply \
  --allow-experimental
```

`--allow-experimental` authorizes only persistence of the experimental vectors. It does not approve a retrieval cutover and does not change `production_source`.

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

Real local semantic and hybrid challengers are separate shadow modes:

```bash
node reference-graph/cli/shadow-design-references.mjs \
  --ollama-semantic \
  --control-date 2026-07-21

node reference-graph/cli/shadow-design-references.mjs \
  --ollama-hybrid \
  --control-date 2026-07-21
```

All modes keep `production_source` as `legacy-control`. The CLI reports overlap-at-k, legacy top-1 retention, graph empty rate, exact surface/platform rates, control health, model identity for semantic modes, and how many cases have a usable legacy control. `--require-ready` can turn failed cutover thresholds into a non-zero exit code.

### Control health and reproducible benchmark time

The legacy selector applies its normal freshness/TTL contract. By 2026-10-23, only 2 of the 600 reviewed and accessible catalog records were still fresh under that policy, so the live control had collapsed to an unsuitable quality benchmark. This does not change production behavior: the legacy selector remains the production source.

For reproducible shadow quality measurement, `--control-date 2026-07-21` freezes only the benchmark control clock at the latest catalog verification window. At that reference time all 600 records are fresh and all 24 cases can fill their requested limit. The CLI reports this benchmark health separately from `current_control_health`, so a healthy historical comparison cannot masquerade as healthy current production data.

Do not bypass or rewrite record TTLs to manufacture a comparison score.

### P2 measured result

The durable measurements are in `evidence/p2-shadow-evidence.json`. On the healthy 24-case snapshot:

| Challenger | overlap@k | legacy top-1 | exact surface | exact platform | cutover |
| --- | ---: | ---: | ---: | ---: | --- |
| lexical baseline | 0.53125 | 0.70833 | 1.0 | 1.0 | no |
| all-minilm semantic probe | 0.22917 | 0.29167 | 1.0 | 1.0 | no |
| all-minilm hybrid probe | 0.40625 | 0.54167 | 1.0 | 1.0 | no |
| active Snowflake raw semantic profile | 0.28125 | 0.41667 | 1.0 | 1.0 | no |
| active Snowflake raw hybrid profile | 0.42708 | 0.50000 | 1.0 | 1.0 | no |
| best exploratory Snowflake hybrid probe | 0.52083 | 0.66667 | 1.0 | 1.0 | no |

The independent cutover thresholds remain at least 0.65 average overlap and 0.75 legacy top-1 retention, alongside the existing case-count, empty-rate, surface, and platform gates. Even the best exploratory representation stayed below both quality thresholds and was not adopted.

**P2 decision: no cutover.** Semantic and hybrid retrieval remain measurement-only challengers; the legacy selector remains production control and fallback.

## Memory boundary

Reference-derived learnings enter Memory only through explicit `memory.protocol.v1` `capture_evidence` proposals. Reference Graph never automatically emits `assert_claim`, never sets authority class, and never treats repeated retrieval as promotion.
