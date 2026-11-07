# CodeRabbit review #205: evidence correctness hardening

Manual CodeRabbit review of combined Draft #205 (head `098c0df4272ce8a0e4fdf50df9285a96e2daf9ae`) returned **13 actionable threads**. This Draft addresses four high-relevance findings for the reliability of source coverage and benchmarking. It is not a blanket resolution of the other nine threads.

## Fixes in this branch

1. **Incomplete Impeccable directory traversal:** the default vendored walker remains permissive for legacy callers, but `--dwa-scan-proof` now requests `strict: true`. Unreadable nested source folders, symlinks and special entries throw and prevent a completed-file receipt. Regression tests inject an EACCES error and run the real CLI with a symlink. Empty or partial trees never silently count as complete.
2. **Benchmark fallback overclaim:** the four-mode performance diagnostic now requests the versioned completed-file receipt in **each** run, checks counts, scanner completion and the selected configuration flags, and rejects any `degradedFiles` or missing receipt as `INCOMPLETE`. It reports confirmed `filesScanned` separately from findings and wall time.
3. **Native-only profile isolation:** `runProfileProviders()` includes Impeccable-only DESIGN.md/.impeccable config inputs in its scope proof only if the Impeccable provider is selected. A `quick` or `--no-impeccable` audit no longer fails on an irrelevant symlinked config. With Impeccable selected, the same unsafe config still fails closed.

4. **Bounded build-tree enumeration:** the rendered-asset snapshot streams directory entries via `opendirSync().readSync()`, so the 15,000-entry cap limits in-memory enumeration rather than checking only after `readdirSync()` allocated everything.

The source content and base workflow code remain on `Wibias/agent-hub`, with no modifications to `streamer-content`.

## Still open

Other review threads concern Taste metadata consistency, DOM marker proof, viewport text, visibility, redirect chains, and HTML fallback fixtures. They need separate resolution and regression tests. Their absence from this change is **not** an endorsement of the original behavior.

The combined integration Draft #205 and this fix remain Draft/unmerged. The optional HTTP response-body experiment #210 is independent of these fixes and cannot approve a product or attest Taste's own screenshots.
