# Dense desktop monitoring and process utilities (conditional)

Load this reference when the resolved UI is a **desktop-window monitor or operator utility** with real-time telemetry, charts, a process/record table, an inspector, and/or potentially destructive process actions. This includes a native Windows application and an Electron/Tauri/webview desktop shell. It is not a generic rule for every dashboard, browser popup, or landing page. Use `utility-surfaces.md` for genuinely compact browser-hosted utilities; **do not misclassify a full monitoring window as disposable dashboard cosplay**. Authentic metrics and dense tables may be the primary product.

This extends the existing `baseline-ui.md` task-first and `verification-contract.md` gates; it is not a second design owner, new mechanical slop score, or evidence of actual runtime behavior. Keep explicit project authority, functional contracts, authentic numbers and OS behavior.

## Task and state first

Identify the primary user jobs: understand current pressure, identify the responsible process, inspect history, and (if actually authorized) act safely. Separate system-total metrics from process-specific fields, chart metric selection from table metric selection, and a selected process from the overall process watch count.

Capture **specific** application version/window size, OS display scale (100%, 125%, 150% where available), locale and units, current measurement interval, relevant process counts and list-selection state. Avoid assuming CSS-pixel measurements represent physical pixels on native Windows; record whichever coordinate system the host reports.

## Dense-window fit review: inspect before polish

For the **actual rendered client area**, inventory header/titlebar, KPI summary strip, trend graph, control/filter bars, process table, detail pane, actions, and status footer. Record effective available width and height. A nominal window dimension is not proof all rows or controls are visible.

1. **KPI vertical fit**: label, large number, units and supporting explanation all need a stable baseline and enough vertical room. Inspect bottom clipping, overflow beyond metric-group boundaries, overlap with dividers, and wraps in longer strings. Do not reduce essential type size to conceal a height deficit.
2. **Table column budget**: inspect header *and* representative cell content for each column at the same width. Find truncated, ambiguous headers, near-zero padding, misaligned numeric columns, and unused space beside constrained text. Allocate widths by content and task priority; permit appropriate resize, scrolling, ellipsis with accessible full-value disclosure, or fewer secondary columns. A huge empty column does not justify truncating the adjacent primary header.
3. **Vertical workspace budget**: at normal window height, measure visible populated rows versus available space, minimum usable scroll area, chart height, empty-detail height and footer/actions. Do not reserve a dominant fixed-height inspector for `No process selected` when the process list is squeezed. Collapsing the *empty* inspector is acceptable if selecting a process re-opens useful inspection and keyboard focus remains stable.
4. **Control identity and hierarchy**: two strips with the same RAM/CPU/GPU/NET/DISK labels may serve distinct scopes, such as system chart vs process ranking. Make those scopes discoverable through group labels, proximity or an intentional control style difference. Do not delete a distinct function just to reduce duplicate-looking controls; verify what each actually changes.
5. **Table and graph honesty**: a flat line at 0% is not equivalent to absent samples, disconnected telemetry, a stale reading or an unavailable engine. Check timestamp/window alignment, empty sampling periods, interpolation policy, sampling cadence, live status, units, decimal conventions and accessible text alternatives. Never fill missing history with fabricated zeroes.
6. **Action prerequisites**: for `Force close`, terminate, release, reset, or other consequential actions, test no selection, stale selection, protected item, busy state and successful/failed execution. The destructive action must not execute without its real target, and should disclose scope/consequence. A screenshot that *looks* enabled is a REVIEW lead, not proof the handler is enabled or unsafe. Verify keyboard and mouse behavior plus actual disabled/confirmation semantics before a functional PASS.
7. **Typography and contrast**: assess the smallest essential labels, supplemental numerical data, subdued text and state colours at normal scale. Dense does not excuse unreadable 10 px text or near-invisible secondary values. Use tabular numerals where values change; reserve bright/neon accents for meaningful state or selection.
8. **Host and edge cases**: inspect minimum supported window size, normal/maximized modes, 100/125/150% DPI where feasible, German and English text lengths, a long process name, high CPU/GPU values, no process selected, empty table, permission-denied/terminated target, and live updates while scrolling. Do not invent supported behaviors; mark unavailable environments `NOT_VERIFIED`.

## Visual restraint, not anti-dashboard prejudice

Keep meaningful numeric comparisons, dark surfaces when product/host context supports them, gridlines where they help trends, a selected metric accent, and real warning/status colours. Challenge only unearned uniform header casing, gratuitous neon outlines, redundant segmented chrome, equal-weight metric styling for unequal consequences, and repeated containment that masks the task. Use visual hierarchy and spacing before adding more decorative surfaces.

