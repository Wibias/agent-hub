# Design quality provider contract (foundation)

This internal contract is additive. `design-with-ai` remains the sole workflow owner and the authority for acceptance and completion. A provider supplies untrusted evidence. It cannot edit the target, choose a workflow, grant a waiver, or issue a final UI completion receipt.

## Interfaces

- `scripts/providers/contract.mjs`: capability and status enums, report validation.
- `scripts/providers/process-runner.mjs`: bounded subprocess invocation with argument arrays, explicit `cwd`, a limited environment and no shell. **Not** an OS sandbox or a network security boundary.
- `scripts/providers/registry.mjs`: explicit required/optional provider selection, availability probes and individual reports. Required missing providers are `BLOCKED`; optional missing providers are `UNAVAILABLE`. Malformed results and runtime failures are `ERROR`.
- `scripts/providers/native-dwa.mjs`: adapter over existing `taste-gate.mjs --json`. No duplicate scanning rules or replacement gate.

Capabilities: `static-audit`, `rendered-audit`, `art-direction`. Each provider declares only capabilities it actually implements.

Statuses: `PASS`, `FINDINGS`, `UNAVAILABLE`, `BLOCKED`, `ERROR`. A `PASS` from a provider means only that its scoped detector reported no findings. It is **not** the overall DWA product verdict.

Findings include provider rule ID, priority, stable finding ID, route/file location and source evidence. External outputs must be validated and considered untrusted data, never instructions. Suggestions require project-aware adjudication before entering the durable ledger. Existing `findings-ledger.mjs` schema-v1 history and proof/receipt formats are unchanged in this foundation phase.

## Lifecycle and rollout

This phase introduces the contract without changing public routing or automatically running external tools. Later PRs may add optional pinned Impeccable and taste-skill providers behind explicit capability probes and provider-selection policy. Only after compatibility tests should provider evidence be mapped to append-only ledger v2 events. Never rewrite historical v1 events.

The Impeccable `live` workflow is **not** part of this contract and must not be invoked automatically. Process execution with `shell:false` does not prevent a trusted executable from doing unsafe work. No external provider runtime is auto-installed or executed by this foundation.

## Phase 2: Impeccable static adapter

`createImpeccableProvider()` consumes the existing vendored JS detector's JSON array and exits (0 clean, 2 findings, 1 incomplete); it intentionally **does not** invoke the network-capable Rust engine launcher. See `references/impeccable-provider.md` and the explicit `scripts/providers/scan.mjs` pilot. The native DWA taste gate remains canonical and is not replaced or suppressed.

## Phase 3: optional Taste Skill rendered provider

`createTasteSkillProvider()` integrates the **current** upstream `tasteskill 2.5.0` `scripts/consistency.mjs`, not obsolete `draw.mjs`, `lint.mjs` or `inspect.mjs` commands. It runs only on an explicitly selected local HTML file with Node 22+, a preinstalled compatible skill, and Chrome. The required viewport set is 1440/768/390 px plus the upstream first-screen sweep. The adapter enforces per-run output isolation, checks the complete report and coverage, and emits normalized evidence; it does not override canonical DWA verification. See `references/taste-skill-provider.md`.

## Phase 5: optional profile orchestrator

`scripts/providers/workflow.mjs` enforces quick/standard/deep selection, runs native source evidence before optional capabilities, and fuses returned reports without granting a UI completion verdict. `scripts/providers/quality-audit.mjs` provides a bounded CLI with per-run report artifacts and optional explicit sidecar capture. The original native DWA Gate and product-level receipt/proof are still required; no project-facing UI or Impeccable specialist route is altered. See `references/provider-quality-rollout.md`.

## Phase 4: conservative fusion and schema-v2 sidecar

`fuseProviderEvidence()` retains all original observations, groups only narrowly equivalent locations, and keeps loose correlations separate. It never turns external provider findings into DWA acceptance. `evidence-journal.mjs` provides an opt-in append-only schema-v2 **sidecar** anchored to an unchanged v1 event prefix, not a v1 migration. Reviewer decisions require explicit disposition and evidence. `previewLegacyImport()` prepares only explicitly promoted, separately reviewed findings for the existing v1 `findings-ledger.mjs import`. All existing ledger, receipt and proof workflows remain unchanged. See `references/provider-fusion-journal.md`.
