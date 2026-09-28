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
