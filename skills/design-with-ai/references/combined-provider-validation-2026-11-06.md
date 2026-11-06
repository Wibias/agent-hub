# Combined Design-With-AI provider validation (2026-11-06)

This **non-mergeable integration candidate** combines five independent, unmerged Agent Hub Draft PR heads:

| Component | PR | Pinned head |
| --- | --- | --- |
| Impeccable completed-file receipt, fail-closed HTML parser fallback | #195 | `98565f629c01b1c778f1ed0549cbe47f7f475fbf` |
| Four-mode Impeccable performance diagnostic | #196 | `28046d9e69acc28a3977afc332ca9ce2ec7c25a7` |
| Taste review classes and retained evidence-fusion metadata | #197 | `f33124779e853b53eefb790d53666a1ba6f9a26b` |
| Optional declared DOM-state observation | #198 | `b21dab2dc3a15f91648b6215c896ce87074704b4` |
| Design-root directory memoization | #200 | `8e6fc5120d6bdcb29df7c4d6ccc1c1e3094b7507` |

All PRs were 14/14 CI-green independently before combining. Their change paths do not overlap. CI on the **combined branch** is separately required; five independent green CI runs do not prove the combination works.

## Joint real Chrome/Taste/Impeccable regression

The modified `tests/providers/browser-live-smoke.mjs` uses a disposable local HTML/CSS page with an explicit DESIGN.md, the real vendored Impeccable CLI, the native DWA source gate and the pinned upstream Taste Skill 2.5.0 real Chrome/CDP checker at 1440, 768 and 390 px.

It additionally asserts:
- All three provider reports have scoped `PASS` or `FINDINGS`, never silently unavailable or partial.
- Impeccable returns a valid completed-file receipt with `filesScanned = 1`, `degradedFiles = 0`, and the design-system mode enabled.
- Taste retains original finding count, `FAIL/WARN` severity, heuristic class counts and evidence through the central fusion.
- Taste is **not** runtime-state verified, even if its rendered scan completed; `productCompletionEligible` stays false.
- Incomplete source/browser evidence cannot claim an accepted product.
- All work occurs on disposable fixtures; no product files, users' worktrees, or upstream detector checkout are edited.

## Release limitations and review findings

This branch is a **test candidate only**; do not merge it as a substitute for merging and reviewing the constituent changes individually. The upstream Taste run currently cannot attest an authenticated game phase or that standalone DOM-state-probe screenshots match its own browser contexts. The separate DOM-state probe in PR #198 has only deterministic contract/failure tests in CI and has not yet demonstrated a live game backend.

**Important provenance review item:** `sourceScopeProof()` hashes the explicit source target and the rendered HTML, but may not include `DESIGN.md` or `.impeccable/config*.json` when those configuration inputs live *outside the selected source target*. The combined fixture includes a root-level DESIGN.md with a nested CSS target. A follow-up source-dependency binding test is required before a claim that every configuration dependency is protected by the source snapshot. The provider's completed-file receipt is separate from this broader configuration-provenance issue.

CodeRabbit full review quota was exhausted previously. An available independent reviewer must inspect the combined candidate and outstanding provenance limitation before any production promotion.

**Policy:** Keep Draft; no merges; never modify `Wibias/streamer-content`.
