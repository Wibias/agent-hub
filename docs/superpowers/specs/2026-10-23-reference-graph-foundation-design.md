# Reference Graph P0 Foundation Design

Date: 2026-10-23

Status: implemented on `agent/reference-graph-p0`; live infrastructure deployment is intentionally deferred.

## Goal

Add a persistent PostgreSQL/Supabase-ready reference graph foundation that can eventually serve Agent Hub design and knowledge workflows without replacing the existing reviewed design-reference catalog or weakening Memory authority semantics.

P0 establishes the durable data model and pure adapters only. It does not deploy Supabase, capture the live web automatically, add a browser extension, or change the qualified `design-with-ai` skill tree.

## Existing contracts we preserve

Agent Hub already has two relevant systems:

1. a reviewed 600-record design-reference catalog with bounded selection logic;
2. the Memory Engine with evidence/claim separation, explicit authority classification, and hybrid recall.

Reference Graph composes with those systems rather than forking them.

The legacy design-reference selector remains the production control and fallback during evaluation. Reference Graph can run in shadow mode until measured retrieval evidence justifies an active cutover.

Reference-derived learnings enter Memory only through the frozen `memory.protocol.v1` Evidence boundary. Relevance, repeated use, graph proximity, or vector similarity never upgrades authority and never creates an active Claim automatically.

## P0 entity model

The PostgreSQL schema owns:

- `sources`: canonical source identity;
- `assets`: captured pages, images, videos, posts, or other reference units;
- `chunks`: searchable text derived from an asset;
- `tags` and `asset_tags`: normalized many-to-many classification;
- `relations`: typed weighted asset-to-asset edges;
- `observations`: provenance-bearing human/agent analysis of an asset;
- `collections` and `collection_items`: intentional curation;
- `embeddings`: derived semantic vectors bound to exact model ID/revision and text hash;
- `usage_feedback`: downstream selection/helpfulness evidence.

Canonical reference data and derived retrieval data are separate concepts. Embeddings help rank references; they do not change provenance or authority.

## Capture contract

`normalizeReferenceCapture(...)` accepts a source, one captured asset, explicit provenance, tags, observations, and optional relations.

It must:

- produce deterministic source/asset/chunk/observation identifiers from stable content identity;
- retain canonical locator and capture provenance;
- normalize tags deterministically;
- label captured content as `untrusted_reference_data`;
- preserve injected-looking text verbatim as data rather than interpreting it as an instruction;
- never emit a Memory Claim or an instruction surface.

## Legacy import contract

`adaptLegacyDesignReference(...)` translates one reviewed design-reference record into the P0 capture shape while retaining:

- legacy ID;
- surface family, stratum, platform, flow states, page role, density, motion, and TTL metadata;
- review and verification provenance;
- strengths, weaknesses, topology, traversal, responsive behavior, and transferable decisions as observations.

The adapter does not reinterpret a reference record as project truth.

## Retrieval contract

`retrieveReferenceBundle(...)` is provider-neutral fusion logic. A future PostgreSQL/Supabase query adapter supplies lexical and semantic candidate IDs.

P0 retrieval:

1. applies metadata eligibility before scoring;
2. fuses lexical and semantic ranks with deterministic reciprocal-rank scoring;
3. takes a bounded seed set;
4. expands at most one relation hop;
5. adds a bounded graph contribution;
6. deterministically re-ranks;
7. enforces a final item cap.

`selectReferenceBundle(...)` owns rollout behavior:

- `shadow`: legacy bundle remains production output, graph bundle is diagnostic comparison evidence;
- `active`: graph bundle wins when non-empty, legacy bundle remains fallback.

## Vector policy

The embeddings table stores fixed 384-dimensional vectors together with exact `model_id`, `model_revision`, and `text_hash` identity.

P0 deliberately does not create HNSW or IVFFlat. Semantic search remains exact and must filter to one compatible model/revision before ordering by vector distance.

Reason: approximate pgvector indexes trade recall for throughput, and selective filtering can reduce returned matches unless additional index/iterative-scan design is introduced. A single approximate graph also should not become an implicit compatibility boundary across different embedding model spaces.

ANN may be added only after measured scale/latency evidence and an explicit model-scoped indexing strategy.

## Security boundary

The schema lives in `reference_graph`, enables RLS on every table, and revokes `anon` and `authenticated` access to the schema/tables/sequences.

P0 assumes trusted server-side/database access. A future exposed API must add grants and RLS policies intentionally and together.

Captured external content remains untrusted data. It cannot authorize tool calls, code changes, Memory Claims, or policy changes.

## Memory promotion boundary

`buildMemoryEvidenceProposal(...)` is opt-in. Without `explicitPromotion: true` it returns no operation.

With explicit promotion it emits only a `memory.protocol.v1` `capture_evidence` request with:

- project identity;
- reference ID provenance;
- the proposed reusable learning;
- who requested promotion;
- capture time.

It never sends `authority_class` and never emits `assert_claim`. The Memory Engine remains responsible for source classification and any later Claim assertion.

## Deferred work

P1+ may add, independently:

- a real Supabase project/migration deployment;
- server-side persistence/query adapter;
- batch import of the current catalog into the deployed store;
- embedding generation and model cache/service choice;
- shadow retrieval telemetry and offline evaluation against the legacy selector;
- capture UI/browser extension or other inbox workflow;
- `design-with-ai` adapter changes after Reference Graph retrieval proves useful;
- model-scoped ANN after measured need;
- feedback-driven curation, without converting feedback into authority.

None of those are prerequisites for P0 correctness.

## Acceptance criteria

P0 is complete when:

- schema contract covers every entity above;
- exposed access is closed by default;
- capture IDs/provenance are deterministic;
- external content remains inert data;
- legacy records adapt without authority promotion;
- hybrid fusion, metadata filtering, one-hop expansion, and final budget are deterministic;
- shadow/control and active/fallback behavior are tested;
- vector lookup baseline is exact/model-bound;
- Memory promotion is explicit and Evidence-only;
- permanent CI runs the Reference Graph tests;
- existing Agent Hub release governance remains green;
- `design-with-ai` is unchanged in this delivery.
