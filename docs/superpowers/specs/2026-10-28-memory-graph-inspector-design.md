# Memory Graph Inspector Design

## Goal

Add a read-only graph view to the existing local Memory Console so stored Agent Hub Claims are visible as connected Memory nodes, while laying a safe foundation for later graph-assisted recall.

## Product shape

The existing loopback-only Memory Console remains the sole UI surface. Add a `Graph` tab beside Memories/Review/Pipeline/Health/Quality/Stale. The graph displays the Claims already stored in `memory.sqlite3`; it does not create a second memory store and does not mutate canonical state.

Each node represents one canonical Claim in the selected project + branch and exposes its stable ref, value, kind, subject, predicate, state, authority/provenance, creation time, semantic-index status, and recall-usage metadata.

## Relation classes

Relations are always labeled by origin.

### Explicit

Derived only from canonical memory state:

- lifecycle events such as `supersedes` and `rejects`;
- canonical conflicts as `conflicts_with`.

These edges are authoritative descriptions of stored memory state.

### Inferred

Derived only from compatible stored Claim embeddings. Inferred edges are `semantic_similarity`, carry a numeric cosine weight, embedding model/revision provenance, and are never treated as facts. The UI renders them distinctly from explicit relations.

No model-generated free-form relationship is persisted or presented as authoritative.

## Bounds

Graph generation must remain safe as the database grows:

- scope is one project + branch;
- maximum 500 nodes per graph response;
- only compatible embedding profiles may be compared;
- semantic similarity threshold defaults to `0.82`;
- at most 3 semantic neighbors per node;
- duplicate undirected semantic/conflict edges collapse to one edge;
- graph generation is read-only and creates no tables, embeddings, lifecycle events, candidates, telemetry, or Claims.

When more than 500 Claims exist, prefer active and most recently created Claims and report truncation in graph stats.

## Retrieval foundation

The graph module also exposes a bounded pure traversal helper for later Graph Recall Shadow Mode. Given anchor Claim IDs it may expand only known graph edges, with explicit limits on hops, candidates, and minimum edge weight. This helper does not change production recall in this PR.

The future shadow phase will compare graph-expanded candidate sets against the current lexical/semantic/Judge path and measure candidate reduction, final-selection recall, false negatives, Judge usage, and estimated candidate-token cost before any authority change is considered.

## UI behavior

The Graph tab provides:

- node search;
- edge-origin filter: all / explicit / inferred;
- state filter;
- click/tap node selection with detail inspector;
- visible legend for explicit vs inferred relations;
- neighbor list with relation, weight, and provenance;
- simple deterministic force-style layout in SVG, bounded and local-only;
- direct handoff from a selected node to the existing Claim inspector.

The map must remain useful without animation. Continuous animation is not required.

## Security and privacy

The existing loopback-only server, host validation, CSP, no-store response policy, and same-origin action protections remain unchanged. The graph endpoint is GET/read-only. It returns only data already available to the Memory Console plus embedding-derived similarity scores; raw embedding vectors are never returned to the browser.

## Non-goals

- no production Recall routing change;
- no automatic promotion of graph-assisted candidates;
- no canonical DB schema migration;
- no new durable relation type;
- no external network dependency;
- no replacement for the Reference Graph.

## Acceptance

1. Real stored Claims appear as graph nodes for a selected project/branch.
2. Canonical lifecycle/conflict relations appear as explicit edges.
3. Compatible embeddings may produce bounded, provenance-labeled semantic edges.
4. Raw vectors never leave the engine.
5. The Graph tab works inside the existing `node .\scripts\memory-ui.mjs` console.
6. Graph construction and traversal are deterministic, read-only, bounded, and covered by tests.
7. Existing memory-engine and Memory Console behavior remains green.
