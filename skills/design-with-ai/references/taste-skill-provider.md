# Optional Taste Skill browser evidence, 2.5.0 (phase 3)

This bounded adapter consumes the **current** public `Leonxlnx/taste-skill` version `tasteskill 2.5.0` (`skills/taste-skill/scripts/consistency.mjs`, upstream HEAD `9b4bf937a1f69348126959c15d2f99a73e65699b` reviewed November 5, 2026). The earlier research report's `draw.mjs`, `lint.mjs` and `inspect.mjs` entrypoints do not exist in this reviewed distribution. They must not be called or silently emulated.

## Pilot invocation

Use Node.js 22+ with an **already installed and trusted** Taste Skill 2.5.0 folder, Chromium/Chrome/Edge and a built local HTML page. The folder can be a linked checkout. No install, download, global command, `npx` or `live` command runs automatically.

```shell
node skills/design-with-ai/scripts/providers/scan.mjs --provider taste-skill --path dist/index.html --route / --project-root dist --skill-root /absolute/path/to/design-taste-frontend --page-kind software
```

Use `--output-root /existing/private/directory` to keep per-run artifacts there. Otherwise results go to an isolated temporary directory (its path appears in the report). Set `CHROME_PATH` when the upstream Chrome discovery cannot find a browser. Optionally set `--category` and `--primary` with confirmed product context. The provider passes the upstream non-quick `--json --widths 1440,768,390 --rhythm-widths 1440,768,390 --root ... --out ... --profile ...` flags and leaves its usual first-screen sweep enabled.

Exit: 0 for a scoped `PASS`; 1 for `FINDINGS`; 2 for `BLOCKED`, `UNAVAILABLE` or `ERROR`. A missing browser, stale/missing report, skipped checks, failed width, inconsistent counts or an incomplete upstream run is **never a green result**. Raw `report.json`, Chrome profile and diagnostic crops are isolated in a unique run folder; valid findings link directly to the report's JSON pointers and existing diagnostic crops. Output is not deleted by the adapter, so users can inspect evidence; clean up run directories deliberately after review.

## Authority and safety

This is **evidence**, not a DWA completion proof. Taste Skill 2.5.0 contains opinionated website-specific rules including one-section-per-screen, no image captions, equal left/right edges and restrictions on effects and contact formatting. These are **not universal DWA requirements**. Every FAIL is mapped to contextual review priority P1, every WARN to P2. The DWA project brief, locked design decisions, actual UI behavior, and existing `taste-evidence-receipt.mjs` / `run-iteration-gate.mjs` remain authoritative. Existing native DWA rendered/source checks must still run.

The adapter intentionally rejects remote URLs, file-scheme URLs, missing/non-HTML targets, path escapes, partial runs and unexpected output paths. Upstream serves the trusted local page over loopback using its own temporary Chrome profile; browser-executed page scripts and asset requests **can still access the network**. Neither `shell:false` nor this adapter is an OS/browser/network sandbox. Run against trusted built pages, avoid secrets in the browser profile or project, and inspect upstream changes before upgrading. On an enforced timeout the adapter reports `ERROR`; it cannot guarantee termination of every descendant browser process.

The reviewed source version is a compatibility constraint, not a cryptographic attestation. Pin and inspect upstream dependencies in the install environment before allowing automated execution. Full screenshot comparison, cross-provider deduplication, durable-ledger migration and default workflow wiring remain follow-up work.
