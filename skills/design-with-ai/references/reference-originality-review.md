# Reference originality review (conditional)

Use when a product UI or design was materially inspired by a named site, visual system, screen, motion clip or another supplied reference, and the task includes an originality, identity, asset, or close-copy risk. Adapted from MengTo's MIT-licensed `audit-reference-originality` skill reviewed at commit `3cc93458c4949c39a04e938ea7892a1d6d3d40bf` on 2026-11-18.

This is a **read-only evidence and design review**, not a copyright judgment or a universal extra DWA completion gate. Do not assert legal plagiarism or safety merely from visual similarity or a clear heuristic scan. Standard platform conventions, common gradients, familiar layouts, and ordinary UI components are not violations in isolation.

## Evidence first

1. Identify the current project output and every explicitly supplied reference. Record URLs or local filenames, captured versions, rights/access, and each source's actual role. Prefer locally archived references when a live page has changed.
2. Inspect the *actual output* and the references at matching meaningful states, routes, viewports, and motion beats. If a long/lazy source page is partially captured, load `settled-reference-capture.md` before saying the full site was reviewed.
3. Check text, names/logos, product metrics, proof claims, photos/illustrations, files/fonts, layout/section sequence, characteristic interaction and motion, and any accessible Git history. Separate direct copying, a distinctive combined composition, and common visual grammar.
4. Use the bounded local helper **only when files are accessible**. It detects identical file bytes and exact normalized long text blocks across local files or directories; it does not scrape websites, examine browser pixels or inspect Git history:

```shell
node skills/design-with-ai/scripts/reference-originality.mjs --candidate <local-build-or-component> --reference <authorized-local-reference> --json
```

Add up to five explicit `--reference` paths. It is read-only, skips symlinks and common build dependency folders, bounds file count/size, and reports file paths and hashes rather than copying text into a published report. A detected exact match needs human interpretation: it could be a reused open-source component or legitimately licensed media. No match means **only** that the bounded exact detector found none.
5. For a material red flag, pair exact current evidence with exact reference evidence, state observable overlap and difference, assign priority, and propose the smallest change that establishes a genuinely new identity while preserving product function. Recoloring copied logos, copy, imagery, or distinctive compositions is not sufficient.
6. Report checked scope and unchecked categories. Do not claim full originality, legal compliance, cleared branding, or functional correctness. Treat unavailable history, frame sequences, and pixels as **not checked**, never as clean.

## Integration boundary

The project's design authority, branding, existing DWA anti-slop review and verified user intent remain canonical. This method is for reference provenance and originality risk, **not** a new global style blacklist. It cannot automatically delete assets, rewrite approved copy, or block unrelated implementation solely because two designs share ordinary conventions. Hand any confirmed material issue to the existing DWA finding-to-outcome ledger and evidence receipt. Do not introduce an additional memory store or independent approval workflow.