A full native process monitor legitimately needs telemetry and a table. `G74` is a contextual compact-utility anti-cosplay gate, not a mandate to remove real desktop monitoring controls.

## Current-candidate render evidence is mandatory for COMPLETE

For a full desktop/process monitor, put `surfaceKind:
"DENSE_DESKTOP_MONITOR"` in the existing DWA iteration receipt. The
normal durable findings ledger is still authoritative; do not build a second
findings store. For a `COMPLETE` verdict, supply a separate version-1
render-evidence JSON file to `run-iteration-gate.mjs --render-evidence`.
Ordinary non-desktop work is unchanged; a truthful `PARTIAL` can omit a
blocked native capture.

**The agent creates this evidence automatically**, not the user. Keep the
manifest beside its final PNG/JPEG/WebP screenshots in an authorized
task-artifacts directory. Do not place it in the installed skill folder.
Capture `IDLE`, `SELECTED`, `FOCUS` and `STALLED`; only `STALLED`
may be explicitly excluded with a reason when that state truly does not
exist. Attach observed window width/height/DPI for each screenshot, measured
KPI text/cell rectangles and table-header text/cell rectangles, process
table's visible/total row counts and rectangle, inspector rectangle and empty
state, and applicable live chart sample count/collection interval/axis
history. Rectangle values use `[x, y, width, height]` **in the captured
window's coordinate system**, not inferred CSS units. Do not fabricate
rectangles when Windows accessibility/UI-tree or actual render measurement
is unavailable: record `NOT_VERIFIED` and retain `PARTIAL`.

The manifest includes `candidateSourceSha256` from the same final
project-source snapshot as the screenshot, `captures[].imageSha256`,
`capturedAt`, `reviewedFindingIds` and runtime checks. The required
`checks[]` are `NO_SELECTION_ACTION`, `SEGMENT_KEYBOARD`,
`CHART_HISTORY`, and `DPI_READABILITY`, each with `result: PASS`,
`method: TEST|RUNTIME` and an actual `evidenceRef`. These are claims
requiring inspectable external test evidence, not automatic proof of a
real interaction. A code-only audit cannot satisfy them.

A mechanical hold is justified if any measured KPI/header text rectangle
overflows its cell, absent graph samples are represented as zeroes, the
claimed axis history exceeds observed samples, or a large selected/empty
inspector leaves at most two visible rows among ten or more processes.
Those thresholds are conditional failure evidence, not a universal
aesthetic rule or an instruction to remove useful process details.

Run the read-only source snapshot from the target project's working
directory to obtain the hash:

```powershell
node "$HOME/.agents/skills/design-with-ai/scripts/project-source-snapshot.mjs"
```

Then run the existing iteration proof with its normal `--receipt`,
`--baseline` and `--ledger` flags and the additional
`--render-evidence <final-render.json>`. Repeat that same extra flag with
`--check-proof`. The gate checks the real screenshot file bytes,
manifest source identity and current C#/WinForms source. **After any final
UI edit or screenshot update, take fresh captures and create a new proof.**
An old screenshot cannot certify the latest source, and a screenshot that
was not captured is not repaired by changing JSON alone.

This checks inspectable artifact consistency, **not** that a screenshot
really came from the application. The agent/human must inspect the actual
live application and corroborate self-reported geometry, interactive
tests, sampling states and provenance. If Computer Use is unavailable,
the correct verdict is `PARTIAL` or `NOT_VERIFIED`. The source
snapshot intentionally refuses invalid Git workspace metadata; never
delete or rename an unexpected `.git` directory without owner
authorization just to obtain a pass.

## Evidence receipt and acceptance

For each major finding, record a stable ID, window/viewport dimensions and scaling, screenshot or actual UI-tree evidence source, observed symptom, affected control/column/region, consequence for the user, proposed change, matched **after** state, and `RESOLVED | IMPROVED_BUT_OPEN | PERSISTS | UNVERIFIED`. Measure or inspect rather than assert a fixed universal pixel threshold.

Hold the polished/production-grade claim if essential values clip, a required header is unreadable, important actions are undiscoverable, the primary table is unnecessarily cramped against unproductive empty space, or any destructive-action prerequisite is failed/unverified. When behavior cannot be tested, state `NOT_VERIFIED` for that behavior; do not infer it from static appearance. Real application smoke tests and render inspection remain required. A source-only or agent-written checklist is not proof of UI correctness.
