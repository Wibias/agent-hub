# Dense desktop monitoring and process utilities (conditional)

Load this reference when the resolved UI is a **desktop-window monitor or operator utility** with real-time telemetry, charts, a process/record table, an inspector, and/or potentially destructive process actions. This includes a native Windows application and an Electron/Tauri/webview desktop shell. It is not a generic rule for every dashboard, browser popup, or landing page. Use `utility-surfaces.md` for genuinely compact browser-hosted utilities; **do not misclassify a full monitoring window as disposable dashboard cosplay**. Authentic metrics and dense tables may be the primary product.

This extends the existing `baseline-ui.md` task-first and `verification-contract.md` gates; it is not a second design owner, new mechanical slop score, or evidence of actual runtime behavior. Keep explicit project authority, functional contracts, authentic numbers and OS behavior.

## Task and state first

Identify the primary user jobs: understand current pressure, identify the responsible process, inspect history, and (if actually authorized) act safely. Separate system-total metrics from process-specific fields, chart metric selection from table metric selection, and a selected process from the overall process watch count.

Capture **specific** application version/window size, OS display scale (100%, 125%, 150% where available), locale and units, current measurement interval, relevant process counts and list-selection state. Avoid assuming CSS-pixel measurements represent physical pixels on native Windows; record whichever coordinate system the host reports.

## Dense-window fit review: inspect before polish

For the **actual rendered client area**, inventory header/titlebar, KPI summary strip, trend graph, control/filter bars, process table, detail pane, actions, and status footer. Record effective available width and height. A nominal window dimension is not proof all rows or controls are visible.

1. **KPI vertical fit**: label, large number, units and supporting explanation all need a stable baseline and enough vertical room. Inspect bottom clipping, overflow beyond metric-group boundaries, overlap with dividers, and wraps in longer strings. In compact windows, a section separator can visibly intersect the second supporting line even when the text is technically inside its metric cell. Do not reduce essential type size to conceal a height deficit.
2. **Table column budget**: inspect header *and* representative cell content for each column at the same width. Find truncated, ambiguous headers, near-zero padding, misaligned numeric columns, and unused space beside constrained text. Allocate widths by content and task priority; permit appropriate resize, scrolling, ellipsis with accessible full-value disclosure, or fewer secondary columns. A huge empty column does not justify truncating the adjacent primary header.
3. **Vertical workspace budget**: at normal window height, measure visible populated rows versus available space, minimum usable scroll area, chart height, empty-detail height and footer/actions. Do not reserve a dominant fixed-height inspector for `No process selected` when the process list is squeezed. Collapsing the *empty* inspector is acceptable if selecting a process re-opens useful inspection and keyboard focus remains stable.
4. **Control identity and hierarchy**: two strips with the same RAM/CPU/GPU/NET/DISK labels may serve distinct scopes, such as system chart vs process ranking. Make those scopes discoverable through group labels, proximity or an intentional control style difference. Do not delete a distinct function just to reduce duplicate-looking controls; verify what each actually changes.
5. **Table and graph honesty**: a flat line at 0% is not equivalent to absent samples, disconnected telemetry, a stale reading or an unavailable engine. Check timestamp/window alignment, empty sampling periods, interpolation policy, sampling cadence, live status, units, decimal conventions and accessible text alternatives. Never fill missing history with fabricated zeroes.
6. **Action prerequisites**: for `Force close`, terminate, release, reset, or other consequential actions, test no selection, stale selection, protected item, busy state and successful/failed execution. The destructive action must not execute without its real target, and should disclose scope/consequence. A screenshot that *looks* enabled is a REVIEW lead, not proof the handler is enabled or unsafe. Verify keyboard and mouse behavior plus actual disabled/confirmation semantics before a functional PASS.
7. **Typography and contrast**: assess the smallest essential labels, supplemental numerical data, subdued text and state colours at normal scale. Dense does not excuse unreadable 10 px text or near-invisible secondary values. Use tabular numerals where values change; reserve bright/neon accents for meaningful state or selection.
8. **Host and edge cases**: inspect minimum supported window size, normal/maximized modes, 100/125/150% DPI where feasible, German and English text lengths, a long process name, high CPU/GPU values, no process selected, empty table, permission-denied/terminated target, and live updates while scrolling. Do not invent supported behaviors; mark unavailable environments `NOT_VERIFIED`.

