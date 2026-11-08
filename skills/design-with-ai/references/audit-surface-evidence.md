# Audit-surface evidence and relevance

This reference owns the evidence discipline for `audit-surface`, especially the
gap between a scanner finding, a route-bound surface finding, and an accessibility
claim. It supplements `existing-ui-workflows.md`; it does not replace rendered
review, project intent, or the anti-slop gates.

## Why scanner output is not a surface audit

Static scanners answer different questions than a route review:

- a whole-tree scan reports file-level leads, then the requested route is often
  attached as a label;
- copy rules match code and internal identifiers as readily as visible text;
- text-contrast rules do not measure an empty control's boundary or fill;
- source CSS shows declarations but not the resolved cascade, the hover state,
  or the keyboard model;
- a DOM snapshot shows attributes but not whether arrow keys, Home/End, focus,
  selection, and panel changes agree.

Therefore the audit separates three things that are routinely conflated:

1. **Source scope** — which files a provider scanned.
2. **Surface binding** — which of those files can contribute to the requested
   route and state.
3. **Rendered evidence** — what the actual state measures and does.

## Surface binding and finding relevance

Before treating a provider finding as a finding on the requested surface,
classify its file and its copy visibility:

| Relation | Meaning | Route finding? |
| --- | --- | --- |
| `route-entry` | route registration or route-owned page module | yes, after rendered confirmation |
| `direct-style` | stylesheet imported by a route entry or route-owned module | yes, but shared application may affect it |
| `direct` | explicit route-owned module | yes |
| `shared` | reachable shared component, hook, or style | may affect the route; confirm the rendered state |
| `context` | elsewhere in the scan tree | no; report separately as context debt |
| `unbound` | file outside the declared source scope | never silently drop; report the binding failure |

`scripts/surface-relevance.mjs` builds a bounded static route/import closure and
annotates provider findings with `relation`, `relevance`, `visibility`,
`surfacePriority`, and the reason. `scripts/providers/quality-audit.mjs` includes
that annotation in its reports and summary. Canonical fusion keeps the original
provider `priority` as provenance and adds `surface` plus `actionablePriority` to
each member and group; a context-only P1 is therefore not an actionable route
alert for a fusion consumer.

Rules for using the annotation:

- A `context` finding is not a false positive in the product; it is a true
  observation about another surface. Keep it, label it out of scope, and do not
  count it toward route coverage or route severity.
- A `shared` finding needs rendered confirmation. Shared modal, dialog, and
  error components can appear on the route even when their source path does not
  contain a route token.
- A copy finding that is absent from the captured visible text is `not-visible`
  for that state. It can still be a real defect in a different state or route.
- Copy heuristics are review hypotheses. On the target surface they default to
  `P2` at most; outside it they are `P3` context notes. Only a measured,
  user-facing copy problem with product evidence can outrank that.
- A finding with no route closure is a binding limitation, not evidence that the
  finding is wrong.

## Evidence grades and claim calibration

Record one grade per claim:

| Grade | Use for |
| --- | --- |
| `OBSERVED` | you saw the state in a screenshot or live render |
| `MEASURED` | a value was computed from the rendered DOM/CSS, with method and state |
| `STATIC` | source or route structure establishes the fact, but not the render |
| `INFERRED` | a supported hypothesis from source, tokens, or related states |
| `NOT_MEASURED` | the surface or state was unavailable |

An accessibility statement needs three things: the measured value, the success
criterion, and the applicability decision. Otherwise write `risk`, `lead`, or
`not verified`.

Do not turn a threshold miss into an automatic WCAG violation. For non-text
contrast:

- the 3:1 threshold applies to visual information required to identify a
  control or its state;
- user-agent-rendered controls, inactive components, purely decorative marks,
  and controls identified by another sufficient cue need adjudication;
- text contrast (1.4.3) is a different criterion from non-text contrast (1.4.11);
- report the measured ratio and the exact adjacent colors; then say whether the
  boundary is the only identifying cue.

Good: “Measured 1.48:1 between the unchecked boundary and the card. That is
below the 3:1 non-text threshold; if the boundary is the only cue that identifies
the empty control, this is a likely 1.4.11 failure. Confirm no platform or icon
cue supplies the same information.”

Bad: “WCAG violation” as soon as a scanner reports a color pair.

## Required state matrix

An interactive surface is not reviewed until its meaningful states are listed
and each is either inspected or marked `NOT_MEASURED`:

| Control | States that need evidence |
| --- | --- |
| checkbox / radio / switch | unchecked, checked, focus-visible, disabled, hover |
| tab / segmented control | selected, unselected, selected+hover, focus-visible, panel change |
| select / combobox | default, open, focus-visible, disabled |
| disclosure / menu | closed, open, focus entry, Escape/focus return |
| text input | empty, filled, invalid, focus-visible, disabled |
| primary action | default, hover, pressed, focus-visible, disabled/busy |

The empty or unchecked state is often the weakest state and is the one scanners
skip. Measure it explicitly.

## Control-boundary contrast protocol

1. Capture the control's computed border width, border colors, fill, appearance,
   background image, box shadow, and dimensions in the actual state.
2. Composite translucent colors over the nearest opaque ancestor background.
3. Measure the boundary and the fill separately against that adjacent background.
4. Report the strongest available cue. A 3:1 fill and a 1.2:1 border is not a
   1.2:1 control if the fill identifies it.
5. Mark `approximate` when a gradient, image, backdrop filter, canvas, or
   cross-origin stylesheet prevents a reliable background estimate.
6. Keep the checked state out of the empty-state claim; a strong checked fill
   does not repair an invisible empty control.

