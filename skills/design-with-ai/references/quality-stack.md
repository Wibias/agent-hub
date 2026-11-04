# Unified quality stack

Use this for `improve-existing` and for final polish inside redesign/new-surface
work. It replaces the retired cross-skill polish chain.

## 1. Direction

Load `taste-workflow.md`. Set purpose, genre, macrostructure, visual posture,
colour/type strategy, signature move, and explicit refusals. Preserve incumbent
brand/product truth unless the active workflow authorizes replacement.

### Role allocation check

Before applying a visual preset across the screen, use the role-to-treatment
map from `taste-workflow.md`. Compare the primary work object, supporting
information, configuration, and any sequential/actionable region actually
present. Record where visual grammar should be shared and where the
different task warrants distinct layout, typography, density, or containment.
Do not force components into novel shapes when the original repetition serves
real comparison or scanning.

## 2. Baseline

Load `baseline-ui.md`. Correct hierarchy, spacing, typography, primitives,
interaction fundamentals, responsive layout, accessibility, loading/error
behaviour, and obvious performance footguns.

Do not add decorative motion in this phase.

### Task-first acceptance before Craft

For an operator surface found in the inspected target, apply the task-first
check in `baseline-ui.md` to a real render before spending time on micro-craft.
Report the following as observed, failed, or unverified:

- first-screen task and the action/record that should dominate;
- whether the highest-consequence state, blocker, or next step is discoverable;
- whether real item content is represented more meaningfully than raw system metadata;
- whether essential labels and controls remain readable at normal zoom;
- whether repeated same-weight containers represent genuinely comparable items;
- whether status/readiness claims agree with known product semantics.

A visual pattern scan does not replace this check. If a substantive defect
remains, revise the design or expose the product-model/authority gap before
Craft. Do not use color or decoration to conceal a failed task-first verdict.

### Style overcorrection check before Craft

Inspect the integrated render. Check that an attempt to remove slop did not
replace one all-over motif with another. If semantically different regions
look interchangeable (e.g. every section is a thin-lined ledger), revise
the role-to-treatment distribution first. A chosen brand system may justify
repetition; the issue is unearned sameness, not a particular aesthetic.

Record independent `FUNCTIONAL_QUALITY` and `VISUAL_DIRECTION_FIT` judgments
using `critique-protocol.md`. Do not promote a failed functional verdict
because the art direction is consistent or fashionable.

## 3. Craft

Load `micro-craft.md`. Refine optical alignment, concentric radius, surface depth,
hit areas, dynamic numerals, text wrapping, press feedback, and other small
interaction details. Motion details here refine already-approved motion; they do
not create a new motion language by default.

## 4. Gate

Run `scripts/taste-gate.ps1` on touched UI files when applicable, then inspect
the rendered result. `HOLD` is a mechanically decisive blocker.
`REVIEW` and `REVIEW_CLUSTER` are contextual leads that must be adjudicated
against project truth, the selected direction, and the render; they are not
authorship claims and do not fail solely from their mechanical score.

When the project has a documented design-intent exception file, pass it with
`-IntentPath "<json>"`. Exceptions require a concrete reason and scope and may
suppress only contextual rules or families, never hard gates.

Check representative desktop and mobile sizes, interaction states, focus,
contrast, reduced motion, clipping/overflow, and incumbent design contracts.
For web surfaces with read-only browser evaluation available, use
`rendered-slop-review.md` to add DOM/geometry evidence for structural leads
that source grep cannot establish. When both source and rendered JSON reports
exist for the same candidate, fuse them with `scripts/taste-evidence-fusion.mjs`
so semantic families are counted once across channels. Prefer
`scripts/taste-evidence-receipt.mjs` for the final machine-readable evidence
receipt. A rendered single-candidate receipt requires `--route` so
`snapshot.url` is bound before fusion. Multi-route work uses the receipt
manifest described in `verification-contract.md`; every source target, route,
and snapshot stays paired as one candidate. The receipt records
source/render/fusion coverage and explicitly marks render `not_measured` or
`partial` when coverage is incomplete. When a task spans multiple distinct
routes, use `cross-surface-slop-review.md` after the per-route snapshots to
review G02 macro reuse without treating a shared shell as an automatic failure;
attach that comparator report only when it covers exactly the manifest's
route-bound rendered candidate set, rather than folding G02 into the
source/render score. Do not promote contextual render/fused/cross-surface
verdicts to `HOLD`; only an existing mechanically decisive source P0 can remain
blocking. Load `verification-contract.md` before claiming completion.

## Canonical rules

- Content is visible by default. Never depend on entrance JS to reveal core UI.
- Never use `transition: all`; name intended properties.
- Prefer compositor-friendly motion. Layout-property animation needs a justified
  workflow-specific reason, not habit.
- Use `will-change` only around active motion where it is proven useful.
- Do not enter from `scale(0)` for ordinary UI.
- Respect `prefers-reduced-motion` and pointer capability.
- Use tabular numbers for changing numeric data.
- Hit targets must fit the product density while remaining accessible.
- Fix structure before decorative styling when the surface looks generic.
- Browser/rendered evidence is the visual completion gate when available.
- A passing pattern scan does not replace independent functional-quality and style-distribution review.

## Motion opt-in

A selected motion workflow may introduce motion only when it serves orientation,
feedback, continuity, explanation, or deliberately budgeted delight. Ordinary
baseline polish does not add decorative motion just because the page feels flat.