## Mandatory visual-defect detection and repair loop

Before introducing another feature or accepting a polished-looking screenshot,
inspect **the actual latest native client pixels** at the supported compact
size. An attached user screenshot is a valid lead: inspect it directly rather
than dismissing the report because full UI Automation or DPI capture is
unavailable. Review both the entire window and legible crops for:

- The last rendered KPI supporting glyphs versus the visible lower divider:
  detect cramped or touching text even if the KPI cell itself is not clipped.
  The six-DIP `KPI_BOTTOM_CLEARANCE` measurement is mechanical only when
  real glyph and divider rectangles are known. Without such bounds, record
  **qualitative visual crowding** in
  `renderInspection.kpiBottomCrowding` or
  `currentVisualObservations[].issueCode: "KPI_BOTTOM_CROWDING"`;
  never invent the exact pixel gap.
- Placeholder and entered-text **vertical centering inside each visible
  search/filter input**, not just alignment of the input rectangle with its
  neighboring dropdown. Inspect text top/bottom breathing room and focus
  state. Record `renderInspection.misalignedInputText` or
  `currentVisualObservations[].issueCode: "INPUT_TEXT_VERTICAL_ALIGNMENT"`.
  If exact rendered glyph rectangles exist, `captures[].textInputs[]` may
  provide `{ id, field: [x,y,w,h], text: [x,y,w,h] }` for the
  conditional geometric check; UIA control bounds alone are insufficient.

When the agent **actually observes** either problem, reuse the historical
finding ID for the same original symptom, or create one stable new ID for
the distinct defect, preserving original acceptance text. Record in the
receipt's `currentVisualObservations[]`:
`{ findingId, observed: true, reportedBy: "USER"|"AGENT",
method: "SCREENSHOT_REVIEW"|"LIVE_RENDER"|"MEASUREMENT"|"RUNTIME",
evidenceRef, viewportId: "COMPACT", issueCode }`.
`SCREENSHOT_REVIEW` means that the agent reviewed pixels, not that exact
glyph geometry was measured. Uninspected reports remain `UNVERIFIED`.
Once a current visual defect is confirmed, do **not** mark that defect
`UNVERIFIED` or `DEFERRED` just because other viewports are missing.
Use `PERSISTS` or `REGRESSED` until fixed; `IMPROVED_BUT_OPEN` needs
actual evidence of an improvement and the remaining issue.

On an authorized general `IMPROVE` run, repair an observed HIGH/MEDIUM
defect or an explicitly user-observed defect **now**, even on the first
observed run. Inspect the relevant WinForms paint/layout code, make the
smallest targeted source repair, build/test, and rerender the exact same
compact dimensions/state. Repeat if still visible. Record the actual
`persistentRepairActions[]` SOURCE_REPAIR with distinct before/after
evidence and a truthful renderResult, or a real BLOCKED reason/nextStep.
If a new defect is discovered and repaired during this iteration, include
its new stable ID in `changeSummary.addressedFindingIds` and persist
it in the canonical ledger. This does not authorize installing app-side
test exporters: inspection remains external-first.

If a real observation shows a defect, a valid `PARTIAL` report is **not**
permission to choose unrelated cosmetic/features over that repair. Final
`COMPLETE` still requires the full multi-viewport/DPI and interaction
evidence; a one-viewport repair may truthfully remain `PARTIAL`.

## Visual restraint, not anti-dashboard prejudice

Keep meaningful numeric comparisons, dark surfaces when product/host context supports them, gridlines where they help trends, a selected metric accent, and real warning/status colours. Challenge only unearned uniform header casing, gratuitous neon outlines, redundant segmented chrome, equal-weight metric styling for unequal consequences, and repeated containment that masks the task. Use visual hierarchy and spacing before adding more decorative surfaces.

A full native process monitor legitimately needs telemetry and a table. `G74` is a contextual compact-utility anti-cosplay gate, not a mandate to remove real desktop monitoring controls.

## Current-candidate render evidence is mandatory for COMPLETE

