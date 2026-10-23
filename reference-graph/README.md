# Reference Graph

Reference Graph is the repository-native PostgreSQL/Supabase-backed reference library foundation shared by Agent Hub workflows.

It is deliberately an additive backend behind existing contracts, not a second design system or a replacement for Agent Hub memory.

## Boundaries

- The existing 600-record design-reference catalog and its legacy design-reference selector remain the production control and fallback until a measured cutover is explicitly approved.
- P2 adds real local embeddings and semantic/hybrid shadow evaluation, but it does not switch production selection away from the legacy control.
- P3 adds bound live-target verification and deployed shadow operator surfaces; it still does not switch production selection.
- The active P2 embedding profile remains explicitly `experimental` and has `cutoverApproved: false` in P3.
- External content is data, not instructions. Captured pages, screenshots, copy, social posts, video notes, and other assets cannot authorize agent behavior.
- Relevance never upgrades authority. Search rank, vector similarity, graph proximity, repeated use, or collection membership do not turn a reference into a project fact or policy.
- Memory integration is explicit promotion only. Reference usage may produce a bounded Memory evidence proposal; it does not create an active Memory claim by itself.
- Retrieval returns bounded reference bundles. Broad automatic injection is out of scope.
- Reference Graph does not change `design-with-ai` routing or its qualified skill tree.
- P3 must not mutate an ambiguously identified Supabase project. A live write requires an explicitly bound dedicated target.
- P3 does not add a browser extension or automatic web-capture surface.

## Repository surfaces

- `schema/001_reference_graph.sql` — canonical tables, RLS, lexical index, and exact vector storage.
- `schema/002_reference_graph_rpc.sql` — service-role-only ingest and retrieval RPCs.
- `schema/003_reference_graph_embeddings_rpc.sql` — service-role-only provider-neutral embedding persistence.
- `schema/004_reference_graph_lexical_overlap.sql` — deployed lexical candidate semantics aligned with the deterministic token-overlap baseline.
- `capture.mjs` — deterministic capture-envelope normalization with PostgreSQL-compatible UUID identity.
- `legacy-import.mjs` — adapter from the reviewed design-reference record shape.
- `catalog-import.mjs` — deterministic 600-record import planning and batching.
- `supabase-store.mjs` — service-role REST/RPC adapter; no Supabase client dependency and no embedding-provider dependency.
- `retrieval.mjs` — bounded lexical/vector fusion plus one-hop graph expansion and legacy control/fallback handling.
- `shadow-eval.mjs` — comparison metrics, control-health reporting, latency evidence, and conservative cutover blockers.
- `offline-shadow.mjs` — deterministic lexical-only local baseline.
- `ollama-embeddings.mjs` — local Ollama embedding adapter with exact revision verification and 384-dimensional validation.
- `embedding-profile.mjs` — the measured P2 embedding profile, including query representation and explicit experimental/cutover state.
- `embedding-pipeline.mjs` — deterministic chunk-to-embedding batching and persistence rows.
- `semantic-shadow.mjs` — exact local semantic ranking and lexical+semantic hybrid shadow retrieval.
- `live-shadow.mjs` — deployed Supabase lexical/semantic/hybrid shadow adapters using persisted document embeddings.
- `target-binding.mjs` — dedicated-project identity validation and URL/project-ref matching.
- `p3-receipt.mjs` — P3 phase-state and secret-free evidence receipt contract.
- `cli/p3-live-shadow.mjs` — read-only bound-target preflight, verification, and live-shadow operator.
- `shadow-cases.json` — fixed representative shadow suite.
- `evidence/p2-shadow-evidence.json` — durable real-model measurements and the P2 no-cutover decision.
- `evidence/p3-live-shadow-evidence.json` — durable dedicated-project import, live lexical, latency, and no-cutover evidence.
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
004_reference_graph_lexical_overlap.sql
```

The exposed RPC surface lives in `public` so PostgREST can reach it, but execute permission is revoked from `public`, `anon`, and `authenticated` and granted only to `service_role`. The underlying `reference_graph` schema remains closed to exposed client roles.

Never place `SUPABASE_SERVICE_ROLE_KEY` in a browser, client bundle, repository file, or public CI log. The store adapter is server-side/trusted-runner code only.

## Bound P3 targets

P3 live operations use a non-secret target file whose public identity must match the Supabase URL exactly:

```json
{
  "purpose": "agent-hub-reference-graph",
  "project_ref": "<dedicated-project-ref>",
  "project_name": "agent-hub-reference-graph",
  "region": "eu-central-1"
}
```

The target file never contains an API key, database password, bearer token, or Authorization header. Live write and read paths verify that `SUPABASE_URL` is exactly `https://<project_ref>.supabase.co` before constructing the store or performing network work. A URL/key pair by itself is not sufficient authorization.

