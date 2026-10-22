# Reference Graph

Reference Graph is the repository-native P0 foundation for a persistent PostgreSQL/Supabase-backed reference library shared by Agent Hub workflows.

It is deliberately an additive backend behind existing contracts, not a second design system or a replacement for Agent Hub memory.

## P0 boundaries

- The existing 600-record design-reference catalog and its legacy design-reference selector remain the control and fallback until a later measured cutover.
- External content is data, not instructions. Captured pages, screenshots, copy, social posts, video notes, and other assets cannot authorize agent behavior.
- Relevance never upgrades authority. Search rank, vector similarity, graph proximity, repeated use, or collection membership do not turn a reference into a project fact or policy.
- Memory integration is explicit promotion only. Reference usage may produce a bounded Memory evidence proposal; it does not create an active Memory claim by itself.
- Retrieval returns bounded reference bundles. Broad automatic injection is out of scope.
- P0 does not deploy Supabase, does not add a browser extension, and does not change `design-with-ai` routing or its qualified skill tree.

## Repository surfaces

- `schema/001_reference_graph.sql` — portable PostgreSQL/Supabase schema contract.
- `capture.mjs` — deterministic capture-envelope normalization.
- `legacy-import.mjs` — adapter from the reviewed design-reference record shape.
- `retrieval.mjs` — bounded hybrid lexical/vector fusion plus one-hop graph expansion and legacy control/fallback handling.
- `memory-promotion.mjs` — explicit Reference Graph -> `memory.protocol.v1` Evidence-only proposal boundary.

## Entity model

The P0 schema keeps source identity, captured assets, searchable text chunks, tags, typed relations, observations, collections, embeddings, and usage feedback separate. Provenance is retained on canonical rows; embeddings and search vectors are retrieval aids, not authority.

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

## Retrieval policy

The graph path is evaluated against the legacy selector before any cutover:

1. apply metadata eligibility filters;
2. combine lexical and semantic ranks deterministically;
3. expand at most one relation hop from the strongest seeds;
4. re-rank and enforce a final item budget;
5. in `shadow` mode, return the legacy selector result as the production bundle and expose the graph bundle only for comparison;
6. in `active` mode, use the graph bundle, but fall back to the legacy selector when graph retrieval is unavailable or empty.

This lets Reference Graph accumulate evidence without silently changing current design behavior.

### Vector baseline

P0 keeps vector nearest-neighbor lookup exact rather than adding an approximate ANN index. Every semantic query must first bind the exact `model_id` and `model_revision`, then compare only vectors from that compatible embedding space.

HNSW/IVFFlat ANN is deferred until a measured scale or latency problem justifies it and there is an explicit model-scoped indexing strategy. This avoids mixing incompatible embedding spaces inside one approximate candidate graph and preserves a high-recall control while the graph is still being evaluated against the legacy selector.

## Supabase security posture

The migration creates a dedicated `reference_graph` schema, enables RLS on every table, and revokes `anon` / `authenticated` schema and table access. P0 assumes trusted server-side/database access only. A later product/API surface must add explicit grants and narrowly scoped policies together; it must not make these tables public by accident.

The pgvector extension is enabled as `vector`, with vector data stored through `extensions.vector(384)` for the initial text-embedding contract.