For a full desktop/process monitor, put `surfaceKind:
"DENSE_DESKTOP_MONITOR"` in the existing DWA iteration receipt. The
normal durable findings ledger is still authoritative; do not build a second
findings store. For a `COMPLETE` verdict, supply a **schemaVersion 2**
render-evidence JSON file to `run-iteration-gate.mjs --render-evidence`.
Legacy version-1 manifests remain readable as PARTIAL evidence but cannot
certify COMPLETE for a dense monitoring window.
Ordinary non-desktop work is unchanged. A truthful `PARTIAL` can omit a
blocked native capture **only if the render gate is not reported PASS**.
If the agent claims `gates.render: "PASS"` in ANY dense desktop receipt,
even PARTIAL, it must provide current `--render-evidence` schemaVersion 2
with at least an actual `COMPACT:IDLE` capture and the measured KPI
supporting-text/divider geometry. The gate rejects a PASS when the measured
bottom gap is below six DPI-scaled pixels. No full four-window matrix or
DPI switch is required for a **scoped PARTIAL KPI smoke check**.
If a capture cannot be obtained, set `gates.render: "NOT_VERIFIED"`,
retain an open KPI finding and state what blocked the render; never
describe the result as visually verified. For a detected short gap, set
`gates.render: "REVISE"`, link the measured regression to an open
finding, **fix the WinForms KPI strip height/bottom padding** and
repeat COMPACT:IDLE inspection on the updated executable.

**Code-first repair loop for recurring measured KPI failures:** inspect
the actual WinForms source defining the KPI strip's bottom divider, supporting
text baseline and height; make a targeted height/padding source change that
preserves legibility and the process-table budget; build/tests; rerender at
the **same compact client dimensions**. If still cramped, keep the original
finding open and iterate on the actual code rather than writing another
observation-only PARTIAL receipt. If the source cannot be edited with
available authorization, name the real blocker, not an invented code fix.
This also applies when the historical finding says IMPROVED_BUT_OPEN: if the
current compact render still fails, identify the observation with current
`reassessment.observed`, a RENDER or MEASUREMENT method and an
evidenceRef. Do not bypass repair by endlessly relabeling the same error.
If no current captured view confirms the failure and required multi-viewport
evidence is missing, use UNVERIFIED instead. Do not relabel an actually
observed compact defect UNVERIFIED just because other viewports are missing.
Older HIGH/MEDIUM findings remain priority items even when UNVERIFIED or
DEFERRED: inspect the missing evidence before unrelated new features or
cosmetic work, or include an evidence-grounded `priorityDeferrals[]`
exception for actual user scope, dependency or blocker. Do not infer a
source repair from an unobserved issue.
This workflow is automatic; it must not require a longer user prompt.

For a scoped PARTIAL render packet, include only actual captured viewports,
actual tested runtime checks and findings actually inspected. Do not fake
keyboard, DPI or destructive action checks merely to supply a compact
KPI measurement. Full checks remain mandatory for COMPLETE.

**The agent creates this evidence automatically**, not the user. Keep the
manifest beside its **final PNG screenshots** in an authorized
task-artifacts directory.

**External-first native inspection (no product instrumentation by default):**
For a task that asks to *verify*, *measure*, or *finish QA* of an existing
Windows desktop UI, the target application is **read-only**. The agent must
collect evidence from **outside** the application using its authorized
computer-use environment. The bundled read-only helper
`scripts/capture-native-window.ps1 -TargetPid <pid> -OutputDirectory <artifacts>`
collects a real client PNG, SHA-256, window DPI and exposed UIA rectangles;
its JSON is explicitly **RAW_NOT_CERTIFIED**, not schema v2. The agent runs
it at each actually supported window size and state, reviews its pixels,
and constructs the v2 evidence only from independently grounded fields.
Other authorized tools may provide equivalent measurements via PowerShell/.NET
UI Automation plus Win32 window/client rectangles, GetDpiForWindow and real
screen capture), or an equivalent existing inspection tool. It must run the
harness itself, rather than asking the user to install an app-specific
exporter. Locate the running process and HWND, capture the actual client
area and its physical pixel dimensions, enumerate whatever UIA control
bounds are exposed, and derive visual observations from the actual pixels.
Capture supported window sizes/states, restoring the user's original
window state afterwards. Sample/interval metadata must come from actual
observable runtime data or already existing read-only model/log evidence.

