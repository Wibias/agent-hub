# Durable findings ledger for iterative UI

Use in modifying improve-existing, restyle-existing and redesign-existing
work. This is the persistent counterpart of the single-run receipt in
verification-contract.md.

## Source and migration

Keep .design-with-ai/findings-ledger.json in the TARGET PRODUCT REPOSITORY and
commit it with product changes. Never place project data in the installed skill.
Its schemaVersion 1 events are append-only: FOUND stores the original stable
ID, route, kind, priority, symptom, acceptance and evidenceRef; REVIEWED adds
a run ID, disposition, reason and evidence reference. A false-positive
KEEP_JUSTIFIED is retained in future inspections, not deleted.

New FOUND findings and later REVIEWED assessments in lineage-active deep
work may optionally carry `sourceDesignArtifactRef` and `designArtifactRef`
for exact design versions. These fields are append-only, nonempty when
present, and cannot rewrite previously recorded history. Older schemaVersion 1 events are unchanged.
A changed design artifact ref does not itself verify that a finding is fixed.

An empty ledger DOES NOT reconstruct prior chats, PR reviews, screenshots,
earlier findings or forgotten observations. On first adoption search available
old independent baselines, UX reports and PR notes. Import only supported
findings; say when historical coverage remains incomplete. Do not invent
past measurements or claim a new empty ledger means there were no old issues.

First use in the product repository:

    mkdir -p .design-with-ai
    node SKILL/scripts/findings-ledger.mjs init --ledger .design-with-ai/findings-ledger.json
    node SKILL/scripts/findings-ledger.mjs import --ledger .design-with-ai/findings-ledger.json --source tmp/old-prior-findings.json

On PowerShell use New-Item -ItemType Directory -Force .design-with-ai for the
directory. The import source needs findings[], each with id, route, kind,
priority, symptom, acceptance, evidenceRef. Re-importing identical IDs is
safe; conflicting ID meanings are rejected, not silently rewritten.
Future receipts must preserve each ID's original route, kind, symptom and
acceptance. The compact KPI bottom-clearance defect and the empty-filter
inspector message are different problems, never two meanings for PCG-16.
Keep the original historic ID and allocate a new unused ID for the other
observation. Do not rewrite a FOUND event or frozen baseline to hide this.

## Per-iteration procedure

1. Inspect the project's persistent ledger BEFORE editing. Re-check every
   issue on affected routes, including resolved, deferred and previously
   disproved issues. Verify routes and actual link destinations; two visible
   Settings controls need not be duplicates if their functions differ.
2. Import newly discovered PRE-EDIT issues from a reviewed findings manifest.
   Never weaken original acceptance text to fit a cosmetic change.
3. Before doing new cosmetic polish **or unrelated lower-priority repair**
   in an IMPROVE workflow, prioritize existing unresolved medium/high
   findings, including those now marked `UNVERIFIED` or `DEFERRED`.
   Missing current evidence calls for verification, not speculative source
   repair; it does not make older findings disappear from task priority.
   A truthful no-change verification run may remain PARTIAL.
   If actual user scope, a dependency or an access blocker prevents this,
   include a
   `priorityDeferrals[]` entry for each displaced finding:
   `{ findingId, basis: "EXPLICIT_USER_SCOPE" | "DEPENDENCY" | "BLOCKED",
   reason, evidenceRef, nextStep? }`. BLOCKED requires nextStep.
   Do not invent a user request or conceal an open defect. Explicit
   RESTYLE and SCOPED_COSMETIC work remain separate user intents.
4. Snapshot every in-scope historical finding and its event-prefix hash:

       node SKILL/scripts/findings-ledger.mjs snapshot --ledger .design-with-ai/findings-ledger.json --baseline tmp/prior-findings-current.json --scope /jobs,/jobs/:id,/settings --intent IMPROVE

   A unique run ID identifies this frozen baseline. Do not overwrite it.
