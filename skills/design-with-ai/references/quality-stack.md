# Unified quality stack

Use this for `improve-existing` and for final polish inside redesign/new-surface
work. It replaces the retired cross-skill polish chain.

## 1. Direction

Load `taste-workflow.md`. Set purpose, genre, macrostructure, visual posture,
colour/type strategy, signature move, and explicit refusals. Preserve incumbent
brand/product truth unless the active workflow authorizes replacement.

## 2. Baseline

Load `baseline-ui.md`. Correct hierarchy, spacing, typography, primitives,
interaction fundamentals, responsive layout, accessibility, loading/error
behaviour, and obvious performance footguns.

Do not add decorative motion in this phase.

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

## Motion opt-in

A selected motion workflow may introduce motion only when it serves orientation,
feedback, continuity, explanation, or deliberately budgeted delight. Ordinary
baseline polish does not add decorative motion just because the page feels flat.
