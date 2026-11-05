# Phase 5: guarded provider selection and release evaluation

## Integrated DWA Gate supplement

Design-with-AI remains the only default design owner. For a resolved local web source target, the regular Gate phase can run the following provider evidence supplement before final contextual review. This **does not replace** the required native source gate, DWA rendered inspection, source/render fusion, findings-ledger sync, evidence receipt or iteration proof.

```sh
node skills/design-with-ai/scripts/providers/quality-audit.mjs --profile standard --path src --project-root . --route /settings
```

Profile policy:

| Profile | Provider policy |
| --- | --- |
| quick | Required native DWA static scan only; no automatic browser or Impeccable |
| standard | Required native DWA plus optional bundled Impeccable JS static detector |
| deep | Same static set as standard; optional Taste Skill 2.5.0 browser audit only if explicitly selected |

For standard **or** deep, add `--with-taste --html dist/settings/index.html --browser-root dist --taste-root /absolute/trusted/skill/path` to run the third provider against a locally built HTML page. The browser serves only the HTML file's containing build directory by default. The supplied `--route /settings` must map to the actual `dist/settings/index.html` under `--browser-root dist`; one SPA `dist/index.html` cannot be relabeled as several deep routes. For nested output layouts, pass `--browser-root dist`; it must be a **separate build subtree** within `--project-root` and contain the requested page. Serving the entire repository root is rejected so local project secrets are not incidentally exposed by the loopback webserver. Write browser artifacts outside the served directory. `--require-taste` demands this runtime instead of recording it as optional. A missing runtime reports `INCOMPLETE` (optional) or `BLOCKED` (required), never scoped success. `--no-impeccable` disables the supplementary static provider in standard/deep; it does not turn absent evidence into a verified result. A quick profile rejects `--with-taste`. Existing native DWA source P0/HOLD remains blocking, regardless of specialist output.

Outputs go to a unique per-run folder below a pre-existing `--output-root` or the OS temporary directory. Every run records a source-scope manifest with file digests, Git HEAD when available, requested route, source fingerprint, and exact rendered HTML hash; input changes mid-run fail closed. The source-only route is explicitly a declared label, not proof of browser navigation. Scan file count is DWA-eligible coverage, not a claim about the Impeccable detector's internal file-by-file progress. The runner persists each provider JSON report, the fusion JSON and a summary. No network install is attempted, and no product file is edited. The CLI returns exit 0 for `REVIEW` or `SCOPED_CLEAR`, exit 1 for blocked/incomplete evidence, and exit 2 for invalid invocation. **Neither exit 0 nor `SCOPED_CLEAR` is a DWA product-completion result.** The final DWA completion receipt/proof remains unchanged.

To explicitly append a fusion snapshot to an already initialized v2 sidecar, pass `--journal .design-with-ai/provider-evidence-journal.json --ledger .design-with-ai/findings-ledger.json --run-id <unique-review-run-id>` together. This does not create or modify the legacy ledger. Adjudications and any optional v1 import still follow `provider-fusion-journal.md`. Do not capture a provider run automatically unless the project opted in.

## Actual test coverage and limits

The CI source end-to-end test executes the **real** built-in DWA source scanner and the vendored local Impeccable JavaScript detector on an isolated HTML fixture through the profile-aware CLI, then reads and checks both persisted reports and the fusion. The separate `Design provider real browser smoke` workflow fetches **one exact reviewed Taste Skill commit**, verifies its SHA, starts its actual Chrome/CDP checker on a local static HTML fixture, and demands 1440/768/390 coverage. No remote page, external assets, global installer, or live agent mode is used in the fixture. The browser job is isolated from the release-governance job and uses read-only repository permissions. Fetching/executing a reviewed upstream commit is still external code execution, **not** a security sandbox or independent binary attestation.

Tests establish adapter and orchestration behavior on synthetic fixtures. They **do not** measure preference rates, UI acceptance on production routes, actual functional backend semantics, or multi-project false positives. Before default-on external browser audits or wider rollout, collect representative project results and manually review the findings.

Recommended evaluation metrics: P0/P1 escapes; render/responsive escapes; reviewer-accepted vs rejected external findings; missing/blocked browser coverage; repeated ledger findings; iteration counts and time overhead; and the proportion of iterations backed by fresh completion proofs. Record baseline vs intervention with the same route set and blind evaluation to avoid rewarding a scanner merely for creating more warnings.

## Decision on the separate Impeccable skill

**Retain `skills/impeccable` for now.** It still exposes an explicit specialist command vocabulary, PRODUCT.md/DESIGN.md flows, live-browser behavior and upstream engine/launcher contracts that the new **static source-only** Impeccable adapter cannot replace. Removing the skill now would break `/impeccable` and related explicit routes, and silently remove supported capabilities. The DWA adapter must not invoke the launcher or `live` mode automatically.

After at least one stable compatibility release, inventory downstream invocations and parity-test every explicitly supported command before replacing the vendored folder with a thin compatibility shim. Keep `/impeccable` routing and an explicit specialist entry point; do not merge generic DWA design ownership with Impeccable's specialist UX. The vendor's `UPSTREAM.md` still records an update-pending engine mismatch; this is a reason to plan an eventual migration, **not** evidence that the current adapter can safely supersede the runtime.

## Rollback

Turn off Taste Skill by omitting `--with-taste`, turn off the extra static detector with `--no-impeccable`, or revert to the original `taste-gate.mjs` / PowerShell wrapper and verification contract. No persisted legacy-ledger migration is needed. Sidecar v2 data remains isolated and readable. Do not delete captured evidence during rollback.

## Review gate before merging

The sample CI page is a controlled fixture, not a production acceptance cohort. A P1/P2 from Impeccable or Taste Skill remains a *review hypothesis*. In particular, Taste Skill's layout/imagery house rules and Impeccable's font/palette preferences can be false positives against a deliberately approved design world. A reviewer must compare the reported rule, screenshot/source evidence, and project design brief before accepting a proposed visual change. P0 from the native DWA source gate is not downgraded. Never compute a scanner's quality from raw warning counts alone; quantify accepted findings, false positive rate and time overhead on representative product routes before enabling external checks more broadly.
