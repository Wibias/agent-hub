# Rendered anti-slop evidence

Use this only when the target is a rendered web surface and the active browser
tool can execute read-only JavaScript in page context. It augments screenshots;
it does not replace visual judgement.

The static `taste-gate` sees source tokens. This pass measures rendered
structure that source grep cannot reliably establish: viewport-scale hero
composition, repeated equal-size groups, nested containment, repeated tracked
kickers/numbered meta, and competing title hierarchy.

## Capture

1. Navigate to the exact route/state being reviewed.
2. Set the representative viewport.
3. Confirm the page is settled and current.
4. Read `scripts/render-snapshot.js` and execute its full contents as one
   read-only page evaluation.
5. Save the returned JSON outside the product source tree, preferably under the
   OS temp directory.
6. Run:

```shell
node <skill-base-dir>/scripts/render-taste-gate.mjs --snapshot "<snapshot.json>" --json
```

Repeat for the representative desktop/mobile state when the workflow requires
both.

Do not inject attributes, mutate DOM, or ship the collector in the application.
If the browser cannot execute read-only JavaScript, skip this mechanical assist
and continue with screenshot/live-render review; label DOM-derived claims
`not measured`.

## What the detector may report

- **G03**: a viewport-scale centered hero with kicker and CTA evidence.
- **G04**: a rendered group of exactly three equal-size, structurally repeated
  children.
- **G05**: repeated card-like containment nested inside card-like containment.
- **G30**: bordered card-like surfaces also use large soft shadows at meaningful
  density, suggesting two elevation languages may be competing.
- **G31**: large radius values dominate a sufficiently large set of rendered
  card-like surfaces.
- **G55**: most gaps between a sufficiently long run of top-level sections fall
  into the same narrow spacing band, suggesting flat section rhythm.
- **G64**: several non-interactive icons sit inside small rounded surfaced
  containers. Interactive icon buttons/links are excluded from this mechanical
  lead.
- **G72**: icons appear across most card-like content blocks at meaningful
  density.
- **G07**: a wide top navigation presents several plain actions plus one filled
  CTA, matching a common marketing-shell pattern.
- **G08**: a footer resolves into a 3-5 column repeated link directory.
- **G65**: filled-primary plus outlined-secondary action pairs repeat across
  multiple rendered sections. A single intentional action pair does not trigger
  this mechanical lead.
- **G66**: one fully overloaded card, or repeated cards with four or more
  independent adornment roles, accumulates iconography, multiple pills/tags,
  pricing, status, and actions without a clear hierarchy.
- **G63**: a rendered marketing page combines a centered hero, an equal-three
  repeated section, pricing evidence, FAQ evidence, and a closing action zone.
  This is a strong meta-template lead, not an automatic failure.
- **G27/G28**: repeated tracked-uppercase kickers or numbered meta across
  sections. Numbering inside a real `<ol>` is excluded from the mechanical
  numbered-meta lead.
- **G71**: two large first-viewport headings with near-equal font size.

These are contextual leads, not automatic failures. The script emits
`REVIEW_RENDER` or `REVIEW_RENDER_CLUSTER`, never `HOLD`.

## Adjudication

For every lead, check:

1. **Purpose**: does the treatment encode a real task, sequence, hierarchy, or
   brand rule?
2. **Surface role**: is a marketing composition leaking into an authenticated
   workspace/dashboard, or is the surface actually marketing?
3. **Independence**: are multiple families separate design decisions, or one
   motif being counted repeatedly?
4. **Rendered truth**: does the screenshot/live render actually exhibit the
   problem the geometry suggests?
5. **Authority**: is there explicit project/user/reference intent that
   authorizes the treatment?
6. **System versus decoration**: for G30/G31/G64/G72, distinguish an owned
   elevation, radius, or icon language from repeated chrome added merely to make
   blocks feel designed. A documented card/elevation system, soft/rounded product
   system, or meaningful icon grammar can justify the same measured geometry.
7. **Rhythm versus sameness**: for G55, check whether repeated section spacing
   follows content relationships, page grammar, or a deliberate editorial cadence.
   Consistent tokens are not a failure; the lead matters when every section is
   treated as the same kind of block regardless of hierarchy.
7. **Information architecture versus shell reflex**: for G07/G08, inspect whether
   the actual navigation and footer content genuinely needs the measured shape.
   Familiar nav/footer geometry is not a failure when it follows real IA.
8. **Action hierarchy versus CTA reflex**: for G65, verify whether each repeated
   primary/secondary pair represents two real choices with stable hierarchy.
   One hero pair or one confirmation pair is not evidence of repetition.
9. **Product story versus SaaS sequence**: for G63, verify whether pricing, FAQ,
   feature repetition, and the closing action are each required by the actual
   product story. A real commercial landing page may legitimately contain all of
   them; the failure is inheriting the whole sequence without product reasoning.
10. **Card job versus ornament inventory**: for G66, list the card's real jobs
    before removing anything. Price, status, action, icon, and tags can all be
    legitimate in an operations or subscription card when each serves a distinct
    task. The lead matters when several facets are decorative, duplicate nearby
    information, or obscure the card's primary scan/action path.

A cluster is stronger evidence that defaults were left unexamined, not evidence
that AI authored the page. Rendered elevation/rhythm, radius/icon, card-composition,
shell-pattern, and marketing meta-template thresholds are local review heuristics,
not universal style, density, spacing, information-architecture, or landing-page
limits.

## Calibration contract

Rendered thresholds are local heuristics and must stay regression-calibrated.

- `tests/render-calibration-cases.jsonl` is the canonical threshold matrix.
- Every active `renderRules` ID must have at least one positive fixture and at
  least one explicit boundary-negative fixture.
- Changing a rendered threshold, weight, family, or trigger shape requires
  updating the relevant calibration fixture with a concrete reason; do not
  loosen or tighten a threshold from one anecdotal false positive.
- Adding a new rendered detector requires positive and boundary-negative
  calibration coverage before qualification.
- Calibration fixtures prove detector behavior only. They do not turn a
  contextual design heuristic into universal design truth.

## Evidence receipt

Record, per viewport:

```text
render-evidence: <route/state> <WxH>
snapshot: <path>
verdict: PASS_RENDER_EVIDENCE | REVIEW_RENDER | REVIEW_RENDER_CLUSTER
families: <names>
adjudication: <accepted contextual reasons or gate IDs requiring revision>
visual-proof: <screenshot/live browser reference>
```

Never claim a structural gate passed from the JSON alone. The final gate remains
the rendered surface plus project intent.
