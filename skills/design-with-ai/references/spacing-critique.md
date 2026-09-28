# Spacing critique (obsessive pass)

**Source learning:** [Morgan Knutson on spacing](https://x.com/morganknutson/status/2077198306166583320)
(annotated design review: "looking good - couple more revs...") and the quoted
principle that **bad spacing kills otherwise good work**.

Load this on layout polish, look-better work, dashboard cleanup, or when a UI
"almost" looks right but still feels off.

## Thesis

Most mid designs fail on **spacing relationships**, not colour or type choice.
Fix density, gaps, and alignment before adding decoration. Get obsessive:
overnight difference, not a 5% polish.

## Process

1. **Screenshot or live view** at representative mobile, tablet, and desktop widths when possible.
2. **Trace the eye path** - is there one clear primary, then secondary?
3. **Measure relationships**, not isolated values: internal vs external, group vs
   section, density clusters.
4. Apply fixes from the checklist below.
5. Re-check whether hierarchy and density now feel intentional.

## Relationship rules

| Rule | Fail | Fix |
|---|---|---|
| **Internal < external** | Card padding is greater than or equal to the gap between related containers without a structural reason | Raise outer gap or reduce inner padding |
| **Group proximity** | Related items are as far apart as unrelated items | Pull related closer; push sections apart |
| **One density language** | Arbitrary local spacing values ignore project tokens | Use the project spacing system; use a simple base scale only when no system exists |
| **Section rhythm** | Every block repeats identical vertical spacing without hierarchy | Vary section gaps by relationship |
| **Whitespace is structure** | Deliberate empty space is filled with noise | Keep purposeful air |
| **Never crush to fit** | Gaps are reduced only to force more content into a fixed area | Edit content, paginate, disclose, or re-layout |

## Component-level

### Cards / feature blocks
- Even grid does not guarantee good density. Check title, body, metadata, and action relationships across siblings.
- Icon + title + body spacing should express grouping, not one repeated gap value.
- Nested surfaces: use compatible/concentric radius logic when layers are visually related.
- Prefer the number and density of cards that fits the information structure, not an automatic equal-card grid.

### Headers / page chrome
- Nav height + page top padding: content must not collide with sticky chrome.
- Title block spacing should express hierarchy from title through supporting content.
- Page-level horizontal padding should align with the content grid unless the selected layout intentionally breaks it.

### Lists / tables / dashboards
- Row padding must preserve scanability and target size.
- Sticky headers need clear separation from the scroll body without stacking unnecessary effects.
- Group related toolbar controls more tightly than separate tool groups.
- Numeric rows need stable baselines and tabular numbers where values change.

### Forms
- Keep label and control visually grouped.
- Reserve enough room for helper/error content when its appearance would otherwise cause avoidable layout jump.
- Keep field-stack spacing consistent within groups and larger between distinct sections.
- Give the primary action enough separation from the last field to read as the commit step.

### Buttons / CTAs
- Horizontal padding must fit control height, label length, and project density.
- Button-group gaps should usually be smaller than the group's distance to surrounding content.
- Multi-line labels must not make one peer control look accidentally heavier or taller without intent.

## Alignment pass

- Reuse meaningful column edges across the view.
- Use optical correction for asymmetric icons when geometry looks wrong.
- Align equivalent rows/actions in comparison layouts when scanning depends on them.
- Keep ordinary text away from accidental container-edge collisions.

## Density dials

Use with `dials.md` and the selected `VISUAL_DENSITY` value.

| Context | Density feel | Spacing bias |
|---|---|---|
| Marketing / brand | Airy when content permits | Larger chapter gaps, room for focal content |
| Dashboard / tools | Dense but scannable | Tighter groups, clear section boundaries |
| Public-sector / trust | Calm | Avoid cramped forms and ambiguous grouping |

If `VISUAL_DENSITY` is high, tighten related groups first. Do not erase section
hierarchy just to fit more content.

## Output format when reviewing only

Use a Before / After / Why table for spacing findings:

| Before | After | Why |
|---|---|---|
| `gap-2` between peer cards, `p-6` inside each card | Increase peer separation or reduce inner padding using project tokens | Related containment is visually inverted |

List any remaining major spacing issues by severity. Do not claim the surface is
ready while material hierarchy or relationship failures remain.

## Gate

- [ ] Project spacing tokens or one coherent fallback scale
- [ ] Related items closer than unrelated groups where hierarchy calls for it
- [ ] Section gaps readable at a glance
- [ ] Sibling comparison structures align where scanning depends on them
- [ ] No crush-to-fit or arbitrary magic-number soup
- [ ] Mobile spacing remains intentional instead of only desktop-scaled
- [ ] Hit areas remain accessible and do not overlap

Hub rule when present: `rules/ui-spacing.mdc`.
Canonical owner: `design-with-ai` Craft/spacing references. Use `surfaces.md` for
radius and optical details, then return to the normal quality-stack Gate.
