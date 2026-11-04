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

## Per-iteration procedure

1. Inspect the project's persistent ledger BEFORE editing. Re-check every
   issue on affected routes, including resolved, deferred and previously
   disproved issues. Verify routes and actual link destinations; two visible
   Settings controls need not be duplicates if their functions differ.
2. Import newly discovered PRE-EDIT issues from a reviewed findings manifest.
   Never weaken original acceptance text to fit a cosmetic change.
3. Snapshot every in-scope historical finding and its event-prefix hash:

       node SKILL/scripts/findings-ledger.mjs snapshot --ledger .design-with-ai/findings-ledger.json --baseline tmp/prior-findings-current.json --scope /jobs,/jobs/:id,/settings --intent IMPROVE

   A unique run ID identifies this frozen baseline. Do not overwrite it.
4. Implement and verify. The receipt must include all baseline IDs and all
   new issues; mark requiresPriorBaseline and requiresFindingsLedger true.
   Preserve genuine blockers as PARTIAL or NOT_VERIFIED.
5. Persist verdicts for the current run BEFORE making the gate proof:

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
6. Commit the project ledger with the UI changes. Keep temporary artifacts
   and secrets out of version control.

## Rebuttal and regression

A prior navigation defect can be KEEP_JUSTIFIED only with current evidence,
explicit reassessment.reason and reassessment.evidenceRef, and an inspected
after.ref. The actual route targets and runtime interactions are better
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
