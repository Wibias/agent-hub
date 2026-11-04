# Verification contract

Use before claiming a modifying `design-with-ai` workflow complete.

## Mechanical checks

Run repository-native format/lint/type/build/test gates that cover the changed
surface. Run PowerShell scripts with `pwsh`, never through Node. For the visual
quality gate, use:

```powershell
pwsh -File "$env:USERPROFILE\.agents\skills\design-with-ai\scripts\taste-gate.ps1" -Path "<files or dir>"
```

If a documented contextual-intent contract applies, pass
`-IntentPath "<intent.json>"`. Use `-Json` when the handoff needs the
family-level cluster score, suppressed contextual hits, or machine-readable
evidence.

A non-zero required gate blocks completion. Report the command and failure; do
not suppress or relabel it. `REVIEW` and `REVIEW_CLUSTER` intentionally keep
exit code zero because they require contextual and rendered adjudication.
Neither is a mechanical pass: inspect the named families against
`anti-slop-gates.md` and the rendered result before making a quality claim.

## Quality-stack evidence

For look-better and final redesign/new-surface polish, record evidence for the
applicable internal phases:

1. Direction (`taste-workflow.md`)
2. Baseline (`baseline-ui.md`)
3. Craft (`micro-craft.md`)
4. Gate (taste gate + rendered verification)

A read-only audit does not need to pretend implementation gates ran.

## Rendered verification

When suitable tooling exists, inspect representative desktop and mobile states.
Check hierarchy, overflow/clipping, interactive states, focus, contrast,
responsive transposition, and any affected loading/error/empty state. Screenshots
must correspond to the current candidate, not a stale earlier build.

For rendered web targets, when the active browser can execute read-only
JavaScript in page context, load `rendered-slop-review.md`, capture
`scripts/render-snapshot.js`, and run `scripts/render-taste-gate.mjs` against
the returned JSON for the representative viewport. This is structural evidence,
not a second source of truth: `REVIEW_RENDER` and
`REVIEW_RENDER_CLUSTER` require contextual adjudication against the actual
render, surface role, and project intent.

When both source and rendered reports exist for the same candidate, save their
JSON outputs and run `scripts/taste-evidence-fusion.mjs`. The fusion layer
deduplicates by semantic family and keeps the maximum family score across
channels; the same G31/G64/etc. family must never count twice merely because
source and render both observed it. A source `HOLD` remains blocking. Fused
`REVIEW_FUSED` / `REVIEW_FUSED_CLUSTER` remain contextual and still require
the actual render plus project intent.

For the final mechanical handoff, prefer `scripts/taste-evidence-receipt.mjs`
when a source target is available.

A single rendered candidate must declare the expected route explicitly, and the
receipt verifies that route against `snapshot.url` before fusion:

```shell
node <skill-base-dir>/scripts/taste-evidence-receipt.mjs --path "<target>" --snapshot "<snapshot.json>" --route "/settings" --json
```

A multi-route handoff uses a receipt manifest so every source target, route, and
snapshot is bound as one candidate:

```json
{
  "schemaVersion": 1,
  "candidates": [
    { "id": "home", "path": "src/routes/home.tsx", "route": "/home", "snapshot": "home.json" },
    { "id": "pricing", "path": "src/routes/pricing.tsx", "route": "/pricing", "snapshot": "pricing.json" }
  ]
}
```

```shell
node <skill-base-dir>/scripts/taste-evidence-receipt.mjs --manifest "<receipt-manifest.json>" --cross-surface-report "<cross-surface.json>" --json
```

When a cross-surface report is attached, its snapshot paths and routes must match
the route-bound rendered candidate set exactly. G02 remains a separate contextual
lane and never contributes to the fused source/render family score.

Omit rendered snapshots only when rendered DOM measurement is genuinely
unavailable. The receipt must then say `SOURCE_CLEAR_RENDER_NOT_MEASURED` or
mark render coverage `not_measured` / `partial`; this is not a visual quality
pass.

If browser JavaScript evaluation is unavailable, do not invent DOM measurements.
Continue with screenshot/live-render inspection and label DOM-derived evidence
`not measured`. The absence of this optional mechanical assist is not itself a
visual failure when equivalent rendered evidence is available.

When the active task genuinely spans two or more distinct rendered routes in the
same product, load `cross-surface-slop-review.md` after the per-route snapshots.
Run `scripts/compare-render-snapshots.mjs` only across in-scope routes at the
same viewport band. `REVIEW_CROSS_SURFACE` is a contextual G02 lead, not a
mechanical failure: shared shells and related workflow families can justify
macro similarity. Do not load or run this comparison for a single-route task.

## Before/after iteration evidence

For modifying non-motion product UI, include an issue-to-outcome ledger
as defined in `critique-protocol.md`. A release receipt must account for
each in-scope route or material component and each carried-forward issue.

```text
scope: <routes/components and priority user tasks>
baseline: <artifact/route/viewport/state or MISSING>
candidate: <artifact/route/viewport/state>
finding: <stable ID, severity, observed defect, acceptance condition>
decision: <change | KEEP | DEFER and rationale>
result: <actual visual/runtime delta with matched evidence>
disposition: RESOLVED | IMPROVED_BUT_OPEN | PERSISTS | REGRESSED | KEEP_JUSTIFIED | DEFERRED | UNVERIFIED
coverage: <inspected unchanged screens; deferred and not-inspected routes>
open carryover: <IDs, impact, next evidence/action>
iteration verdict: COMPLETE | PARTIAL | NOT_VERIFIED
```

