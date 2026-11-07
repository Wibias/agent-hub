# D12.1 Memory Console: readable graph and mobile drill-down

**Skill execution:** `design-with-ai` -> `improve-existing standard` -> Direction, Baseline, Craft, Gate. Scoped to the existing Graph and Memories views at `/`. Baseline: user-supplied screenshots of live D12 on 2026-11-05 at desktop, 760px and 390px and checked-in `memory-ui/app.js` / `styles.css` at `b7c041a78235`.

## First-screen jobs

- Graph: without opening technical IDs, identify which memory a node describes and which **recorded** relation connects it to another memory; optional inferred/typed relations must stay explicitly advisory.
- Memories: scan a meaningful claim and its status; on mobile, open details intentionally instead of scrolling past a permanently expanded inspector.

## Locked contracts

- Preserve dark, understated operator workspace, existing scope/permissions, sanitized browser projection, Git freshness/authority separation and all D1-D12 backend contracts.
- No changed MemoryEngine schema, stored claims, Git trust, implicit capture, generated pnpm/npm relation, or auto-classification. All summaries are deterministic **display excerpts** from existing `node.value`; full value always available in inspector and node accessibility text.
- Keep desktop inspector accessible and maintain actions only in the existing guarded Memories UI.

## Intent and hierarchy

Meaning before identifier. The graph is an explanatory surface, not a telemetry terminal. Use compact calm rectangular nodes whose display text is sourced from each canonical claim. Show existing typed/explicit/inferred edges with differentiated visual language; promote relation *meaning* for the selected node. Opaque refs are in the inspector/hover only. At small widths, graph remains primary and detail appears on request. Do not add a global redesign, bright chromatic cards, gradients, or decorative motion.

## Pre-edit findings (frozen)

- **D12-1-01 (HIGH VISUAL)** Graph node labels show opaque @hex references instead of the meaning of each memory; screenshot at 390px and 760px requires opening the inspector to identify nodes.\n  - Acceptance: For <=24 visible nodes the canvas displays readable claim-derived titles directly on each interactive node, with opaque refs only in disclosure/tooltip; no invented semantic claims.
- **D12-1-02 (HIGH WORKFLOW)** Relation lines show no readable semantic label; screenshots cannot show what rejects or supersedes what.\n  - Acceptance: On selecting a node, recorded relation names are visible on its connected edges, and direction/from/to is inspectable without creating inferred relations.
- **D12-1-03 (HIGH WORKFLOW)** At 390px the graph is scrollable but the full inspector remains permanently stacked after a large canvas.\n  - Acceptance: Small-screen graph displays canvas first and opens an accessible dismissible inspector only on explicit node selection; desktop inspector remains persistent.
- **D12-1-04 (MEDIUM WORKFLOW)** At 390px the memories list and complete inspector are stacked continuously; selected memory creates a very long page and list loses focus.\n  - Acceptance: At mobile widths, memory details are hidden until a memory is selected and have a clear close/back action, preserving existing replace/forget gating.
- **D12-1-05 (MEDIUM DETAIL)** Memories inspector displays empty pipeline fields ('n/a') and no-change lifecycle/conflict sections; primary record meaning gets lost.\n  - Acceptance: Prioritize record, state and source, suppress empty optional pipeline rows by default and keep advanced metadata accessible without fabricating values.
- **D12-1-06 (MEDIUM VISUAL)** Narrow graph screenshot shows tiny text, disconnected visible node labels and overlong controls; 760px screenshot wastes space on vertical scroll and inspector.\n  - Acceptance: Graph uses readable node containers, selective relation labels, compact mobile legend and fit-for-purpose viewport sizes, with no horizontal PAGE overflow.

## Verification plan

- Unit tests: claim-derived label content, no ID-first text, long Unicode/excerpt behavior, selected actual relation labels and no inference, optional fields suppression, and mobile detail open/close preserving action semantics.
- Existing graph/Memory Console regression tests and source taste-gate must pass.
- Browser checks at desktop 1440, tablet 760, mobile 390 in Graph+Memories, including selection, keyboard focus, long values, rejected/historical nodes, empty/evidence-only branches, no stale trust upgrades.
- **Before/after screenshots cannot be fabricated.** Without a browser session on actual current code, final quality remains PARTIAL until visual inspection.

## Finding history

Full earlier D12 findings and their previous review states are retained in `memory-ui/.design-with-ai/findings-ledger.json`; D12.1 adds six dated source-supported findings before making UI changes.
