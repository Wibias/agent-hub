# Memory Graph v2: Entities, Project Scope and Measured UI Evidence (2026-11-27)

## Scope

This increment completes the connected-memory graph work on top of #453 without
adding a graph database, cloud service, security layer, or a second memory
model. It adds a deterministic entity projection, a project-wide diagnostic
graph, project navigation, graph interaction fixes, isolated-node control, and
measured browser evidence.

## Entity projection

New module: memory-engine/memory-graph-entities.mjs.

- Entities are extracted from Claim text only. They never become Claims,
  canonical relations, approvals, or user authority.
- IDs are stable: entity:<projectId>:<normalizedKey>; references use
  E:<sha10>.
- The projection supports known technologies, module/file names, ports,
  capitalized German concepts, English noun phrases after determiners,
  coordinated nouns, and plural nouns.
- Quoted third-party text is stripped before extraction.
- Each Claim yields at most 5 entities. A graph shows at most 240 entity
  nodes, at most 2000 entity edges, and at most 3 entity links per Claim.
- Bounds are reported as entityNodesOmitted and entityEdgesOmitted, never
  hidden as success.
- Entity nodes retain their full source-bound claimIds and evidence refs;
  only drawn membership edges are bounded.

The graph distinguishes Claim nodes from entity nodes visually (diamonds),
technically (nodeType: entity, authority: derived), and in the inspector.

## Existing memories and backfill

No persistent backfill is required for entity links. Every graph request
recomputes the projection from the current canonical Claims, so older
memories participate automatically. The projection is read-only and leaves
memory.exportCanonical() unchanged; this is covered by regression tests.

A persistent backfill is only relevant to typed advisory relations. The
existing claim_relations ledger already persists those independently; the
graph reads them through the bounded listTypedRelations path.

## Typed advisory relations

The graph renders real persisted supports, depends_on, implements, and
related_to edges as advisory, never as proof. A fresh isolated fixture with one
persisted supports edge and one similarity edge rendered 5 nodes and 6 links,
including the typed edge. Production data currently contains zero typed
relations; no automatic typed-relation producer was introduced because a
topical match is not a support relation.

## Topics and communities

Communities are connected components of the persisted/derived edge set, not
invented topics. Labels come from the most connected actual entities in the
component, falling back to a compact recorded Claim title. Topic nodes are not
projected; the dashboard states this explicitly as
"0 · entity/community projection only" instead of fabricating topics.

## Project graph

The Graph view now offers Branch graph and Project graph.

- Project scope merges Claims from all branches of the selected project only.
- Each Claim keeps its original branch; entities record every branch they
  occur in.
- A branch filter is available in project scope.
- Project scope is capped at 500 Claims across branches, newest first, with
  projectClaimsOmittedByBound and truncated reported.
- Project scope does not widen Recall authority and does not classify
  cross-branch differences as conflicts.

## UI fixes

- Project search, active-first list, optional empty projects, duplicate-name
  suffixes, and full project IDs in tooltips.
- Desktop graph inspector can be closed; a closed inspector no longer
  reserves a 360 px column. The close control is visible on desktop.
- The Git banner is compact when the scope has no repository-backed memories.
- Isolated nodes are hidden by default; the Isolated checkbox reveals them.
  Search still finds isolated matches.
- Labels are progressive: small graphs label every node; larger graphs label
  selected and sufficiently connected nodes; hovering/focus still reveals a
  label.
- The graph canvas fits short desktop viewports; mobile keeps a 1200 x 680
  scrollable canvas so labels and hit targets stay readable.
- A stale-response guard prevents an older loadGraph response from replacing
  a newer project/branch/threshold result.

## Measured performance

Synthetic isolated dataset: local.test/agenthub-perf, branches size-0 through
size-500, 831 Claims. Semantic embeddings were absent, so the measured graph
contains entity and recorded links only; this is stated to avoid presenting
semantic-edge cost as measured.

| Claims | API cold/warm ms | Payload KB | Browser API/render ms | Visible nodes | Drawn links |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 47 / 7 | 0.9 | 8 / 1 | 0 | 0 |
| 1 | 22 / 9 | 5.9 | 8 / 7 | 4 | 3 |
| 5 | 13 / 11 | 27.3 | 11 / 4 | 19 | 14 |
| 25 | 19 / 21 | 67.9 | 24 / 6 | 39 | 70 |
| 100 | 86 / 61 | 221.1 | 66 / 12 | 114 | 280 |
| 200 | 168 / 102 | 425.0 | 121 / 33 | 214 | 560 |
| 500 | 304 / 341 | 1036.6 | 310 / 58 | 514 | 1400 |

Budgets used for acceptance: API at 500 Claims at most 750 ms, browser
render at most 150 ms, payload at most 1.5 MB. All measured values pass.
The 500-Claim graph hides 3 isolated entity nodes by default, reports 300
entity links omitted, and keeps 17 entity nodes.

JS heap usage was not measurable through the browser evaluation surface; it
remains NOT MEASURED. DOM/SVG counts and payload size are reported instead.

## Visual and interaction verification

Reviewed in the in-app browser at 1920x1080, 1366x768, 768x1024, and 390x844.

Verified interactions:

- Project search and Show empty (1/18 to 18/18 on the real store).
- Branch graph to Project graph switch; original branch shown in the
  inspector; branch filter returns only the selected branch's Claim.
- Entity diamond selection and inspector; navigation from entity to its Claim.
- Desktop inspector close and reopen; stage expands from 1142 px to the full
  available width when closed.
- Isolated toggle (20 to 28 nodes on the real Streamer graph).
- Search focus (Light Forge), zoom controls, fit, reset, node selection.
- Threshold change, relation filters, node-type filter, community filter.
- Empty graph state at size-0.
- Typed advisory fixture with a real persisted supports relation.

The five reference images were used as direction for organic layout, compact
nodes, progressive labels, community grouping, and direct manipulation. The
500-node stress graph remains a dense ring by design; it is a stress view, not
a claim of semantic quality.

## Known limitations

- Memory quality remains NOT HUMAN-VALIDATED. The 20-case packet in
  docs/memory-quality-review-2026-11-27.json is synthetic and unvalidated.
- Topic nodes are not projected. Entity/community projection is shown instead.
- Production typed advisory relations are zero; the typed fixture is separate
  from production data.
- The full design-with-ai native render receipt is not certified in this host
  session because its workspace is outside this repository. The mechanical
  source taste gate returns PASS_MECHANICAL (P0/P1/P2 = 0), but a new Codex
  session opened at the repository root is required for the native gate.
- The full local suite is 1473/1486 passing. The 8 remaining failures are
  environment/data dependent: Unix-domain-socket tests on Windows, a POSIX
  path expectation in the hook installer test, and real Codex CLI tests that
  require an active durable production memory.

