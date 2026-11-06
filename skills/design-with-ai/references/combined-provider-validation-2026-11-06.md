# Combined Design-With-AI provider validation (2026-11-06)

This **non-mergeable integration candidate** combines five independent, unmerged Agent Hub Draft PR heads, followed by the policy-provenance fix #206 and rendered-asset provenance fix #208:

| Component | PR | Pinned head |
| --- | --- | --- |
| Impeccable completed-file receipt, fail-closed HTML parser fallback | #195 | `98565f629c01b1c778f1ed0549cbe47f7f475fbf` |
| Four-mode Impeccable performance diagnostic | #196 | `28046d9e69acc28a3977afc332ca9ce2ec7c25a7` |
| Taste review classes and retained evidence-fusion metadata | #197 | `f33124779e853b53eefb790d53666a1ba6f9a26b` |
| Optional declared DOM-state observation | #198 | `b21dab2dc3a15f91648b6215c896ce87074704b4` |
| Design-root directory memoization | #200 | `8e6fc5120d6bdcb29df7c4d6ccc1c1e3094b7507` |
| External Impeccable policy inputs in DWA source fingerprint | #206 | `f1fbc19b967d4fc37afa168f604fb6a16f57e504` |
| Complete bounded local rendered build-tree fingerprints | #208 | `b957d85af46389878647fe57fd73bf3e5725d02e` |

The seven feature PRs were each 14/14 CI-green independently. A manual CodeRabbit review of the combined candidate subsequently raised **13 actionable threads**. Independent corrective Drafts #212 (`d5bf742a61bb8746470ecdc2b7d71e352daa1d5d`) and #213 (`8365d8a5a927910072311d4dbad90c1654b934ca`) were each 14/14 CI-green; their 13 non-overlapping changed files are now overlaid on the integration candidate. **Ten** review findings are addressed by those fixes; **three** remain to be resolved or explicitly justified. PRs #206 and #208 both touch `scope-proof.mjs` and `workflow.test.mjs`; their changes are **integrated explicitly and checked for retention of both safeguards**. CI on the combined branch is separately required; individual green CI runs do not prove the combination works.

## Joint real Chrome/Taste/Impeccable regression

The modified `tests/providers/browser-live-smoke.mjs` uses a disposable local HTML/CSS page with an explicit DESIGN.md, the real vendored Impeccable CLI, the native DWA source gate and the pinned upstream Taste Skill 2.5.0 real Chrome/CDP checker at 1440, 768 and 390 px.

It additionally asserts:
- All three provider reports have scoped `PASS` or `FINDINGS`, never silently unavailable or partial.
- Impeccable returns a valid completed-file receipt with `filesScanned = 1`, `degradedFiles = 0`, and the design-system mode enabled.
- Taste retains original finding count, `FAIL/WARN` severity, heuristic class counts and evidence through the central fusion.
- Taste is **not** runtime-state verified, even if its rendered scan completed; `productCompletionEligible` stays false.
- The same real Chrome fixture's out-of-target `DESIGN.md` appears by relative path and SHA-256 in `sourceScopeProof().manifest.detectorContext`; all providers' audit scopes bind to the resulting fingerprint.
- Its loaded `dist/settings/fixture.css` and `index.html` both appear in the bounded `manifest.renderedAssets` with file-level SHA-256. The rendered aggregate digest matches the Taste and fused scope.
- Incomplete source/browser evidence cannot claim an accepted product.
- All work occurs on disposable fixtures; no product files, users' worktrees, or upstream detector checkout are edited.

## Release limitations and review findings

This branch is a **test candidate only**; do not merge it as a substitute for merging and reviewing the constituent changes individually. The upstream Taste run currently cannot attest an authenticated game phase or that standalone DOM-state-probe screenshots match its own browser contexts. The separate DOM-state probe in PR #198 has only deterministic contract/failure tests in CI and has not yet demonstrated a live game backend.

**Policy and local build provenance fixes included:** #206 binds out-of-target `DESIGN.md`, its sidecar and shared/local `.impeccable` detector configs. #208 binds the full isolated regular-file build subtree to the shared source fingerprint and before/after stat checks, with explicit file/byte/depth limits and fail-closed symlink handling. Tests cover creation, deletion, mutation and path safety. The combined Chrome smoke checks both the external policy digest and the locally linked CSS's own hash. Neither fix proves remote CDN bytes, service-worker caches, authenticated room state or every dynamic network response. A completed file receipt is separate from these provenance guarantees.

CodeRabbit's independent manual review completed and produced 13 actionable threads. The fixes now included address partial Impeccable traversal, false benchmark completion, native-only profile policy isolation, memory-bounded asset enumeration, and the six positive-marker/viewport/redirect/optional-list DOM-state cases. The three remaining review items were addressed in independent Draft #214 (`9caef61bafe9537d4b3526a4049950166f2ce2d8`): Taste FAIL/P1 vs WARN/P2 consistency validation, canonical temporary-directory assertions and a test-local ESM loader that deterministically makes all four HTML parser modules unavailable in the real detector child process. #214 passed 14/14 CI and its changes are now included in this combined candidate. All **13 original CodeRabbit threads have an implementation response**, but none should be treated as externally re-reviewed until the current combined head is checked. This integration candidate remains Draft and unmerged. The experimental Chrome response-byte probe #210 is deliberately **not** integrated into the default DWA workflow; it uses separate browser contexts from Taste.

**Policy:** Keep Draft; no merges; never modify `Wibias/streamer-content`.
