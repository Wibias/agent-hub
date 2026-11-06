# Binding Impeccable detector policies to the DWA source fingerprint

## Issue

DWA's source-scope snapshot previously enumerated only the selected source target and optional explicit intent/rendered HTML. A `DESIGN.md` or local Impeccable config located **above the selected target** could change a source-based verdict while DWA's `sourceSha256` stayed unchanged.

Example: a scan targeting `src/style.css` from a project whose `DESIGN.md` and `.impeccable/config.local.json` are in the project root. These inputs are material to the vendored detector, even though neither is inside `src`.

## Fix

`sourceScopeProof()` now includes a deterministic `manifest.detectorContext` array **only when non-source policy dependencies are present**, with project-relative paths and SHA-256 digests. It also includes their filesystem stats in the before/after change-detection fingerprint.

Policy dependencies covered:
- Project-root `.impeccable/config.json` and `.impeccable/config.local.json`, if present.
- The nearest applicable `DESIGN.md` (case variants and the existing `.agents/context`/`docs` fallbacks) per source-file directory.
- The corresponding `.impeccable/design.json` or `DESIGN.json` sidecar, if present, according to detector precedence.

The DWA snapshot includes only the digest, not policy contents. Files already present in the ordinary source manifest are not double-counted. A config created or changed between the before and after source proofs changes `sourceSha256`, making the workflow fail closed. Symlinks and policies resolving outside the declared project root are rejected.

The resolver is deliberately independent of the optional Impeccable plugin. The DWA native quick profile must still work when Impeccable is unavailable.

## Limits

This strengthens provenance; it **does not** prove the static detector saw every relevant design failure, that Taste Skill captured the intended application state, or that source files were OS-level immutable during the scan.

The nearest-design-root lookup mirrors the bundled detector's project markers and search locations. If upstream Impeccable's policy resolution changes, this mapping must be updated and regression-tested. External environment variables, executable versions and dynamically imported code may also affect verdicts and are not represented by this policy-file list. Independently pinned provider/runtime versions remain necessary.

This change is separate from PRs #195/#196/#197/#198/#200 and the joint candidate #205. **Keep Draft and do not merge without review.**
