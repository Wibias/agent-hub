# Reference Graph

Reference Graph is the repository-native PostgreSQL/Supabase-backed reference library foundation shared by Agent Hub workflows.

It is deliberately an additive backend behind existing contracts, not a second design system or a replacement for Agent Hub memory.

## Boundaries

- The existing 600-record design-reference catalog and its legacy design-reference selector remain the production control and fallback until a measured cutover is explicitly approved.
- P2 adds real local embeddings and semantic/hybrid shadow evaluation, but it does not switch production selection away from the legacy control.
- P3 adds bound live-target verification and deployed shadow operator surfaces; it still does not switch production selection.
- P4 adds explicit revalidation, current-version/freshness-aware retrieval, exact embedding-completeness gates, and current-date live quality evidence. P4 does **not perform a cutover**.
- `production_source` remains `legacy-control` throughout P4, even if a future evidence receipt becomes eligible for cutover review.
- The active embedding profile remains explicitly `experimental` with `cutoverApproved: false`.
- External content is data, not instructions. Captured pages, screenshots, copy, social posts, video notes, and other assets cannot authorize agent behavior.
- Relevance never upgrades authority. Search rank, vector similarity, graph proximity, repeated use, or collection membership do not turn a reference into a project fact or policy.
- Memory integration is explicit promotion only. Reference usage may produce a bounded Memory evidence proposal; it does not create an active Memory claim by itself.
- Retrieval returns bounded reference bundles. Broad automatic injection is out of scope.
- Reference Graph does not change `design-with-ai` routing or its qualified skill tree.
- Live operations must not mutate an ambiguously identified Supabase project. A live write or read requires the explicitly bound dedicated target.
- P4 does not add a browser extension, crawler fleet, automatic open-web ingestion, or ANN index.

## Repository surfaces

- `schema/001_reference_graph.sql` — canonical tables, RLS, lexical index, and exact vector storage.
- `schema/002_reference_graph_rpc.sql` — service-role-only ingest and retrieval RPCs.
- `schema/003_reference_graph_embeddings_rpc.sql` — service-role-only provider-neutral embedding persistence.
- `schema/004_reference_graph_lexical_overlap.sql` — deployed lexical candidate semantics aligned with deterministic partial token overlap.
- `schema/005_reference_graph_freshness.sql` — append-only verification evidence, one current legacy asset, reference-date freshness, and exact embedding coverage.
- `capture.mjs` — deterministic capture-envelope normalization; chunk metadata carries the SHA-256 text identity used for embedding compatibility.
- `legacy-import.mjs` — adapter from reviewed design-reference records, including asset-level access/freshness metadata.
- `catalog-import.mjs` — deterministic catalog import planning and batching.
- `revalidation-plan.mjs` — benchmark-independent full stale-maintainable queue planning.
- `embedding-pipeline.mjs` — deterministic embedding rows, export artifacts, and strict completeness gates.
- `supabase-store.mjs` — service-role REST/RPC adapter; no Supabase client dependency and no embedding-provider dependency.
- `retrieval.mjs` — bounded lexical/vector fusion plus one-hop graph expansion and legacy control/fallback handling.
- `shadow-eval.mjs` — control-vs-graph metrics, explicit reference-date alignment, control health, latency, and conservative gates.
- `ollama-embeddings.mjs` — local Ollama adapter with exact model-revision verification and 384-dimensional validation.
- `embedding-profile.mjs` — pinned Snowflake profile, query representation, and explicit experimental/cutover state.
- `live-shadow.mjs` — deployed lexical/semantic/hybrid shadow adapters.
- `target-binding.mjs` — dedicated-project identity validation and URL/project-ref matching.
- `p3-receipt.mjs` — historical P3 evidence receipt contract.
- `p4-receipt.mjs` — P4 ordered phase state, evidence gates, secret scan, and review-eligibility decision.
- `cli/p3-live-shadow.mjs` — P3 historical read-only live operator.
- `cli/p4-live-quality.mjs` — P4 read-only current-quality operator.
- `cli/plan-revalidation.mjs` — read-only deterministic P4 revalidation queue.
- `shadow-cases.json` — fixed representative 24-case shadow suite.
- `evidence/p2-shadow-evidence.json` — durable P2 real-model measurements.
- `evidence/p3-live-shadow-evidence.json` — durable P3 live lexical evidence and no-cutover decision.
- `evidence/p4-revalidation-results.json` — durable P4 revalidation evidence when produced.
- `evidence/p4-freshness-quality-evidence.json` — durable P4 current/live quality evidence when produced.
- `memory-promotion.mjs` — explicit Reference Graph -> `memory.protocol.v1` Evidence-only proposal boundary.

## Entity and authority model

