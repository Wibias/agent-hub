# Autonomous improvement execution loop

Applies to authorized **improve-existing** work in design-with-ai, regardless of
web, native desktop, or mobile UI. The agent runs this loop **inside the current
task**, without asking the user to say "continue" after each PARTIAL. Do not use
it to override a deep-redesign direction approval, access control, deployment
authorization, or the user's explicit scope. A read-only audit never edits code.

## Control is distinct from gate validation

The receipt, ledger and final gate answer **what was proved**; they do not
decide **what to do next**. The script
"scripts/repair-loop-controller.mjs" is the platform-independent,
deterministic **next-action selector**. It does not run an LLM, invoke GUI tools,
edit applications, authenticate screenshots, or invent measurements. The
**executing DWA agent** owns those actions. Calling the controller but never
following its CONTINUE decision is not completion. Do not describe the
controller alone as a fully autonomous runtime.

## Single-request loop

A short user request is enough when the previous target and unfinished
acceptance conditions are unambiguous. Resume from the actual project ledger
and latest evidence; do not require the user to enumerate the findings or
author a detailed verification plan.

1. Resolve authority, target and accepted product behavior. For local Codex
   source edits, ensure the host session's workspace contains the target
   product root (or vice versa) **before making the first change**. A
   disjoint native proof is not valid Stop evidence for the unrelated host
   workspace, even if the target project's independent `--check-proof`
   reports `valid: true`. Stop this task with `WORKSPACE_SCOPE_MISMATCH`
   rather than mutating across the workspace boundary. Do not try to fix a
   host-workspace mismatch by issuing more receipts or proof files.
   Then load the normal workflow, freeze the canonical findings ledger and
   independent pre-edit baseline ONCE. The baseline remains immutable across
   repairs.
2. Inspect actual available UI pixels and interaction states, including current
   user screenshots. Collect external-first native evidence when applicable.
   Reconcile **every** in-scope old finding, preserving IDs and original
   acceptance conditions. Write distinct findings for newly observed defects.
3. Prioritize confirmed faults by severity and risk, then repair the relevant
   source **within the user's authorized scope**. Prefer the smallest source
   change that fixes underlying layout/interaction; do not implement new
   features, styles, or app-side evidence exporters as detours.
4. Build/test, run the affected route or native app, and render exactly the
   same viewport and state. Compare before/after and check for clipping,
   interaction regressions, inaccessible focus and introduced defects.
5. After **every source edit**, regenerate the final receipt from the
   current candidate and reconcile the ledger before issuing a new proof.
   A new proof alone cannot rehabilitate an old receipt: native source file
   changes newer than the receipt produce NATIVE_RECEIPT_STALE. Re-run
   affected states and keep the before/after evidence. When the source or
   any proof input changes, issue a **new** gate-proof path and check it
   independently as usual. Never reuse an old assessment from a different
   candidate simply because the JSON still validates.
6. Ask the controller for the **next action**, then **execute it in this
   task**. Repeat 2-6 until a truthful stopping condition below is reached,
   without requesting user confirmation after each internal pass:

       node <skill-root>/scripts/repair-loop-controller.mjs --receipt <current-receipt.json> --baseline <frozen-baseline.json> --attempts <iteration-attempts.json> [--render-evidence <actual-manifest.json>] [--proof <current-proof.json> --ledger <project-ledger.json> --source-root <project-root>]

   The optional JSON attempts file is an array (or an object with an
   "attempts" array) of completed actual actions; if omitted, the controller
   accepts the current receipt's "repairLoop.attempts" array. Keep it
   consistent with the separate task artifacts used by the gate. For example:

       { "findingId":"UX-04", "action":"REPAIR_SOURCE",
         "sourceBefore":"real-sha-before", "sourceAfter":"real-sha-after",
         "renderBefore":"real-before-ref", "renderAfter":"real-after-ref",
         "result":"REVISE" }

   Record real evidence identifiers, not synthetic values; omission of a
   newly attempted action or a false PASS violates the evidence contract.
   Use the selector's JSON outcome and action, never an assumed exit code.

   - **VERIFY_CURRENT**: obtain/inspect available current evidence first.
     Do not edit source from a guessed or stale defect.
   - **REPAIR_SOURCE**: make a targeted source fix, test, then render the same
     view/state. Address the selected finding before new unrelated work.
   - **RERENDER**: the edited source lacks a distinct post-edit render.
     Capture/review the final application candidate before further edits.
   - **RUN_GATES**: finish missing acceptance and generate/check fresh proof;
     this is **actionable even if all recorded findings are resolved** and the
     final rendering, interaction matrix or manifest is still incomplete.
     If a local capture/export/test process crashes, inspect its actual
     exception/stack trace, create or reuse a stable in-scope runtime finding,
     and record its current evidence in "currentRuntimeFailures" with
     "findingId", "observed: true", "evidenceRef" and an error code.
     A repairable exception in the project's own code is not an external
     access blocker. Repair the local source, rerun the same test and collect
     independent fresh captures before any publish step.

   Generic control decisions are not desktop-only KPI heuristics. The
   selected finding's original acceptance is the next repair's target.