5. Implement and verify. The receipt must include all baseline IDs and all
   new issues; mark requiresPriorBaseline and requiresFindingsLedger true.
   A previously closed VISUAL/DETAIL finding must be reopened as REGRESSED
   or UNVERIFIED if a newly measured state shows its failure condition,
   or if its final viewport evidence cannot be collected. For a dense
   desktop render, the ledger sync accepts `--render-evidence` when
   visual closures are claimed and rejects unsupported visual closure
   even if the global verdict remains PARTIAL. Do not rewrite older
   REVIEWED events; append the new run's assessment.
   New defects observed in the **final render or a verification-only turn**
   remain mandatory findings. Preserve the frozen baseline; append the
   new finding to the current receipt and use the existing sync to persist
   it as FOUND plus REVIEWED rather than rebuilding history.
   Preserve genuine blockers as PARTIAL or NOT_VERIFIED.

   **No repeated observation-only loop for confirmed defects.** When a
   medium/high VISUAL or DETAIL finding has two consecutive historically
   open assessments and is again observed as PERSISTS or REGRESSED,
   or as IMPROVED_BUT_OPEN with evidence of the still-visible defect,
   the ledger requires a persistentRepairActions[] entry for that ID:
   either SOURCE_REPAIR with an actual sourceFile, distinct beforeRef/
   afterRef and a truthful renderResult, plus TASK_REPAIR in changeSummary
   naming the original ID, or BLOCKED with a concrete blocker and nextStep.
   Re-running a gate or giving a new ID to the same defect is not a fix.
   For a repeatedly open IMPROVED_BUT_OPEN finding, add a current
   `reassessment: { observed: true, method: "RENDER", evidenceRef: "...",
   reason: "..." }` only after actually inspecting the UI. MEASUREMENT
   and RUNTIME and SCREENSHOT_REVIEW are also accepted methods when
   real current pixels were actually inspected. A screenshot review is
   qualitative evidence, not an invented pixel-distance measurement.
   If only additional viewports
   or inaccessible Computer Use are missing, classify the current result
   UNVERIFIED instead of asserting that the defect is still visible.
   Historical UNVERIFIED does not establish a recurrence and must not force
   speculative code changes. A SOURCE_REPAIR record is an inspectable claim,
   not cryptographic proof that the source changed or the runtime improved.
   Build and render the same native window/state; keep the issue open if
   the visual problem remains.
6. Persist verdicts for the current run BEFORE making the gate proof:

       node SKILL/scripts/findings-ledger.mjs sync --ledger .design-with-ai/findings-ledger.json --baseline tmp/prior-findings-current.json --receipt tmp/iteration-receipt-current.json
       node SKILL/scripts/run-iteration-gate.mjs --receipt tmp/iteration-receipt-current.json --baseline tmp/prior-findings-current.json --ledger .design-with-ai/findings-ledger.json --proof tmp/iteration-proof-current.json
       node SKILL/scripts/run-iteration-gate.mjs --receipt tmp/iteration-receipt-current.json --baseline tmp/prior-findings-current.json --ledger .design-with-ai/findings-ledger.json --check-proof tmp/iteration-proof-current.json

   The project ledger is mandatory for the gate whenever its canonical file
   exists. Ledger validation checks the frozen event prefix, all in-scope
   historical findings, unchanged acceptance conditions, and one persisted
   assessment per final finding. SHA-256 proof binds ledger, receipt, baseline
   and both validator scripts. Changes after proof invalidate it.
   A valid PARTIAL can legitimately yield check-proof exit 1 because
   completionEligible is false; inspect the reported valid flag separately.
7. Commit the project ledger with the UI changes. Keep temporary artifacts
   and secrets out of version control.

## Rebuttal and regression

A prior navigation defect can be KEEP_JUSTIFIED only with current evidence,
explicit reassessment.reason and reassessment.evidenceRef, an inspected
after.ref, and reassessment.method TEST or RUNTIME confirming actual behavior. The actual route targets and runtime interactions are better
evidence than two similar-looking buttons. It stays in history and is
re-reviewed when the route is next in scope. If a previously resolved issue
returns, record REGRESSED with current evidence. An external publish that
cannot be tested stays UNVERIFIED. Never delete the original FOUND event.

## Boundaries

A valid ledger/proof does NOT establish that every initial problem was
discovered, that imported evidence is authentic, or that the application is
actually correct. The skill cannot invent missing historical context.
A host that does not run the optional trusted Codex Stop hooks still relies
on user/agent compliance, so independent project CI should run the gate for
enforced release acceptance. Committing the ledger is essential to persistence.
