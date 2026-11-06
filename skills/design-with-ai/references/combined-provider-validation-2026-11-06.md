# Combined Design-With-AI provider validation (2026-11-06)

This **non-mergeable integration candidate** combines five independent, unmerged Agent Hub Draft PR heads, followed by the separate policy-provenance fix in Draft #206:

| Component | PR | Pinned head |
| --- | --- | --- |
| Impeccable completed-file receipt, fail-closed HTML parser fallback | #195 | `98565f629c01b1c778f1ed0549cbe47f7f475fbf` |
| Four-mode Impeccable performance diagnostic | #196 | `28046d9e69acc28a3977afc332ca9ce2ec7c25a7` |
| Taste review classes and retained evidence-fusion metadata | #197 | `f33124779e853b53eefb790d53666a1ba6f9a26b` |
| Optional declared DOM-state observation | #198 | `b21dab2dc3a15f91648b6215c896ce87074704b4` |
| Design-root directory memoization | #200 | `8e6fc5120d6bdcb29df7c4d6ccc1c1e3094b7507` |
| External Impeccable policy inputs in DWA source fingerprint | #206 | `f1fbc19b967d4fc37afa168f604fb6a16f57e504` |

All six constituent PRs were 14/14 CI-green independently before combining. Their change paths do not overlap. CI on the **combined branch** is separately required; separate green CI runs do not prove the combination works.

## Joint real Chrome/Taste/Impeccable regression

The modified `tests/providers/browser-live-smoke.mjs` uses a disposable local HTML/CSS page with an explicit DESIGN.md, the real vendored Impeccable CLI, the native DWA source gate and the pinned upstream Taste Skill 2.5.0 real Chrome/CDP checker at 1440, 768 and 390 px.

It additionally asserts:
- All three provider reports have scoped `PASS` or `FINDINGS`, never silently unavailable or partial.
- Impeccable returns a valid completed-file receipt with `filesScanned = 1`, `degradedFiles = 0`, and the design-system mode enabled.
- Taste retains original finding count, `FAIL/WARN` severity, heuristic class counts and evidence through the central fusion.
- Taste is **not** runtime-state verified, even if its rendered scan completed; `productCompletionEligible` stays false.
- The same real Chrome fixture's out-of-target `DESIGN.md` appears by relative path and SHA-256 in `sourceScopeProof().manifest.detectorContext`; all providers' audit scopes bind to the resulting fingerprint.
- Incomplete source/browser evidence cannot claim an accepted product.
- All work occurs on disposable fixtures; no product files, users' worktrees, or upstream detector checkout are edited.

## Release limitations and review findings

This branch is a **test candidate only**; do not merge it as a substitute for merging and reviewing the constituent changes individually. The upstream Taste run currently cannot attest an authenticated game phase or that standalone DOM-state-probe screenshots match its own browser contexts. The separate DOM-state probe in PR #198 has only deterministic contract/failure tests in CI and has not yet demonstrated a live game backend.

**Policy provenance fix included:** #206 now binds out-of-target `DESIGN.md`, its sidecar and shared/local `.impeccable` detector config files to the source manifest. New tests cover file creation, editing, nested project boundaries, symlink escapes, and a configuration mutation during provider execution. A passing combined Chrome smoke is required before claiming that this integration path works. These policy digests still do **not** prove every possible runtime or environment dependency is immutable. The completed-file receipt is separate from configuration provenance.

CodeRabbit full review quota was exhausted previously. An available independent reviewer must inspect the combined candidate and outstanding provenance limitation before any production promotion.

**Policy:** Keep Draft; no merges; never modify `Wibias/streamer-content`.