## Do not confuse a valid incomplete gate with a missing gate

A native `run-iteration-gate.mjs` invocation can have process exit **0**
and write a structurally valid `PARTIAL` proof while the independent
`--check-proof` returns exit **1** with `valid: true`,
`sourceBound: true`, `completionEligible: false` and no issue codes.
That is **incomplete product acceptance**, not proof corruption or a
missing gate command.

Before issuing another gate proof, compare the source identity, receipt,
frozen baseline, ledger, render inputs and validator versions against the
latest independently checked proof. If **none changed**, do not generate
another `--proof` merely to respond to a Stop-hook message or to change an
expected incomplete exit code. First pursue the *specific missing real UI
state* through a permitted verification path. If the path is unavailable,
record the actual failed attempt, affected state, evidence reference and
specific blocker in the existing receipt/ledger, then use a truthful
`PARTIAL`/`NOT_VERIFIED` stopping outcome. Never claim that source-level
`EnsureVisible`, ellipsis or tooltip code proves the final selected process,
scroll position, hover disclosure or keyboard interaction worked.

A failed external native click due to process integrity/UIPI does not
authorize replacing real interaction evidence with a synthetic screenshot.
Use available, **already authorized** read-only app/test evidence and the
desktop-monitoring reference's integrity-level rules, distinguishing
display-state proof from live input proof. Do not implement a new product
instrumentation/export mode as a verification shortcut.

## Actual stopping conditions

- **COMPLETE** only with a matching, current, independently checked
  COMPLETE proof, actual applicable functional and rendered acceptance, no
  unresolved in-scope findings and necessary final candidate verification.
- **STOP_BLOCKED** if remaining findings each have a specific real access,
  capability or evidence blocker with a referenced observation and next step.
  The user need not repeat the entire improve request; report the concrete
  missing authorization/capability. Missing DPI evidence alone cannot prevent
  a repair of an already observed compact defect.
- **STOP_STALLED** after two unsuccessful attempts with identical real source
  and render identities. Diagnose why rather than repeating ineffective
  changes; report what was tried and what remains.
- **STOP_LIMIT** after at most eight completed repair/verification passes in
  the current task (smaller when explicitly required). Report PARTIAL with
  actual attempts, residual findings and what prevented acceptance. Never
  silently start a new turn or claim false COMPLETE.
- **OUT_OF_SCOPE/INVALID** must not be treated as product completion.

Be careful about destructive operations, credential changes, elevation,
third-party publication and unsafe tests: these still need real permissions.
A repair loop cannot authorize them.

## Optional host continuation, not the main loop

When the trusted Codex Stop hook is installed, it can request **one**
automatic continuation when a valid PARTIAL IMPROVE proof still has an
actionable visual repair. The hook is a guard against premature termination,
**not** an unbounded background agent and not a substitute for steps 1-6
inside the main turn. A host without the hook still uses this mandatory
skill-level procedure. If tools/context are unavailable, end truthfully
BLOCKED/PARTIAL with evidence rather than claiming execution.
