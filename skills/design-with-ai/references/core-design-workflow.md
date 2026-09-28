# Core design workflow

Use this reference for every non-motion visual workflow. Workflow type defines
what may change. Quality profile defines evidence depth and iteration count.
Never use `deep` as a synonym for "more polish."

## Surface classification

Classify the surface before choosing a visual pattern:

- marketing or campaign landing page;
- public homepage or service entry point;
- authenticated home or launcher;
- dashboard for monitoring and drill-down;
- workspace or editor where work is performed;
- catalog, library, or discovery surface;
- transactional or sequential flow;
- content or editorial surface;
- bounded component embedded in another surface;
- hybrid, with each role named and prioritized.

State the first-screen job in one sentence. A homepage explains purpose and the
next meaningful step. A launcher routes users toward work and status. A
dashboard summarizes changing state. A workspace performs the task. Do not let
one surface inherit another surface type's default skeleton.

## Nine required artifacts

Scale the artifacts to the selected profile, but do not silently skip them.

### 1. Contract ledger

Record every relevant constraint as `LOCKED`, `NEGOTIABLE`, or `UNKNOWN`.

- Behavior, security, permissions, privacy, data contracts, analytics hooks,
  accessibility semantics, legal obligations, and recovery behavior are
  `LOCKED` unless the user explicitly authorizes a change.
- Stable URLs, navigation labels, content ownership, brand rules, tokens,
  assets, and shared primitives follow explicit user and project decisions.
  Existing implementation alone does not make them locked.
- `UNKNOWN` is not permission. A direction may describe the opportunity, but
  implementation stops for authority if it requires changing that item.

Preserve functional contracts, not surface allocation. Radical composition is
compatible with stable behavior when every locked contract has a visible owner.

### 2. Purpose brief

Record audience, entry context, first-screen job, primary action, desired
outcome, why this surface owns that job, emotional posture, and success signal.
If "why this surface" can only be answered with "because it is there now," the
surface role is `NEEDS_REVISION`.

### 3. Content disposition

For existing content, assign one disposition with a destination and reason:

- `PROMOTE`: becomes more immediate or prominent;
- `KEEP`: remains at its current priority;
- `DEMOTE`: remains available with lower prominence;
- `MOVE`: belongs on a named secondary surface or step;
- `CONDITIONAL`: appears only for a relevant state or audience;
- `REMOVE`: removed from this surface without deleting a locked capability.

For a new surface, create the same map from product requirements. A complete
inventory on one screen is not automatically good information architecture.

### 4. IA and journey model

Map entry points, primary task path, browse/search strategy, secondary
surfaces, return path, state continuity, and responsive context changes. Load
`intent` plus `references/information-architecture.md` when taxonomy, navigation, or content ownership is an open problem; load `intent` plus `references/interaction-patterns.md` when sequence, branching, recovery, or cross-surface flow is open; stay on `intent` when a new device or context needs more than responsive reflow. `organize`, `journey`, and `transpose` are not installed.

### 5. Visual-world brief

Declare the current visual language `CHOSEN`, `INHERITED`, or `UNKNOWN`, then
assess its fit. Define the selected world's typography voice, palette logic,
materiality, imagery, density, shape language, icon logic, motion grammar,
signature artifact, and explicit refusals.

Existing tokens are evidence, not automatic proof that the current world fits.
Explicit brand and project rules still win. For deep work, state whether a
competitor in the same category could reuse the visual world unchanged. If yes,
the direction is too generic and must be revised.

### 6. Direction set

Separate IA alternatives from art-direction alternatives so a layout change
cannot masquerade as a new concept. Each direction records:

- surface role and first-screen job;
- content disposition and secondary surfaces;
- interaction and traversal model;
- responsive composition;
- visual-world premise and semiotic references;
- signature artifact and refusals;
- tradeoffs and locked-contract coverage.

### 7. Representative slice

For deep redesign work, production implementation remains locked until the user
approves one named direction from the pre-code redesign packet. Then render the
highest-consequence slice and its narrow-state composition before building the
whole surface. The slice must reveal the selected purpose, IA, and visual world.
Reject the complete direction before full implementation if it still reads as
the old concept or a generic category template; do not repair it through polish.

### 8. Evidence loop

Inspect the real render, compare it with the contract ledger and intended
purpose, critique concrete defects, revise, and only then polish. Verification
must distinguish four claims: functional contracts preserved, purpose/IA fit,
visual-world specificity, and rendered implementation quality.

### 9. Generation brief

For standard and deep work, load `source-evidence.md` and translate the selected
purpose, IA, visual world, real content, states, references, responsive model,
accessibility requirements, signature artifact, and contextual refusals into
one execution contract before the representative slice or implementation.
Target only dimensions that are open in the contract ledger. A generic
aesthetics prompt may not silently unlock typography, palette, motion, content,
or structure.

## Evidence and inspiration

For standard or deep research, build a small annotated reference set with
separate lanes:

1. usability or accessibility evidence;
2. real products from the domain and adjacent domains;
3. visual or cultural references outside the immediate software category.

Record the transferable principle from each reference. Dribbble, Awwwards,
Pinterest, and galleries are inspiration, never usability evidence. Direct
competitors reveal conventions but must not define the entire visual world.
Use `source-evidence.md` to classify each claim, record source access and
applicability, and select flow, research, craft, system, or typography sources
for the question actually being answered.

## Workflow authority matrix

| Workflow | Purpose | IA/content | Visual world | Functional contracts |
|---|---|---|---|---|
| `audit-surface` | analyze | analyze | analyze | read-only |
| `improve-existing` | locked | locked | preserve and refine | locked |
| `restyle-existing` | locked | locked | replace deliberately | locked |
| `redesign-existing standard` | preserve unless opened | negotiable | negotiable | locked |
| `redesign-existing deep` | challenge explicitly | remodel when authorized | reset explicitly | locked |
| `build-product-surface` | define | define | define | product contracts locked |

When an unknown authority materially changes the result, present the preferred
direction and the authority gap before implementation. Do not quietly choose the
safer old structure and call it deep.

## Profile depth

- **quick:** bounded artifact, current purpose and IA fixed, one critique pass,
  targeted browser evidence.
- **standard:** complete applicable artifacts, annotated rationale, desktop and
  mobile evidence, one rendered revision.
- **deep:** explicit current-versus-target purpose, full contract ledger and
  content disposition, 2-3 orthogonal IA concepts, at least two distinct visual
  worlds, representative slice, and at least two rendered revision cycles.

Deep directions must differ in concept, not only geometry. If old and new share
the same purpose, content priority, interaction grammar, and visual semiotics,
the result is `RESTYLE, NOT DEEP REDESIGN` even when topology changed.
