# pols.dev anti-slop law (agent digest)

**Source:** https://pols.dev/slop.md  
**Status:** Distilled external guidance for progressive disclosure. On marketing,
greenfield, or "make it not AI" tasks, read this file before the final quality
gate. For a forensic pass, fetch the current source and compare applicable points.

The selected project design system, explicit user direction, and the local
`anti-slop-gates.md` applicability rule decide whether a visual pattern is a
violation. External taste guidance does not override product truth,
accessibility, or implementation safety.

## Ritual (adapted)

1. Before build: load this digest plus `anti-slop-gates.md` when the active workflow requires the anti-slop pass.
2. Before ship: walk **Execution bugs**, **Component tells**, **Layout skeletons**,
   **Deeper tell**, then **Signature formula**. Fix applicable misses. Do not claim done early.

## What slop is

Generic, low-effort, look-the-same output. Avoidance checklists alone are not
design. Clean is the floor; a signature is the achievement.

---

## Execution bugs (ship-blockers)

| Bug | Rule |
|---|---|
| **Invisible-content trap** | Content visible by default. Never start at opacity 0 / translated-off relying on JS/scroll to reveal. Fallback must show full content. |
| **Clear the cut** | `clip-path`, notch, overflow hidden, fixed height must not shave text/controls. Pad past the cut; pixel-check edges. |
| **Center for real** | Intended centers verified mathematically AND optically (SVG: `text-anchor` + `dominant-baseline`). |
| **Ragged comparison grid** | Pricing/feature columns: equal card height, CTA pinned bottom, shared baselines; missing values keep slots. |
| **Text jammed to edge** | Ordinary copy needs gutters; only deliberate bleeds crop. |
| **Hard image seams** | Full-bleed photo -> next section: integrate the transition intentionally; avoid accidental hard bands. |
| **Botched glass** | No banding, leaked shadow, resting halo, or blur pop. Else use a simpler material. |
| **Botched fill motion** | Caps flipping mid-transition, partial fills, stutter = fail. |
| **Dead controls** | If it looks clickable, it must work in browser. |
| **Grain over content** | Grain stays behind readable content unless the selected art direction explicitly uses it as a controlled display effect. |
| **Overlap guillotine** | Layer seams must not clip live content. |
| **Cramped display** | Large type needs air; no crushed tracking. |
| **Fake shadow box** | Do not use a second rectangle as a fake shadow by reflex; use the selected elevation system. |
| **Contrast fail** | Labels on fills, muted-on-muted, ink-on-ink = fail when required contrast is not met. |

---

## Component / chrome tells (match -> review)

These are generic-design signals, not unconditional bans. Fail them only when the
pattern is unrequested, repeated by reflex, or conflicts with the selected visual
system.

- Em-dash prose cadence
- Lucide-everywhere as default icon costume
- Pill/eyebrow hero chip; gradient pill with icon+label
- Glowy pill CTAs; default filled+ghost CTA pair; trailing arrow glow
- Icon-in-colored-tile and logos-in-tiles
- Floating bobbing cards; card hover-lift+bloom+border-glow as default
- Cut-off glow; background corner bloom; radial halo behind object
- Kitchen-sink card with unrelated decorative roles
- Fake macOS / code window chrome; traffic lights + toy SDK
- Purple / blue-purple gradients; gradient text; candy pastel aurora blobs
- Three-tier pricing with MOST POPULAR glow middle
- Prefab testimonial with fake evidence
- Gradient-circle initials avatar; pre-footer gradient CTA slab
- Generic gradient-squircle logo lockup
- Split hero skeleton recycled across brands
- Graph-paper / full-page grid background; crude CSS "illustrations"
- Accent-bar / side-stripe cards
- Floating tag on image; countdown timer urgency kit
- Letterspaced serif luxury wordmark by default
- Mono as house voice for non-data copy
- One tracked-caps treatment on every small role
- Sun-moon theme toggle pill; underline-fill hover on links
- Dot under active nav; eyebrow tick beside label
- Metadata as tinted chips everywhere
- Default all-around soft shadow; faked shadow via offset box
- Oversized footer wordmark without composition craft

### Fonts called out by pols

Work Sans, Sora, Syne, Archivo, Cormorant*, Bodoni/Didot autopilot, JetBrains Mono
as code theater, and reputation-driven "tasteful" swaps are review leads when
chosen without product/type reasoning. Existing project typography or explicit
brand direction has authority.

---

## Layout skeletons (recoloring is still slop)

1. Default hero stack (kicker+H1+sub+dual CTA) +/- right panel
2. Whole SaaS product page meta-template: split hero -> 3 feature cards -> tabs ->
   3 pricing -> FAQ -> gradient CTA slab -> multi-col footer
3. Kicker-plus-H2 on every section
4. Big serif statement with one italic accent word as philosophy beat
5. Inset enquire island + pill email form as every closing
6. Image card + bottom scrim caption + arrow, always
7. Flat fill under everything after a strong hero (atmosphere dies at fold)
8. Numbered steps on a vertical rail
9. Multi-line stacked headlines with dangling accent word
10. Stacking several of the above on one page without product reason

If the last project and this one share the same five section shapes, check whether
you reskinned a theme instead of designing from product structure.

---

## Deeper tell

Avoiding every bullet without inventing anything is still slop. No icons at all
can be over-correction. Same skeleton recolored is still the skeleton. A checklist
makes work less wrong; only a point of view makes it good.

---

## Premium craft (positive)

Use only when supported by the selected direction:

- Real translucency over a backdrop worth refracting; tonal elevation
- Bespoke geometry instead of default rectangles
- Bare or custom house iconography when icons matter
- Authored micro-interactions and considered directional light
- Controlled texture behind content
- Scroll-authored motion that does not hide content
- Oversized footer wordmark only when composed deliberately
- Purpose-fit signature type, licensed/self-hosted where required
- Full-page composition and honest logo/product evidence
- Inset island sections when the structure benefits from them
- Professional with a heartbeat: a coherent system plus a few authored moments

---

## Signature formula (uniqueness)

1. **One signature artifact** - high-effort focal that cannot paste into another site
2. **Atmosphere** - environment, not arbitrary flat fill under the whole scroll
3. **Layered depth** - foreground, middle ground, background when the direction calls for depth
4. **Product as populated artifact** - real UI content, not empty chrome
5. Clean is the floor; empty restraint is unfinished when the brief requires identity

---

## Core Web Vitals

Use current repository/performance requirements as authority. Historical targets
such as LCP < 2.5 s, INP < 200 ms, and CLS < 0.1 are useful reference values only
when they match the active performance standard.

---

## Integration with design-with-ai

- Applicability and gate IDs: `anti-slop-gates.md`
- Structure: `macrostructures.md` + `pattern-vocabulary.md`
- Colour/type: `color-strategy.md`
- Motion safety: visible-by-default + `motion-opportunities` + `opportunities.md`
- Final quality stack: `quality-stack.md` + `verification-contract.md`
- Full forensic source: https://pols.dev/slop.md

Adapted from [pols.dev/slop.md](https://pols.dev/slop.md) for agent progressive disclosure, 2026-07-15. External guidance is contextualised by the local design-with-ai contract.