Do **not** modify Program.cs, MainForm.cs, the project file, deployment
artifacts, or launch flags to add `--render-evidence` merely to satisfy
DWA verification. The flag `--render-evidence` belongs to the **external
DWA gate**, not to the PCGuardian executable. Product source changes
are justified separately for an *observed product defect* during an
authorized improvement task, not for missing test instrumentation.
Never claim an external harness measured text-glyph rectangles, chart
history or a changed DPI unless it truly did.

**UIPI and custom drawing:** An elevated target may deny UI Automation
to a non-elevated tester. When authorized, run the external harness at
the **same integrity level** as the target with normal user consent;
do not disable UAC, change the app's elevation, bypass Windows security
or inject code. If UIA omits custom-drawn text, try independent screenshot
inspection and available read-only APIs, but distinguish measured geometry
from image-based estimates. A screenshot alone cannot substitute for
required exact `supportingText` bounds in schema v2. When safe access
or reliable measurements are unavailable, record the precise blocker
and missing fields, keep `PARTIAL`/`NOT_VERIFIED`, and retain the original
finding IDs. Do not create more product UI changes as a workaround.

Version 2 checks their actual pixel dimensions
against the declared captured window size. No resizing an old screenshot
to invent a new profile. Do not place it in the installed skill folder.
Capture a **native window matrix**, not one flattering screenshot:
`COMPACT`, `MEDIUM`, `MAXIMIZED` at three meaningfully distinct actual
window widths, plus `SCALED` at a **different Windows DPI percentage**.
The matrix uses `viewports[]` with stable IDs, physical pixel width/height,
`dpiPercent` and `mode: WINDOWED|MAXIMIZED`. Do not hardcode 1161,
1440 or 1919 px as universal breakpoints: choose supported sizes and
state the tested bounds. For each ordinary size, capture the **same**
`IDLE`, `SELECTED`, `FOCUS` and `COLLECTING` states. At scaled DPI,
capture at least `IDLE` and `FOCUS`. Capture `STALLED` in one normal
viewport when supported; exclude only that state with an explicit, truthful
reason when not applicable. No silently inferred states or fake DPI changes.

Each `captures[]` entry carries its `viewportId` and measured
`chartPanels[]`: one `SYSTEM` plot, and a separate `DETAIL` plot when
selected. The `renderInspection` record must explicitly inspect duplicated
charts/repeated `NOW` markers, anomalous white/high-contrast table headers,
clipped supporting copy and unusable blank space, with a real render/screenshot
review reference. A structural duplicate or overlap is a mechanical HOLD.
An anomaly found in the real pixels is a HOLD even if all JSON geometry fits.

**The validator does not interpret screenshot pixels.** Hashes, PNG dimensions,
measured rectangles and self-reported reviews cannot prove an agent actually
looked at the UI. Do not mark falsely clean inspections. Use a real app render,
native UI-tree measurements, and optionally independent visual review.
If Computer Use or an elevated process blocks a required state, keep
`PARTIAL/NOT_VERIFIED`; do not extend the prompt or invent evidence.

 Attach observed window width/height/DPI for each screenshot, measured
KPI text/cell rectangles, the actual `kpiStrip.rect` and
`kpiStrip.bottomDividerY` and each KPI item's `supportingText` bounds,
plus table-header text/cell rectangles. Check the measured clearance between
the last supporting glyph and the bottom separator in every viewport:
version-2 desktop evidence uses a contextual minimum of 6 device-independent
pixels (scaled by DPI). A line touching or crossing the separator is a HOLD,
even if the KPI's general cell rectangle says the text fits. If the native
render/UI-tree cannot supply these measurements, retain PARTIAL instead of
writing invented rectangles. Also record the process
table's visible/total row counts and rectangle, inspector rectangle and empty
state, and applicable live chart sample count/collection interval/axis
history. Rectangle values use `[x, y, width, height]` **in the captured
window's coordinate system**, not inferred CSS units. Do not fabricate
rectangles when Windows accessibility/UI-tree or actual render measurement
is unavailable: record `NOT_VERIFIED` and retain `PARTIAL`.

**Reopen historical findings automatically when the final measured layout
regresses.** Before reporting a zero-open-findings state, review every
previously closed in-scope VISUAL/DETAIL finding against the latest
COMPACT, MEDIUM and MAXIMIZED renders in the affected state (especially
SELECTED with inspector open). A prior `RESOLVED` does not survive a
new counterexample. A dense desktop receipt may remain `PARTIAL`,
but must mark an unproven visual closure `UNVERIFIED` and carry its
ID forward. `findings-ledger.mjs sync` refuses a visual closure without
matching native render evidence; supply `--render-evidence` to the
existing sync command when verifying a closure. New regression status
must be `REGRESSED` or `IMPROVED_BUT_OPEN`, not silently `RESOLVED`.

