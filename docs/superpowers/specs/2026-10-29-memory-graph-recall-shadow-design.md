# Memory Graph Recall Shadow Mode Design

## Intent

Measure whether bounded Memory Graph expansion can preserve the authoritative Recall/Judge result while reducing or reshaping the candidate set, without granting the graph any production authority.

This phase is observational only. The existing lexical/semantic retrieval, reliance checks, fast-path policy, and Judge remain authoritative. Graph Recall Shadow Mode consumes their already-established inputs/results and records comparison evidence for later decisions.

## Chosen approach

Use a **post-authoritative observer** attached to the Codex recall adapter.

The observer receives the ordered reliance-approved candidate IDs and the already-computed authoritative selector result. It builds the bounded project/branch Memory Graph, uses the first eligible current candidates as deterministic anchors, expands with the existing `expandMemoryGraph(...)` helper, and compares the resulting graph candidate set with the authoritative selection.

This was chosen over two alternatives:

1. **Reuse synchronous `shadowFastPath`.** Rejected because that contract intentionally permits only IDs already present in the supplied candidate pool; graph expansion must be allowed to observe novel neighboring Claims.
2. **Run a second Judge on graph-expanded candidates.** Rejected because it would add cost, contaminate natural calibration, and create a new decision path. Shadow evidence must reuse the Judge result that already occurred naturally.

## Authority boundary

Graph Recall Shadow Mode must never:

- replace or reorder `reliance.selected`;
- change `selector.selected_ids`;
- trigger an additional Judge call;
- write Claims, lifecycle events, conflicts, candidates, embeddings, or canonical Memory state;
- promote a graph policy automatically;
- make production Recall depend on the presence or success of the graph observer.

Observer failures are fail-open: the authoritative recall result is returned unchanged.

## Graph policy under observation

Defaults:

- ordered source candidates: the existing reliance-approved candidate order;
- maximum anchors: `3`;
- maximum hops: `1`;
- maximum graph candidates: `8`;
- minimum inferred edge weight: `0.82`;
- explicit edges are always eligible under the existing graph traversal contract;
- graph construction remains bounded to the existing maximum of `500` nodes and compatible embedding profiles only.

Anchors are the first source candidate IDs that exist in the graph, up to the anchor limit. Unknown/truncated source candidates are reported rather than silently substituted.

## Shadow metrics

Each observation reports:

- source candidate count;
- graph anchor count and missing-anchor count;
- graph candidate count;
- source candidates retained by the graph;
- source candidates pruned by the graph;
- novel graph candidates not present in the source pool;
- authoritative selected count;
- authoritative selected hits and false negatives;
- authoritative final-selection recall when a natural Judge result is available;
- whether the graph candidate set would have preserved every authoritative selected item;
- Judge-called / Judge-available state copied from the authoritative path;
- deterministic estimated candidate-token cost for source and graph candidate sets;
- local graph-shadow duration.

Token cost is an estimate only and must be labeled as such. Use a deterministic local estimator based on UTF-8 bytes (`ceil(bytes / 4)`) so evaluation needs no tokenizer dependency or network call.

## Quality eligibility

A sample is quality-eligible only when the authoritative path naturally called the Judge and the Judge completed successfully. Samples without a Judge remain useful for coverage, candidate-shape, cost, and latency metrics but must not be counted as final-selection-recall evidence.

An authoritative Judge selection with zero selected items has no recall denominator; report final-selection recall as `null` and false negatives as zero.

## Durable evidence

Persist observations in a dedicated immutable file-backed store, separate from canonical SQLite Memory and from the existing Fast Path calibration store.

Durable records must not contain:

- prompt/query text;
- Claim values/text;
- raw Claim IDs;
- raw embedding vectors.

Use SHA-256 candidate keys in durable records, following the existing recall-shadow calibration privacy pattern. A query digest may participate in the deterministic observation ID but the query itself is never stored.

Repeated identical observations must be idempotent; conflicting content for the same observation ID must fail rather than overwrite.

## Live gating

Live Graph Recall Shadow Mode is default-off and enabled explicitly by the Memory hook runtime. Enabling it changes evidence collection only, never Recall/Judge authority.

The observer executes locally and synchronously within the existing hook lifetime so Windows process exit cannot drop evidence. Its failure is swallowed at the authority boundary and may be surfaced only through diagnostic status/logging.

## Evaluation

Add a read-only evaluator over stored observations. It should aggregate:

- total observations;
- quality-eligible observations;
- graph-observer failures/skips;
- mean/p95 graph-shadow latency;
- mean source vs graph candidate counts;
- mean estimated source vs graph candidate tokens;
- novel-candidate rate;
- source-pruning rate;
- aggregate authoritative-selection false negatives;
- macro final-selection recall across eligible non-empty Judge selections;
- exact-preservation rate.

Use `100` quality-eligible natural runtime observations as the minimum evidence target before any promotion discussion. The evaluator must never emit a production recommendation automatically in this phase.

## Promotion bar

This PR does not promote anything. A later decision may only be considered after at least 100 quality-eligible natural samples and a separately reviewed promotion policy. Zero-error but zero-coverage evidence is never sufficient.

## Security and privacy

- no network dependency;
- no raw vectors in observations;
- no query text in durable evidence;
- no canonical DB schema migration;
- existing loopback/UI protections remain unchanged;
- stored evidence is diagnostic and non-authoritative.

## Acceptance

1. A pure evaluator produces deterministic graph-shadow metrics from a graph plus authoritative recall inputs/results.
2. Novel graph neighbors can be observed even though they were not in the original candidate pool.
3. The authoritative result is byte-for-byte/structurally unchanged when the observer succeeds, skips, or throws.
4. No extra Judge invocation occurs.
5. Durable samples are immutable, idempotent, and contain no prompt text, Claim text, raw Claim IDs, or vectors.
6. Live collection is default-off and explicit to enable.
7. A read-only aggregate evaluator reports evidence sufficiency against the 100-sample target and never recommends production promotion.
8. Existing Memory Engine and Recall tests remain green.