`scripts/render-surface-a11y-gate.mjs` performs this measurement for custom
checkbox/radio controls and emits `A11Y-CONTROL-BOUNDARY-CONTRAST` with the
measured ratios and applicability language. It does not issue a conformance
verdict.

## ARIA widget and keyboard protocol

For a declared widget, inspect the announced model and the actual interaction
separately:

- tablist: one tab stop (roving tabindex), exactly one selected tab, unique and
  valid `aria-controls` targets, orientation matching layout, arrow/Home/End
  behaviour, Tab exits the list, and panel change is announced;
- menu/disclosure: trigger/panel relationship, focus entry and return, Escape,
  expanded state;
- combobox: input/name, expanded state, listbox relationship, active option,
  keyboard selection, Escape;
- dialog: name, description, initial focus, focus trap, Escape, return focus.

### Driven tablist evidence

The probe does not drive keys. A driven pass may attach this optional shape to
the probe JSON; the analyzer only evaluates it when `source` is `driven-pass`:

```json
{
  "source": "driven-pass",
  "before": { "active": "Interface", "selected": "Interface" },
  "afterArrow": { "active": "Streaming", "selected": "Streaming" },
  "activation": {
    "key": "Enter",
    "before": { "active": "Streaming", "selected": "Interface" },
    "after": { "active": "Streaming", "selected": "Streaming" }
  },
  "beforeTab": { "active": "Streaming", "selected": "Streaming" },
  "afterTab": { "active": "Theme", "selected": "Streaming", "inTablist": false }
}
```

Evaluate focus movement separately from activation:

- automatic activation: ArrowDown moves focus and the selected state follows it;
- manual activation: ArrowDown moves focus but selection stays, then the
  declared activation key moves selection;
- unchanged focus: ArrowDown leaves focus on the same tab; this is a failure;
- Tab exit: focus leaving the tablist is valid (`inTablist: false`); focus moving
  to another tab while a different tab stays selected is not.

Without `before` and `afterArrow`, report the keyboard model as unverified. Do
not infer activation mode from a single post-key state.

Static attributes do not prove the keyboard model. A tablist can have perfect
attributes and still fail because every tab is tabbable and ArrowDown does
nothing. Conversely, a visually unusual rail can be a correct navigation list
with `aria-current` and native links. Check the contract the interface declares.

`scripts/audit-surface-probe.js` captures tab stops, selected count,
`aria-controls` targets, orientation, layout, and focusable tab data.
`scripts/render-surface-a11y-gate.mjs` reports the static inconsistencies and
lists the interaction checks that still require a driven keyboard pass.

## State-precedence protocol

An active state must remain identifiable while hovered or focused. For each
selected/checked item:

1. Capture its default selected treatment.
2. Capture the selected+hover declaration and the neutral hover declaration.
3. If selected+hover collapses to the neutral hover treatment, flag
   `INT-STATE-IDENTITY-LOSS`.
4. Confirm in the rendered surface. A persistent weight, marker, icon, or
   underline can carry selection even when the fill changes.
5. State the impact in interaction terms; do not call it a WCAG failure unless a
   specific criterion applies.

The source-cascade check is a heuristic: `!important`, cascade layers, inline
styles, and cross-origin sheets can change the result.

## Commands

Run the provider gate with surface annotation:

```shell
node <skill-root>/scripts/providers/quality-audit.mjs \
  --profile standard --path src --project-root . --route /settings/interface
```

Re-annotate existing reports without rescanning:

```shell
node <skill-root>/scripts/surface-relevance.mjs \
  --project-root . --path src --route /settings/interface \
  --findings <run>/native-dwa.json --findings <run>/impeccable.json \
  --probe <run>/surface-probe.json --json
```

Capture the rendered probe by executing the full contents of
`scripts/audit-surface-probe.js` in the settled page, then analyze it:

```shell
node <skill-root>/scripts/render-surface-a11y-gate.mjs \
  --probe <run>/surface-probe.json --json
```

The probe is read-only. Do not inject attributes, change the DOM, or ship it in
the product.

Privacy: the probe reports `location.pathname` without query or fragment, not
`location.href`. `visibleText` is redacted and truncated to 2,000 characters;
`visibleTextMeta` records the original length, redaction count and truncation.
Treat probe JSON as private-local evidence. Do not upload or publish raw probes
before project-specific sanitization, especially for authenticated surfaces.

## Before/after comparison

Use the same product commit or tag, route, state, viewport, theme, zoom, data,
and permissions. Then report:

- relevant findings before and after, with stable IDs;
- context/out-of-route findings kept separate from route findings;
- false-positive count and the reason each was rejected;
- coverage: files in the route closure, states inspected, states not measured;
- evidence grade and measurement for each accessibility claim;
- remaining blind spots and the next check that would close each one.

Do not reward a scanner for producing more warnings. The useful metrics are
accepted route findings, rejected route findings, missed defects found by
rendered review, and the cost of adjudication.

## Remaining blind spots

- Route closure is heuristic: dynamic route construction, barrel exports,
  framework loaders, aliases, and conditional panels can be missed.
- Source CSS cannot prove the cascade in every browser or layer configuration.
- The probe cannot simulate a physical pointer, OS text scaling, screen reader,
  or real keyboard timing; those still need a driven pass.
- Gradients, images, backdrop filters, canvas, SVG controls, and cross-origin
  stylesheets limit color measurement.
- Native/OS controls and platform themes may paint affordances the DOM does not
  expose.
- WCAG applicability, exceptions, and alternative cues require human judgement.
- Static copy rules cannot tell product language from internal identifiers; the
  visible-text check is evidence, not semantic understanding.
