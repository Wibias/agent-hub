# Micro craft

Craft phase for small details that make an interface feel intentional after
Direction and Baseline are set.

## Core principles

1. Nested radii should be concentric: outer radius reflects inner radius plus padding.
2. Optical alignment beats geometric centring for asymmetric icons/glyphs.
3. Use layered shadow/depth only when the surface model calls for depth.
4. Interactive motion must be interruptible where rapid retargeting is possible.
5. Split/stagger entrances only when approved motion benefits comprehension; do not add them by habit.
6. Dynamic numbers use tabular numerals.
7. Use balanced heading and readable body wrapping where supported.
8. Image outlines are subtle and neutral, not arbitrary tinted borders.
9. Press feedback is subtle and keeps hit areas accessible.
10. Never use `transition: all`; declare properties.
11. Use `will-change` sparingly and temporarily.
12. Content remains visible by default.

## Load only what is needed

- `typography.md`: wrapping, smoothing, dynamic numerals
- `surfaces.md`: radius, optical alignment, shadows, outlines, hit areas
- `animations.md`: interruptibility, enter/exit, icon morph, press feedback
- `performance.md`: transition properties and `will-change`
- `spacing-critique.md`: relationship/density problems

Motion rules in these craft references refine already-approved motion. New motion
belongs to `motion-opportunities` or another explicit motion workflow.

## Review output

When reviewing, report concrete Before | After | Why changes and omit empty
categories. Finish by verifying the scoped surface, then return to the quality
stack Gate.

Source lineage: jakubkrehel/make-interfaces-feel-better (MIT), adapted into the
unified `design-with-ai` Craft phase.
