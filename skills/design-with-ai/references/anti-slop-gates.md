# Anti-slop gates - match and refuse

Run after build or during audit. Every applicable gate must pass before the
corresponding quality claim is made.

P0 blocks ship. P1 blocks premium/polished claims. P2 is craft polish.
Mechanical assists: `scripts/taste-gate.ps1` scans source-level leads; `scripts/render-taste-gate.mjs` analyzes one read-only browser snapshot for rendered structural leads; `scripts/taste-evidence-fusion.mjs` combines source/render reports without double-counting semantic families; `scripts/compare-render-snapshots.mjs` compares in-scope route snapshots for G02 macro reuse; `scripts/taste-evidence-receipt.mjs` composes the final mechanical receipt without converting missing render evidence into a pass. Contextual outputs remain leads only; rendered UI plus project intent is truth.

## Applicability rule

Project design truth, explicit user direction, and the selected visual system
have higher authority than generic taste heuristics. A contextual visual gate
fails only when the pattern appears as an unrequested/default treatment or
contradicts the selected direction. Do not fail a design because a grep token
exists in an explicitly authorised brand system.

Truth, accessibility, broken interaction, missing focus/reduced-motion support,
and other implementation-safety failures do not get a taste override.

## Evidence and cluster rule

Contextual visual tells are evidence of an unexamined default, not proof of AI
authorship and not automatic design failure. The mechanical registry lives in
`slop-signals.json`; its evidence grades help prioritize review but do not
override project truth or rendered evidence.

The mechanical gate aggregates by semantic family:

- repeated matches inside one family do not count as independent design decisions;
- the current `REVIEW_CLUSTER` lead requires at least three independent
  contextual families and a combined score of at least five. That threshold is
  a local v1 review heuristic to calibrate, not a source-reported probability;
- repetition across multiple files may add a bounded family bonus, but raw hit
  count never multiplies a family without limit;
- `REVIEW` and `REVIEW_CLUSTER` are review leads. They do not by themselves
  block completion or justify an AI-authorship claim;
- a documented project, brand, or task decision may suppress a contextual rule
  or family when the exception names a concrete reason and scope;
- hard implementation gates such as G22 cannot be suppressed through taste
  intent;
- rendered UI remains the final evidence for hierarchy, fit, spacing, clipping,
  and whether a contextual pattern is actually unmotivated.

G67 also covers the emerging cream/beige + expressive-serif + sage/forest
combination. It is a cluster lead only when at least two members co-occur without
a product-specific reason. Cream, serif type, sage, purple, gradients, cards,
rounding, or numbered labels are never banned individually.

## Source calibration contract

Source-level heuristics are regression-calibrated in
`tests/source-calibration-cases.jsonl`.

- Every active source rule entry in `slop-signals.json` must have a deterministic
  positive fixture that names that exact rule.
- Every active source/derived rule ID must have at least one explicit
  boundary-negative fixture.
- Changing a source pattern, weight, family, severity, hard-gate flag, or derived
  probe requires updating the affected calibration fixtures with a concrete
  reason; do not tune from one anecdotal false positive.
- Every `evidence.sources` ID referenced by a source, derived, rendered, or
  cross-surface rule must resolve in the registry's top-level `sources` list.
- Calibration proves detector behavior only. It does not turn contextual taste
  policy into authorship evidence or universal design truth.

## Pre-emit axes

Score 1-5: Philosophy, Hierarchy, Execution, Specificity, Restraint, Variety.
Any score below 3 requires revision before the gate. See `critique-protocol.md`.

## P0 - Structural and identity blockers

