# Audit-surface quality: before/after on Rillmux v0.5.25

Read-only design-skill validation. No Rillmux product file, installation, skill
installation, release, or merge was changed.

## Scope

- Product: `Wibias/Rillmux` tag `v0.5.25`, HEAD `02fb51ed62b827fdb97ab6f823ac89c298f5cf6a`.
- Route: `/settings/interface`.
- Workflow: `audit-surface standard`.
- Baseline: provider reports and manual review from the earlier audit run under
  `<TEMP>/dwa-rillmux-e2e-20261108`.
- After: same product commit and route, provider reports plus a 1280x880 rendered
  probe under `<TEMP>/dwa-rillmux-after-20261108`.
- Lane: the after probe is the web/Vite render, not a new native launch. The
  measured checkbox and tab values match the earlier native WebView2 evidence.

## Why the baseline automatic check missed the real defects

The baseline provider run scanned 189 source files and attached
`/settings/interface` as a label (`routeBinding: declared-source-route`). It did
not build a route/import surface, so seven copy hits from About, Multistream,
UpdateDialog, Channel Points, and another settings tab were reported as P1 route
findings. The bundled Impeccable pass returned `PASS` and found none of the three
real defects.

The blind spots were structural, not a single missing regex:

- **Empty-control contrast** was never measured. Text-contrast checks see text,
  not the border/fill of an unchecked checkbox against the card.
- **ARIA tabs** were present in source and DOM, but the declared model was never
  compared with tab stops, `aria-controls`, orientation, arrow keys, or Tab exit.
- **State precedence** was a CSS cascade/state-combination problem. A source scan
  saw `.is-active` and `.is-active:hover` as unrelated declarations; a DOM
  snapshot saw only the default state.

The manual review found all three, but its rationale was stronger than the
evidence: “WCAG 1.4.11 territory” and “not conform” without an applicability
decision.

## What changed

- `scripts/surface-relevance.mjs` builds a bounded route/import closure and
  annotates provider findings with `ROUTE`, `SHARED`, `CONTEXT`, or `UNBOUND`,
  visible-text check, and a non-destructive `surfacePriority`.
- `quality-audit.mjs` includes that annotation in its reports and summary, and
  records `static-route-closure` instead of a bare route label when the closure
  is established.
- `scripts/audit-surface-probe.js` captures control colors, empty/checked state,
  tab stops, `aria-controls`, orientation, layout, visible text, and matched
  state rules without mutating the page.
- `scripts/render-surface-a11y-gate.mjs` measures non-text contrast, evaluates the
  tablist model with before/after keyboard evidence (automatic activation,
  manual activation, unchanged focus, separate Tab exit), and detects
  selected-hover identity loss. It emits review leads with applicability and
  claim language, never an automatic WCAG verdict.
- `fuse.mjs` keeps each provider's original `priority` and adds a bounded
  `surface` projection to every fused member and group (`relevance`,
  `actionable`, `surfacePriority`, `actionablePriority`). Context-only P1
  findings therefore remain P1 provenance but cannot be consumed as actionable
  P1 route alerts.
- The probe reports only `location.pathname`, not `location.href`; visible text
  is redacted and truncated to 2,000 characters, with redaction/truncation
  metadata. Probe JSON remains private-local evidence.
- `references/audit-surface-evidence.md` owns the route-relevance, state-matrix,
  claim-calibration, before/after, and blind-spot protocol.

## Before/after