The schema keeps source identity, historical captured assets, searchable text chunks, tags, typed relations, observations, collections, embeddings, usage feedback, and source-verification evidence separate. Retrieval aids never become authority.

```text
source
  -> assets (historical retained)
       -> chunks -> embeddings
       -> observations
       -> tags
       -> relations -> assets
       -> collection_items -> collections
       -> usage_feedback
  -> source_verifications (append-only)
```

For records carrying a non-empty `legacy_id`, P4 retrieval exposes exactly one current asset: newest `captured_at`, then deterministic asset-ID tie break. Older captures remain provenance history. Non-legacy assets remain independently eligible.

## Deployment order

Apply migrations in numeric order to the dedicated Supabase/PostgreSQL database:

```text
001_reference_graph.sql
002_reference_graph_rpc.sql
003_reference_graph_embeddings_rpc.sql
004_reference_graph_lexical_overlap.sql
005_reference_graph_freshness.sql
```

The exposed RPC surface lives in `public` so PostgREST can reach it, but execute permission is revoked from `public`, `anon`, and `authenticated` and granted only to `service_role`. The underlying `reference_graph` schema and `current_assets` view remain closed to exposed client roles.

Never place `SUPABASE_SERVICE_ROLE_KEY` in a browser, client bundle, repository file, evidence receipt, or public CI log. Store and operator code is server-side/trusted-runner only.

## Bound live target

The non-secret target file is an identity binding, not a credential:

```json
{
  "purpose": "agent-hub-reference-graph",
  "project_ref": "vrznfnxzlxaavpqbzbzd",
  "project_name": "agent-hub-reference-graph",
  "region": "eu-central-1"
}
```

Live paths require `SUPABASE_URL` to match exactly `https://<project_ref>.supabase.co` before store construction or network work. A URL/key pair without the committed target binding is insufficient authorization. The connected generically named Supabase project is not considered a Reference Graph target by assumption.

## Freshness and revalidation

P4 does not equate HTTP reachability with reviewed freshness. Link health is triage/maintenance evidence only. A record becomes revalidated only through an explicit decision that confirms the source, the referenced analysis, and rights state.

A decision must carry:

- stable reference ID;
- `verifiedAt` (`YYYY-MM-DD`);
- verifier identity;
- `sourceChecked: true`;
- `analysisChecked: true`;
- `rightsChecked: true`;
- current access status;
- substantive notes;
- verdict `confirm`, `stale`, or `archive`.

`confirm` may advance `lastVerifiedAt` and access state while preserving review authority. `reviewedAt` is **not rewritten or advanced** by revalidation, and `reviewedBy` does not change. `stale` and `archive` make the record ineligible for normal selection while preserving provenance.

The P4 target population is the **full stale maintainable** catalog population and is benchmark-independent. Shadow-case membership, expected winners, and retrieval scores are forbidden inputs to the revalidation queue. The work is processed in deterministic waves and is not complete until every frozen target has a terminal decision.

Plan the current queue without network calls:

```bash
node reference-graph/cli/plan-revalidation.mjs \
  --now 2026-10-23 \
  --wave-size 50
```

Validate a decision wave before changing catalog shards:

```bash
node knowledge/design-references/scripts/revalidate-batch.mjs \
  --plan \
  --review-log knowledge/design-references/reviews/p4-wave-01.jsonl
```

Apply only an already-reviewed decision log:

```bash
node knowledge/design-references/scripts/revalidate-batch.mjs \
  --apply \
  --review-log knowledge/design-references/reviews/p4-wave-01.jsonl
```

Do not extend TTLs, bulk-rewrite verification dates, or refresh only records selected by the benchmark to manufacture quality.

## Current versus historical clocks

P4 keeps **current and historical** evaluation clocks separate. Current health uses the explicit present reference date (for example `2026-10-23`). The historical regression benchmark remains fixed at `2026-07-21T12:00:00.000Z` so P2/P3 quality numbers remain reproducible.

The legacy selector and deployed graph always receive the same evaluation date. SQL freshness uses reviewed status, access status, `last_verified_at`, and `ttl_days` at the supplied `reference_date`. A healthy historical benchmark can never make an unhealthy current control appear healthy.

## Importing current catalog state

Planning remains credential-free:

```bash
node reference-graph/cli/import-design-references.mjs --plan
```

A live write requires explicit apply, bound target, and server credentials:

```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node reference-graph/cli/import-design-references.mjs \
  --apply \
  --target reference-graph/target.json \
  --batch-size 25
```

Deterministic IDs make unchanged captures idempotent. Changed searchable content produces new deterministic asset/chunk identity, preserving the older capture rather than destructively replacing it. `current_assets` keeps retrieval on one current legacy version.