| # | Gate | Fail if | Fix |
|---|---|---|---|
| G01 | Template skeleton | Hero -> 3 equal features -> CTA -> footer is used as an unearned default with no structural identity | Change macrostructure; break equal cards |
| G02 | Macro reuse | Same macro stamp as the last build is reused without a product or user reason | Pick a different structure |
| G03 | Centered mega-hero | `100vh` centered eyebrow + title + lede + CTA stack is used by reflex and the selected direction does not call for it | Use content-height hierarchy, asymmetry, or a justified genre-specific treatment |
| G04 | 3-equal cards | Icon/title/blurb x3 appears as generic equal cards without a product reason | Zig-zag, bento spans, stack, asymmetric grouping, or another justified structure |
| G05 | Nested cards | Card-inside-card containment is decorative rather than structural | Use one containment layer |
| G06 | Side-stripe | Thick accent side border is generic decoration rather than an intentional system motif | Use hairline, tint, number, or a justified motif |
| G07 | AI nav | Generic wordmark + 4-5 links + right CTA + hairline is used without product/navigation reasoning | Pick a navigation model that follows the product |
| G08 | AI footer | Generic Product/Company/Resources/Legal four-column footer is used without information-architecture reason | Use a footer model that follows the actual content |
| G09 | Invented metrics | Stats, testimonials, or logos are presented as factual without a source | Use real data, honest placeholder treatment, or remove |
| G10 | Fake chrome | Hand-drawn browser/phone/IDE frame is presented as product evidence | Use real screenshot/capture or bare content |
| G11 | Category reflex | Visual system is guessable from industry stereotype rather than product-specific reasoning | Rework material, structure, or identity from second-order product cues |

## P0 - Direction-dependent colour and type blockers

These gates are contextual. Explicit project/brand/type authority can satisfy
them. Generic model defaults cannot.

| # | Gate | Fail if | Fix |
|---|---|---|---|
| G12 | Purple gradient default | Purple-to-blue/pink gradients or gradient text are used as an unrequested generic premium treatment | Use the selected palette/material system; explicit brand direction may authorise purple |
| G13 | Generic font default | Inter/Roboto/Open Sans/Poppins/Geist/Space Grotesk/etc. are chosen by reflex instead of following project typography or an explicit direction | Use the project type system or a deliberate type decision |
| G14 | Italic display reflex | Italic display emphasis is added as a generic hero trick rather than part of the type system | Use the selected hierarchy or a justified type treatment |
| G15 | Pure extremes by reflex | `#000`/`#fff` are introduced as generic bases contrary to the selected tokens/genre | Use project tokens or the selected surface system; pure extremes are valid when intentional |
| G16 | Premium-colour monoculture | Beige/sand/brass/oxblood is used as an automatic premium-consumer recipe | Choose colour from product/brand reasoning |
| G17 | Accent flood | Accent dominates the view without a hierarchy or atmosphere reason | Retreat accent to declared roles |
| G18 | Contrast fail | Body text is below 4.5:1 or large/UI text below 3:1 where WCAG contrast applies | Correct foreground/background roles |

## P0 - Implementation safety

| # | Gate | Fail if | Fix |
|---|---|---|---|
| G19 | Horizontal scroll | Unintended horizontal overflow exists at representative widths | Fix grid/min-width/overflow ownership |
| G20 | Missing reduced motion | Non-essential movement exists without an appropriate reduced-motion path | Remove/reduce movement while preserving useful feedback |
| G21 | Layout animation | Width/height/top/left/margin/padding animation is used without an explicit workflow-specific reason | Prefer transform/opacity or justify the exception |
| G22 | transition-all | `transition: all` or equivalent broad transition is used | Declare the intended properties |
| G23 | No focus-visible | Interactive control has no visible keyboard focus treatment | Add an accessible focus-visible treatment |
| G24 | Touch targets | Touch targets are below 44 x 44 px, or dense-desktop targets below about 40 x 40 px without safe expanded hit areas | Enlarge or safely extend the hit area; never overlap adjacent targets |
| G25 | Border-width state shift | Focus/error changes border width and shifts layout | Change colour, outline, or shadow instead |

## P1 - Hierarchy, chrome, and motion