| Dimension | Before | After |
| --- | --- | --- |
| Route binding | declared label; all 7 findings stamped `/settings/interface` | `static-route-closure`: `App.tsx`, `SettingsPage.tsx`, `SettingsPage.css`; 5 direct modules, 2 direct styles, 14 shared, 165 context |
| Provider findings | 7 P1 copy findings, all presented as route findings | 7 observations retained; 0 route-relevant, 6 context without probe, 7 context with probe; all P3 context notes |
| False positives as route findings | 7/7 | 0/7 |
| Real design defects detected automatically | 0 of 3 | 3 of 3 |
| Empty checkbox contrast | manual only; 1.48:1 border, 1.17:1 fill | measured lead, grouped over 2 empty checkboxes: 1.48:1 best cue; applicability/adjudication included |
| ARIA tabs/keyboard | manual only | static model lead plus before/after evidence: 8/8 tabbable, no vertical orientation, shared `aria-controls`; ArrowDown leaves focus and selection on Interface; Tab moves focus to unselected Streaming |
| Canonical fusion | seven P1 groups stamped to the route, no surface context | same seven P1 provider groups, each with `surface.relevance=CONTEXT`, `actionable=false`, `surfacePriority=P3`, `actionablePriority=null`; one copy lead remains ROUTE/unverified pending visible text |
| Selected-hover identity | manual only | cascade lead: `rgba(145,71,255,.22)` becomes neutral `rgba(255,255,255,.06)`; retained at P3 because weight still carries selection |
| WCAG language | “1.4.11 territory”, “not conform” | measured ratio + criterion + `appliesWhen` + `adjudication`; `claim: measured_below_threshold_not_a_conformance_finding` |

## Coverage and evidence quality

The after provider run still scans the same 189 files, but its findings are
partitioned by route relationship instead of being presented as route coverage.
The after rendered probe covers the 1280x880 state, three checkboxes (one checked
and two empty), one select, eight tabs, one tablist, and the selected-hover
combination. Its `route` is `/settings/interface`; visible text is 681 characters
with zero redactions and no truncation, but the probe still treats it as a
bounded, private-local sample rather than a transcript. It does not cover light
theme, native chrome, OS text scaling, a screen reader, or a physical keyboard.

The checkbox and tab measurements reproduce the earlier native baseline values
(`#3c3c3c` border on `#202020`, `#101010` fill, 8 tab stops, shared
`settings-panel`, neutral hover `rgba(255,255,255,.06)`). The source fingerprint
in the new provider summary differs from the old report because the scope-proof
implementation changed on the draft branch; the product HEAD and all 189 source
files are unchanged.

## Remaining blind spots

- The route closure is static and bounded. Dynamic route construction, aliases,
  barrel exports, and conditional tab panels can be misclassified. The 1
  `pendingVisibility` finding before the probe is exactly this limit.
- The probe is web-lane evidence. Native WebView2 chrome, the 38px titlebar, and
  OS-level input were not re-driven.
- Only dark theme was measured; light-theme values remain token-derived.
- Contrast for selects and other controls is captured but not promoted to a
  lead; their text/icon may already identify them.
- The cascade heuristic can miss `!important`, cascade layers, inline styles,
  cross-origin sheets, SVG/canvas controls, and backdrop filters.
- Screen-reader announcements, focus order under real assistive technology, and
  task success are outside the probe.
- Keyboard classification depends on supplied before/after evidence. A single
  post-key snapshot is not enough; a manual-activation widget also needs its
  declared activation key recorded, otherwise the analyzer reports it as
  unverified rather than passing it.
- Visible-text redaction is a bounded safety layer, not a guarantee that every
  project-specific secret pattern is removed. Keep probe JSON private-local.
- WCAG applicability and exceptions still require human adjudication; the tool
  supplies the measurement, not the conformance verdict.

## Artifacts

After-run directory: `<TEMP>/dwa-rillmux-after-20261108`

- `quality-audit-summary.json`
- `surface-probe.json`
- `surface-a11y-gate.json`
- `surface-relevance-with-probe.json`

Baseline directory: `<TEMP>/dwa-rillmux-e2e-20261108`

- `DESIGN-AUDIT-REPORT.md`
- `provider/native-dwa.json`
- `provider/impeccable.json`
- `keyboard-accessibility-1280x880.json`
- `rendered-state-calculations.json`