`COMPLETE` is allowed only when required functional/visual gates pass,
material in-scope findings have evidenced resolution or a justified
no-change result, and there are no unapproved critical open issues.
`PARTIAL` acknowledges implemented progress but cannot be marketed as
a fully resolved multi-screen redesign. `NOT_VERIFIED` means required
evidence is missing; it is never a visual pass. No matched before/after
artifact means no comparative improvement claim. Baseline screenshots
cannot prove runtime behavior; verify interaction and status contracts
separately when they determine acceptance.

Keep the same route, viewport band, meaningful state, and data where
possible; when conditions differ, document the limitation. Preserve
unresolved IDs for the next iteration. A screen that did not need editing
may pass `KEEP_JUSTIFIED` after inspection; a skipped screen is not
automatically correct. This is a contextual human review, not a new
mechanical anti-slop score.

## Task-first visual receipt

For applicable operator surfaces, the handoff must include a concise
render-grounded verdict in addition to source/render taste-signal reports:

```text
first-screen job: <task or scanning question>
priority: <dominant action, record, or blocker; observed verdict>
legibility/density: <normal-zoom viewport evidence or not verified>
content/containment: <subject representation and repeated-panel rationale>
status semantics: <verified against product contracts | inconsistent | unknown>
workflow semantics: <not applicable | see workflow semantics receipt>
task-first verdict: PASS | REVISE | NOT_VERIFIED
```

`REVISE` blocks a polished/production-grade quality claim until corrected.
`NOT_VERIFIED` is not a pass and must name the missing evidence. A passing
mechanical taste scan cannot override a failed task-first verdict.
Do not claim status correctness from screenshots alone; confirm state sources
or explicitly mark this part unknown. Keep read-only audit findings separate
from claims of implemented fixes.

## Workflow semantics receipt (when applicable)

For workflow rails, status filters, staged queues, or permission-dependent
actions, record a product-state review alongside rendered evidence:

```text
semantics source: <state contracts, selectors, or test fixtures inspected>
phase vs outcome: <which values are current, historical, exclusive or overlapping>
filter selection: <what a click changes, selected-state semantics, and route>
counts: <predicate, scope, overlapping/disjoint rule, count-to-list check>
readiness and actions: <prerequisites, disabled/setup/retry behavior>
coverage: <QA passed but unauthorized; published; failed; in progress; empty filter, as applicable>
semantics verdict: PASS | REVISE | NOT_VERIFIED
```

`PASS` requires relevant product-state evidence and representative UI
interaction checks, not just visible labels. `REVISE` blocks a
production-grade claim when a filter mutates status unintentionally,
counts contradict listed items, or an action falsely appears eligible.
`NOT_VERIFIED` means the relevant state or interaction contract could
not be established; preserve that uncertainty in the final handoff.
For read-only audits, describe the mismatch but do not claim a repair.
Do not invent a canonical state machine or force a pipeline UI on products
that use independent, concurrent, or optional workflow states.

## Style allocation and independent quality receipt

For a surface where the selected visual language or a repeated motif is
material to the work, record a small render-grounded human review after
the independent functional checks. Do not add its results to the mechanical
slop score:

```text
role-to-treatment: <key role -> dominant treatment and task rationale>
motif-displacement: <before -> after; repeated motif; justified or revised>
functional-quality: PASS | REVISE | NOT_VERIFIED
visual-direction-fit: PASS | REVISE | NOT_VERIFIED
style-allocation: PASS | REVISE | NOT_VERIFIED
evidence: <current viewport/state screenshot and relevant product constraints>
```

Functional quality addresses task discoverability, legibility, state meaning,
action/recovery clarity, and responsiveness. Direction fit addresses
product/brand specificity. Style allocation addresses the distribution of
repeated treatments across materially different component jobs. Do not
collapse the three into one aesthetic score or assume their verdicts agree.

A `REVISE` in applicable functional quality or style allocation blocks a
polished/production-grade claim. `NOT_VERIFIED` must identify missing
rendered/product evidence and cannot be reported as a pass. Preserve
legitimately repeated rules, cards, and form controls with a concise task
rationale; do not create arbitrary variation to make a receipt look better.

## Motion verification

Craft changes must satisfy the active motion standards. Runtime-performance
claims require live profiling through `motion-optimize`, with the same route/state
sampled before and after. Screenshots are not runtime performance evidence.

## Release governance

For this canonical skill repository, release verification is read-only on pull
requests and on `main`. The workflow must run the deterministic source and
render calibration matrices, the receipt/fusion/cross-surface tests, Skill
Ratchet structural validation, the local PowerShell structural validator, and
generated-index freshness checks without pushing commits.

The generated-index writer is a separate workflow scoped to its maintenance
branch/manual trigger. Repository code can provide the check but cannot make it
a live branch-protection requirement by itself; before calling the repository
fully protected, verify that the `Release governance / verify` status check is
required by the live GitHub ruleset or branch protection.

## Completion

Report changed files and material checks. State blocked or unavailable evidence
plainly. Mechanical green does not convert missing rendered/runtime evidence into
a pass when that evidence is required by the active workflow.