| # | Gate | Fail if | Fix |
|---|---|---|---|
| G26 | No focal point | Everything has equal visual weight | Establish one dominant element |
| G27 | Eyebrow spam | Uppercase tracked labels repeat as decoration rather than hierarchy | Reduce repetition |
| G28 | Numbered meta | `01 About` style scaffolding appears without a real sequence | Remove or attach to real sequence |
| G29 | Em-dash UI | Visible em/en dashes conflict with the active copy convention | Use the selected punctuation convention |
| G30 | Ghost card | Border plus large soft shadow creates two competing elevation languages | Choose one surface/elevation system |
| G31 | Over-round | Large card radii appear without a brand/surface-system reason | Use the project radius system |
| G32 | Hover scale spam | Uniform `scale(1.05)` repeats across many elements | Use one restrained interaction language |
| G33 | Multi-hover | Translate + scale + shadow + colour all fire on one hover without a reason | Keep one primary state change |
| G34 | Weak/incorrect UI easing | Enter motion uses sluggish ease-in or weak default ease-in-out contrary to the motion system | Use the selected motion standard, normally responsive ease-out for entry |
| G35 | Scale from zero | Ordinary UI enters from `scale(0)` | Start near final size plus opacity, or use another justified transition |
| G36 | Motion without purpose | Motion has no orientation, feedback, continuity, explanation, or budgeted-delight purpose | Remove it or attach it to a real job |
| G37 | Logo wall text | Plain text names are presented as if they were real customer logos | Use real assets or honest text treatment |
| G38 | Div fake UI | Styled divs are presented as screenshots/product evidence | Use a real capture or label the mockup honestly |
| G39 | Emoji icons | Emoji ornaments are used as generic feature icons without brand intent | Use the selected icon/type system; explicit playful brand use can be valid |
| G40 | Mixed icon sets | Multiple unrelated icon families appear on one surface without a system reason | Use one coherent family/system |

## P1 - Visual density and system coherence

| # | Gate | Fail if | Fix |
|---|---|---|---|
| G67 | Replacement-default cluster | Cream/beige surfaces, expressive serif type, sage/forest accents, or another fashionable anti-slop recipe co-occur as an unexplained replacement default | Keep only choices backed by project, brand, task, or explicit art-direction reasoning; do not replace one default recipe with another |
| G71 | Competing titles | Two or more headings in the initial viewport compete as the page title through similar size, weight, contrast, or spacing | Keep one dominant page focal and subordinate section headings |
| G72 | Icon wallpaper | Icons repeat across most content blocks, duplicate adjacent labels, or exist only to fill space | Keep icons that earn navigation, action recognition, status, or product identity |
| G73 | Palette role sprawl | Visible colours cannot be mapped to declared surface, text, border, accent, status, or data-viz roles | Inventory roles and reuse project tokens; do not impose a raw colour-count cap |

## P1 - Copy authenticity

| # | Gate | Fail if | Fix |
|---|---|---|---|
| G41 | AI clichés | Generic AI-marketing language replaces concrete product meaning | Use concrete verbs and product-specific claims |
| G42 | Placeholder brands | Placeholder names are presented as real | Use real names or honest placeholder treatment |
| G43 | Perfect fake stats | Precise stats are presented without a source | Source them, mark them as placeholder, or remove |
| G44 | Scroll cues | Decorative scroll instructions/chevrons add no real navigation value | Remove or replace with real affordance |
| G45 | Decorative status dots | Live/online status decoration is not backed by real state | Remove or connect to real status |

## P2 - Craft polish

