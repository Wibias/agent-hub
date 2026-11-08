# Rendered build asset provenance for DWA + Taste Skill

## Problem and boundary

Previously the evidence scope hashed the target source files and (when Taste was enabled) only the selected built HTML file. CSS, JavaScript, images, fonts and dynamically imported chunks located elsewhere under the served build root could change without changing that source-scope digest. See #207.

The fix **does not infer** which files the browser fetched. It attests the **complete local regular-file subtree** under the explicit `--browser-root`, including files with unknown extensions, hidden files and lazily loaded chunks. This is a conservative over-approximation: changes to unused files invalidate a scan rather than silently approving a changed page.

## Evidence

With Taste selected, `sourceScopeProof()` adds a bounded `manifest.renderedAssets` section:

- `kind: dwa/complete-local-rendered-tree`, `schemaVersion: 1`
- Sorted `files[]` containing project-relative path, file size and SHA-256
- Aggregate `filesSha256`, `fileCount`, `totalBytes` and explicit limits
- `summary.rendered.assetTreeSha256`, `assetCount`, `assetTotalBytes` and `assetCoverage: COMPLETE_LOCAL_TREE_BOUNDED`

The selected HTML is one of these files and retains its individual `rendered.sha256`. The rendered aggregate joins the *same* `sourceSha256` used by native DWA, Impeccable and Taste, and it is included in the per-provider rendered `auditScope`. The before/after fingerprint also records the local files' size/ctime/mtime. A new, deleted or modified build file fails source-scope comparison during provider execution.

These hashes are inspectable evidence, **not a promise** that the browser fetched every file, nor that authenticated game state was ready.

## Bounded execution and safety

| Limit | Value |
| --- | ---: |
| Regular local files | 10,000 maximum |
| Total directory entries | 15,000 maximum |
| Directory depth | 64 maximum |
| Per-file bytes | 128 MiB maximum |
| Total bytes | 512 MiB maximum |
| Hashing buffer | 64 KiB per file |

The scanner hashes files incrementally rather than loading an entire binary asset into RAM. Every entry is traversed regardless of extension. Symlinks, sockets and non-regular entries fail closed; root and HTML must be in an isolated in-project build subtree. A limit violation is an error, **never** a valid provider PASS or partial attestation. There is no network fetch, browser install, or project modification.

The full subtree snapshot may add disk I/O compared with HTML-only hashing, especially on large Vite builds. Benchmarks should compare identical builds and report file count, total bytes, before/after wall time, and preserved provider findings.

## Limits / residual work

This binds **only the local build-root tree**. It does not cover remote CDNs, service worker caches, assets outside `--browser-root`, browser extensions, live API payloads, or a server that rewrites responses. Those require separate browser request/response provenance and an authenticated runtime-state proof. A successful Taste report is still heuristic rendered evidence, not an accepted game-state verdict or product completion receipt.

Direct `quick`/source-only profiles do not need built assets and retain the existing source snapshot behavior.

## Verification

New unit/workflow regressions cover CSS, JS, image and font changes; addition/removal of lazy chunks; unbounded build trees; symlinked assets; and mutations during a rendered Taste provider run. The real Chrome/CDP integration smoke in Draft #205 must additionally assert that its linked CSS file is represented in the rendered manifest. It must be rerun **after** this PR is overlaid onto the combined candidate.

**Policy:** Agent Hub only. PR #207 tracks the gap. This implementation stays Draft, with no changes to `streamer-content` and no automatic merge.