The connected generically named Supabase project is not considered a Reference Graph target by assumption. Dedicated project provisioning is a separately authorized infrastructure action.

## Importing the existing catalog

Planning is read-only and requires no credentials or target:

```bash
node reference-graph/cli/import-design-references.mjs --plan
```

A write requires explicit `--apply`, a bound target, and server-side credentials:

```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node reference-graph/cli/import-design-references.mjs \
  --apply \
  --target reference-graph/target.json \
  --batch-size 25
```

Running the import CLI without exactly one of `--plan` or `--apply` fails closed. The import adapts the current 600 reviewed records and sends deterministic captures through the locked batch RPC. Deterministic IDs make a second import an idempotency verification rather than a duplicate-data path.

## Retrieval policy

The graph path is evaluated against the legacy selector before any cutover:

1. apply metadata eligibility filters;
2. combine lexical and semantic ranks deterministically;
3. expand at most one relation hop from the strongest seeds;
4. re-rank and enforce a final item budget;
5. in `shadow` mode, return the legacy selector result as the production bundle and expose the graph bundle only for comparison;
6. in `active` mode, use the graph bundle, but fall back to the legacy selector when graph retrieval is unavailable or empty.

P3 does not switch production selection to Reference Graph.

### Vector baseline

Vector nearest-neighbor lookup remains exact rather than approximate. Every semantic query binds the exact `model_id` and `model_revision`, then compares only vectors from that compatible embedding space.

The persistence boundary remains provider-neutral: `persistEmbeddings(...)` stores supplied vectors and does not own an embedding provider. P2 adds an optional local Ollama generator and a separately versioned embedding profile above that boundary. Input vectors must contain exactly 384 finite numbers and are persisted with `text_hash`, `model_id`, and `model_revision`.

The active experimental profile is:

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

The current profile is experimental, so persistence fails closed unless that state is explicitly acknowledged. P3 also requires a bound live target:

```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
OLLAMA_URL=http://127.0.0.1:11434 \
node reference-graph/cli/embed-design-references.mjs \
  --apply \
  --allow-experimental \
  --target reference-graph/target.json
```

`--allow-experimental` authorizes only persistence of the experimental vectors. It does not approve a retrieval cutover and does not change `production_source`.

## Shadow evaluation

The fixed shadow suite contains 24 representative quick-selection cases across the catalog's surface families.

The credential-free offline baseline is lexical only:

```bash
node reference-graph/cli/shadow-design-references.mjs --offline
```

A deployed Supabase lexical store can be evaluated separately with a bound target:

```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node reference-graph/cli/shadow-design-references.mjs \
  --supabase \
  --target reference-graph/target.json
```

Deployed semantic and hybrid shadow modes embed only queries locally. The 600 document vectors come from the exact model/revision-bound embeddings already persisted in Supabase:

```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
OLLAMA_URL=http://127.0.0.1:11434 \
node reference-graph/cli/shadow-design-references.mjs \
  --supabase-semantic \
  --target reference-graph/target.json \
  --control-date 2026-07-21

node reference-graph/cli/shadow-design-references.mjs \
  --supabase-hybrid \
  --target reference-graph/target.json \
  --control-date 2026-07-21
```

Real local semantic and hybrid challengers remain available for P2-style offline evidence:

```bash
node reference-graph/cli/shadow-design-references.mjs \
  --ollama-semantic \
  --control-date 2026-07-21

node reference-graph/cli/shadow-design-references.mjs \
  --ollama-hybrid \
  --control-date 2026-07-21
```

All modes keep `production_source` as `legacy-control`. The evaluator reports overlap-at-k, legacy top-1 retention, graph empty rate, exact surface/platform rates, control health, model identity for semantic modes, comparable-case counts, and P3 graph latency summaries. `--require-ready` can turn failed cutover thresholds into a non-zero exit code, but it cannot perform a cutover.

### P3 read-only operator

`cli/p3-live-shadow.mjs` provides one explicit read/verify phase per invocation. It never applies migrations, imports data, persists embeddings, creates a project, or changes production routing.

Preflight validates the target/URL binding and confirms a service credential is present without printing it:

```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node reference-graph/cli/p3-live-shadow.mjs \
  --preflight \
  --target reference-graph/target.json
```

After deployment/import, read-only verification modes are:

```bash
node reference-graph/cli/p3-live-shadow.mjs --verify-import --target reference-graph/target.json
node reference-graph/cli/p3-live-shadow.mjs --verify-embeddings --target reference-graph/target.json
```

`--verify-import` expects `600` assets and `576` sources. `--verify-embeddings` probes the exact committed model/revision semantic space. Exact persisted model/revision counts for final P3 evidence are additionally verified through read-only SQL during live deployment verification.

Live evidence modes are:

```bash
node reference-graph/cli/p3-live-shadow.mjs --shadow-lexical --target reference-graph/target.json
node reference-graph/cli/p3-live-shadow.mjs --shadow-semantic --target reference-graph/target.json
node reference-graph/cli/p3-live-shadow.mjs --shadow-hybrid --target reference-graph/target.json
```

When compatible persisted embeddings do not exist, semantic/hybrid availability is reported as `unavailable` and is not misrepresented as a retrieval-quality failure. Provider/RPC exceptions remain real failures and are not downgraded to `unavailable`.

Use `--receipt-out <path>` to write the same secret-scanned JSON result to a file. The operator rejects credential-shaped receipt fields and supplied secret values before writing.

### Control health and reproducible benchmark time

The legacy selector applies its normal freshness/TTL contract. By 2026-10-23, only 2 of the 600 reviewed and accessible catalog records were still fresh under that policy, so the live control had collapsed to an unsuitable quality benchmark. This does not change production behavior: the legacy selector remains the production source.

For reproducible shadow quality measurement, P3 uses `2026-07-21T12:00:00.000Z` as the benchmark control time. At that reference time all 600 records are fresh and all 24 cases can fill their requested limit. The operator reports this benchmark separately from `current_control_health`, so a healthy historical comparison cannot masquerade as healthy current production data.

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

**P2 decision remains binding during P3: no cutover.** Semantic and hybrid retrieval remain measurement-only challengers; the legacy selector remains production control and fallback.

### P3 live result

The durable live measurements are in `evidence/p3-live-shadow-evidence.json`. The dedicated Supabase target contains 600 assets from 576 sources after two idempotent 25-record-batch imports. The live lexical path reproduces the healthy-snapshot lexical quality metrics exactly: overlap@k `0.53125`, legacy top-1 retention `0.70833`, exact surface/platform `1.0/1.0`, and graph empty rate `0` across 24 cases. Live graph latency measured p50 `54.65 ms` and p95 `191.03 ms`.

The first deployed lexical run exposed an overly strict all-term query in `002_reference_graph_rpc.sql`; `004_reference_graph_lexical_overlap.sql` fixes the deployed RPC to use deterministic partial token overlap and is covered by fresh-database CI. No compatible exact-model document embeddings were available in the live target, so semantic and hybrid live modes are recorded as `unavailable` rather than assigned fabricated quality scores.

**P3 decision: no cutover.** The live path is operational, but lexical overlap and top-1 retention remain below the independent quality thresholds.

## Memory boundary

Reference-derived learnings enter Memory only through explicit `memory.protocol.v1` `capture_evidence` proposals. Reference Graph never automatically emits `assert_claim`, never sets authority class, and never treats repeated retrieval as promotion.