| # | Gate | Fail if | Fix |
|---|---|---|---|
| G46 | Orphan lines | Text wrapping creates avoidable single-word or awkward last lines | Use appropriate wrapping/measure |
| G47 | Measure fail | Prose measure is materially too short/long for the content | Adjust the reading column |
| G48 | Magic spacing | Local spacing values ignore the project spacing system without reason | Use tokens or document the exception |
| G49 | Nested radius mismatch | Closely nested surfaces use visibly conflicting radius geometry | Make radii concentric where applicable |
| G50 | Optical alignment | Icon/text rows are geometrically aligned but visibly off | Apply optical correction |
| G51 | Helper collapse | Error/helper text causes avoidable layout jump | Reserve suitable space or use a stable layout |
| G52 | Disabled opacity-only | Disabled state relies on opacity alone and remains ambiguous | Add semantic state, cursor/interaction treatment, and accessible attributes |
| G53 | Toast noise | Success toast repeats a result already obvious in the UI | Prefer silent or local confirmation |
| G54 | Heavy animation asset by reflex | Lottie or similar is added where a simpler owned asset would do the job | Prefer the simplest purpose-fit implementation |
| G55 | Section rhythm flat | Every section repeats the same spacing/divider pattern without hierarchy | Vary rhythm by content relationship |
| G56 | Missing signature | Surface could be swapped into unrelated products with no identity loss | Add a product-specific signature move/artifact |
| G57 | Token improvisation | Raw colour/font values appear mid-component without project or local-system reason | Promote to an owned token or documented local value |
| G58 | Direction stamp missing | Full-page work lacks a recorded `design-with-ai` direction/constraint receipt when the workflow requires one | Record the selected direction and locked constraints |

## P0 - Execution and pols.dev blockers

| # | Gate | Fail if | Fix |
|---|---|---|---|
| G59 | Invisible content | Core content starts hidden and depends on entrance JavaScript/motion to become visible, with no visible fallback | Keep content visible by default and enhance progressively |
| G60 | Clear the cut | Clip-path/overflow/notch visually cuts text or controls | Add safe spacing and inspect rendered edges |
| G61 | Ragged comparison | Comparison/pricing columns misalign key actions or equivalent rows so scanning breaks | Align the compared structure |
| G62 | Hard image seam | Full-bleed imagery ends in an accidental hard seam contrary to the selected art direction | Integrate image/surface transition intentionally |
| G63 | SaaS meta-template | Split hero + three cards + pricing + FAQ + gradient CTA appears as an unrequested generic scaffold | Change structure around the actual product story |
| G64 | Icon-in-tile reflex | Feature icons sit in generic coloured rounded tiles without system/product reason | Use the selected icon/surface language |
| G65 | Default CTA pair | Filled primary + outline secondary is repeated as a stock pattern without hierarchy reasoning | Use the action model the task requires |
| G66 | Kitchen-sink card | One card accumulates unrelated icon, pills, tags, price, status, and CTA decoration | Strip to the card's core job |
| G68 | Atmosphere dies at fold | Strong hero art direction disappears immediately and the rest of the page becomes unrelated generic fill | Carry the visual system through the page |
| G69 | No signature artifact | Surface is correct but has no product-specific visual/interaction identity | Add a justified signature artifact |
| G70 | Dead control | Element looks interactive but does nothing | Wire it or make it clearly static |

Full forensic reference: `pols-slop.md` and https://pols.dev/slop.md

## Genre overrides

- modern-minimal: white paper and zero-chroma neutrals can be intentional.
- atmospheric: larger background blooms can be intentional; judge them against the selected atmosphere and readability.
- playful: soft springs and sparse emoji can be valid when the brand commits to them.
- editorial: specimen-like type/macro treatments require a real editorial/type reason.

Overrides authorise deliberate direction. They do not waive truth,
accessibility, broken-interaction, or implementation-safety gates.

## Audit delivery format

For critique-only mode, use:

| Before | After | Why |
|---|---|---|
| current state | proposed state | gate ID and reason |

End with **SHIP** or **HOLD** and the blocking gate IDs. If a contextual gate is
authorised by project/brief direction, record that authority instead of silently
ignoring the match.