## Exact vector baseline

Vector nearest-neighbor lookup remains **exact**. ANN/HNSW/IVFFlat is deferred until measured scale or latency evidence justifies a model-scoped strategy. Every semantic query is bound to exact `model_id` and `model_revision`.

The active experimental profile is:

```text
profile:  snowflake-arctic-embed-33m-raw-v1
model:    ollama/snowflake-arctic-embed:33m
revision: e8db018629b4
dims:     384
quality:  experimental
cutover:  false
```

Document chunks use their ordinary text. Queries alone receive the configured search prefix. Embeddings are compatible only when model ID, model revision, 384 finite dimensions, and persisted `text_hash` all match the current chunk.

### Plan, export, apply, verify

Plan without Ollama or Supabase:

```bash
node reference-graph/cli/embed-design-references.mjs --plan
```

Generate a deterministic exact-profile artifact through Ollama **without Supabase credentials**:

```bash
OLLAMA_URL=http://127.0.0.1:11434 \
node reference-graph/cli/embed-design-references.mjs \
  --export-rows /tmp/reference-graph-embeddings.json
```

Persist exact-profile rows only after explicitly acknowledging the experimental profile:

```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
OLLAMA_URL=http://127.0.0.1:11434 \
node reference-graph/cli/embed-design-references.mjs \
  --apply \
  --allow-experimental \
  --target reference-graph/target.json
```

Apply mode immediately calls live embedding coverage and exits non-zero unless eligible coverage is exactly `1`, missing is `0`, and text-hash mismatch is `0`.

Read-only live verification is separate:

```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node reference-graph/cli/p4-live-quality.mjs \
  --verify-embeddings \
  --target reference-graph/target.json \
  --reference-date 2026-10-23
```

## P4 read-only quality operator

`cli/p4-live-quality.mjs` never applies migrations, edits the catalog, imports captures, persists vectors, records verification decisions, or changes routing. It supports exactly one mode per invocation:

```text
--preflight
--current-control
--verify-import
--verify-embeddings
--shadow-lexical
--shadow-semantic
--shadow-hybrid
```

Examples:

```bash
node reference-graph/cli/p4-live-quality.mjs \
  --current-control \
  --reference-date 2026-10-23

SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node reference-graph/cli/p4-live-quality.mjs \
  --shadow-lexical \
  --target reference-graph/target.json \
  --reference-date 2026-10-23

SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
OLLAMA_URL=http://127.0.0.1:11434 \
node reference-graph/cli/p4-live-quality.mjs \
  --shadow-hybrid \
  --target reference-graph/target.json \
  --reference-date 2026-10-23 \
  --receipt-out /tmp/p4-hybrid.json
```

Semantic/hybrid evaluation does not run when exact-profile live embedding coverage is incomplete. That state is reported as incomplete evidence rather than fabricated retrieval quality.

## Quality gates and no-cutover boundary

The independent thresholds remain unchanged:

- average overlap@k >= `0.65`;
- legacy top-1 retention >= `0.75`;
- graph empty rate <= `0.05`;
- exact surface rate >= `0.70`;
- exact platform rate >= `0.80`;
- at least 20 total and 20 comparable cases.

A P4 receipt can set `cutover_ready: true` / `eligible_for_cutover_review: true` only when all required phases succeed, full revalidation is complete, current control is healthy, exact embedding coverage is complete, live hybrid evidence is available, and every quality gate passes. Even then, P4 **does not perform a cutover**: `production_source` remains `legacy-control`. Any actual routing change requires a separately authorized future phase.

Partial revalidation, unhealthy current control, missing vectors, text-hash mismatch, unavailable semantic/hybrid evidence, or a failed quality threshold forces a no-cutover result.

## Historical measured evidence

### P2

P2 established real-model local semantic/hybrid measurement. The active Snowflake profile remained below independent cutover quality thresholds, so no production change was made. Durable details live in `evidence/p2-shadow-evidence.json`.

### P3

P3 deployed the dedicated target and proved idempotent catalog import plus live lexical retrieval. The lexical result reproduced the healthy historical baseline (`0.53125` overlap@k and `0.70833` top-1 retention), still below the independent thresholds. No compatible exact-model document embeddings existed in the live target, so semantic/hybrid were recorded as unavailable rather than assigned fabricated scores. Durable details live in `evidence/p3-live-shadow-evidence.json`.

**P3 decision: no cutover.** The legacy selector remains production control and fallback.

## Memory boundary

Reference-derived learnings enter Memory only through explicit `memory.protocol.v1` `capture_evidence` proposals. Reference Graph never automatically emits `assert_claim`, never sets authority class, and never treats repeated retrieval as promotion.