The `schemaVersion 2` evidence can now include **only the states and
viewports actually captured for a PARTIAL run**. Never invent missing
screenshots or DPI data just to satisfy the complete matrix. A partial
capture with fewer than three fully visible process rows among 10+
processes must use `measuredFindingRefs.TABLE_CRAMPED` to link the
measurement to a current open finding and its viewport review.
The same applies to `KPI_BOTTOM_CLEARANCE`,
`KPI_SUPPORTING_TEXT_OVERFLOW`,
`EMPTY_INSPECTOR_DOMINATES_TABLE`, and
`SELECTED_INSPECTOR_EMPTY`. Unlinked measured regressions invalidate
the receipt, even if it says PARTIAL. Check the full executable path
in selected-process inspector views: a genuinely clipped or unreadable
path uses `renderInspection.unreadableInspectorPath` and is a new
or reopened finding; natural wrapping with a working full-path copy
is not necessarily a defect.

**Verification-only iterations must record newly observed issues too.**
After every real render, check the same layout states for anomalies such
as an unexpected white table-header rectangle, duplicated graphs,
clipped text or a misleading empty state. A positive
`renderInspection.unexpectedHeaderFill` or another anomaly flag
must have a `renderInspection.findingRefs.<flag>` pointing to a
stable open finding in the **current receipt** with route, priority,
symptom, acceptance and real screenshot reference. Record the
corresponding open `findingViewportReviews[]` status.
The existing `findings-ledger.mjs sync` writes the new immutable
FOUND and REVIEWED events into the **same** ledger. Do not reset the
frozen pre-edit baseline just because a defect was discovered later.
A positive anomaly without a matching open finding blocks the gate.
If a white rectangle could be a scrollbar rather than a broken
header, keep the underlying cause uncertain in the finding.

For any finding declared `RESOLVED`, record `findingViewportReviews[]`
for `COMPACT`, `MEDIUM`, and `MAXIMIZED` with matching final evidence.
A finding resolved at 1919 px is not resolved at 1161 px by implication.
`NOT_APPLICABLE` needs a real viewport-specific reason; an
`IMPROVED_BUT_OPEN`, `PERSISTS`, or `NOT_VERIFIED` row is not a resolution.
This is a proof overlay on the existing durable findings ledger, **not**
a second ledger.

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
claimed axis history exceeds observed samples, a large selected/empty
inspector leaves at most two visible rows among ten or more processes,
or a required compact/medium/maximized/focus/collecting capture is missing.
In v2, fewer than three fully visible rows when ten or more processes exist
is a hold in any required normal window state.
Those thresholds are conditional failure evidence, not a universal
aesthetic rule or an instruction to remove useful process details.

Native projects without Git can still produce a bounded source fingerprint.
Use the actual native project folder, not a separate scratch working directory.
The gate **automatically discovers** a Gitless C# source root when the
receipt and canonical findings-ledger are under the same product-local
`.design-with-ai` directory and the product root contains a real
`.csproj`. It never searches upward by guessing the product name or
modifies a broken ancestor `.git`. This is bounded source hashing, not
runtime/screenshot authentication. The proof records
`sourceRootMode: AUTO_NATIVE` and its source hash; `--check-proof`
independently rechecks the same source. Missing identity stays PARTIAL
unless the required evidence can be established. `--source-root`
remains an explicit fallback for nonstandard layouts.

For an optional independent source-only inspection, the explicit flag remains available:

```powershell
node "$HOME/.agents/skills/design-with-ai/scripts/project-source-snapshot.mjs" --source-root "<PCGuardian-project-dir>"
```

Run the normal iteration proof with `--receipt`, `--baseline`,
`--ledger` and `--render-evidence <final-render.json>`; automatic root
detection uses those project-local artifacts and a real C# project marker.
Repeat the same flags with `--check-proof`. Do not ask the user for a
longer prompt or manual `--source-root` when the source is discoverable.
For a noncanonical layout, add an explicit `--source-root` instead. The gate checks the real screenshot file bytes,
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
