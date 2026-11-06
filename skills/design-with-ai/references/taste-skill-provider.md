# Optional Taste Skill browser evidence, 2.5.0 (phase 3)

This bounded adapter consumes the **current** public `Leonxlnx/taste-skill` version `tasteskill 2.5.0` (`skills/taste-skill/scripts/consistency.mjs`, upstream HEAD `9b4bf937a1f69348126959c15d2f99a73e65699b` reviewed November 5, 2026). The earlier research report's `draw.mjs`, `lint.mjs` and `inspect.mjs` entrypoints do not exist in this reviewed distribution. They must not be called or silently emulated.

## Pilot invocation

Use Node.js 22+ with an **already installed and trusted** Taste Skill 2.5.0 folder, Chromium/Chrome/Edge and a built local HTML page. The folder can be a linked checkout. No install, download, global command, `npx` or `live` command runs automatically.

```shell
node skills/design-with-ai/scripts/providers/scan.mjs --provider taste-skill --path dist/index.html --route / --project-root dist --skill-root /absolute/path/to/design-taste-frontend --page-kind software
```

Use `--output-root /existing/private/directory` to keep per-run artifacts there. Otherwise results go to an isolated temporary directory (its path appears in the report). Set `CHROME_PATH` when the upstream Chrome discovery cannot find a browser. Optionally set `--category` and `--primary` with confirmed product context. The provider passes the upstream non-quick `--json --widths 1440,768,390 --rhythm-widths 1440,768,390 --root ... --out ... --profile ...` flags and leaves its usual first-screen sweep enabled.

Exit: 0 for a scoped `PASS`; 1 for `FINDINGS`; 2 for `BLOCKED`, `UNAVAILABLE` or `ERROR`. A missing browser, stale/missing report, skipped checks, failed width, inconsistent counts or an incomplete upstream run is **never a green result**. Raw `report.json`, Chrome profile and diagnostic crops are isolated in a unique run folder; valid findings link directly to the report's JSON pointers and existing diagnostic crops. Output is not deleted by the adapter, so users can inspect evidence; clean up run directories deliberately after review.

## Interpreting raw findings and runtime-state limits

The adapter preserves every upstream FAIL/WARN, its source check ID, screenshot crop and stable evidence pointer. For reviewer triage, it also records the raw `upstreamSeverity` and a **non-authoritative** `reviewClass` on each observation:

| Class | Meaning |
| --- | --- |
| `POTENTIAL_USABILITY` | Candidate text clipping, contrast, broken media or interaction obstruction. Verify in a stable rendered state. |
| `GEOMETRY_NEEDS_VISUAL_REVIEW` | Spill/edge/stagger/tilt geometry, which may be intended decoration or an actual overflow defect. Requires screenshot and design-brief context. |
| `CONTEXTUAL_HOUSE_RULE` | Taste Skill's website conventions such as no captions, fixed section heights, hero rules or photo requirements. Not binding DWA requirements. |
| `UNCLASSIFIED_HEURISTIC` | New/unknown upstream check ID. Preserve it without guessing its meaning. |

These labels **do not suppress findings, change severity-to-priority mapping, or automatically promote anything into DWA's durable ledger**. The report's `summary.reviewClassCounts` retains the raw observation count across all classes. The provider-evidence fusion now preserves the validated `reviewClass` and `upstreamSeverity` for each Taste observation and includes the four review counts in the fused Taste report summary. It explicitly retains `renderedStateVerified: false` rather than pretending its rendered coverage implies a ready game state.

**Important for SPAs and interactive game screens:** the upstream `waitReady()` primarily recognizes its own kit's `data-ready` convention; it does not establish a general React/SPA hydration, authenticated room, socket connection, or game phase. The DWA adapter therefore always reports `summary.renderedStateVerified: false` and `renderedStateProof: NOT_PROVIDED_BY_UPSTREAM`. This remains true even when all viewport scans complete or a provider returns scoped `PASS`. For a claimed *specific interactive state*, a separate route/viewport-specific browser readiness proof is required before using Taste findings as a design evaluation. Do not call a placeholder or loading skeleton a final layout.

## Authority and safety

This is **evidence**, not a DWA completion proof. Taste Skill 2.5.0 contains opinionated website-specific rules including one-section-per-screen, no image captions, equal left/right edges and restrictions on effects and contact formatting. These are **not universal DWA requirements**. Every FAIL is mapped to contextual review priority P1, every WARN to P2. The DWA project brief, locked design decisions, actual UI behavior, and existing `taste-evidence-receipt.mjs` / `run-iteration-gate.mjs` remain authoritative. Existing native DWA rendered/source checks must still run.

The adapter intentionally rejects remote URLs, file-scheme URLs, missing/non-HTML targets, path escapes, partial runs and unexpected output paths. Upstream serves the trusted local page over loopback using its own temporary Chrome profile; browser-executed page scripts and asset requests **can still access the network**. Neither `shell:false` nor this adapter is an OS/browser/network sandbox. Run against trusted built pages, avoid secrets in the browser profile or project, and inspect upstream changes before upgrading. On an enforced timeout the adapter reports `ERROR`; it cannot guarantee termination of every descendant browser process.

The reviewed source version is a compatibility constraint, not a cryptographic attestation. Pin and inspect upstream dependencies in the install environment before allowing automated execution. Full screenshot comparison, cross-provider deduplication, durable-ledger migration and default workflow wiring remain follow-up work.

## Served-root isolation for Phase 5

The profile-aware `quality-audit.mjs` no longer passes the entire source repository to the Taste Skill local HTTP server. It uses the built page's containing directory, or an explicit `--browser-root` build subtree, and rejects any attempt to serve the top-level project root or put output evidence inside the served files. This protects against accidental exposure of `.env`, tool configurations and source secrets through loopback page requests. The standalone manual `scan.mjs --provider taste-skill` retains its explicitly provided `--project-root` as the served root: only use a trusted built-site folder, never a source checkout containing secrets. Page JavaScript can still attempt external requests; do not treat local-serving isolation as a browser sandbox.
