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

The manifest also binds every selected source file to a deterministic `detectorBindings` entry (`source`, `designRoot`, `designFile`). An absent applicable policy is represented by `null`. This prevents a new nested `package.json` / project boundary from silently changing only one source file's inherited `DESIGN.md` while the same outer policy remains in use by sibling files. The mapping is stored only for audits with Impeccable detector-context tracking enabled, not native-only quick scans. Each binding uses project-relative paths; the full per-file resolution array participates in `sourceSha256`.

The DWA snapshot includes only the digest, not policy contents. Files already present in the ordinary source manifest are not double-counted. A config created or changed between the before and after source proofs changes `sourceSha256`, making the workflow fail closed. Symlinks and policies resolving outside the declared project root are rejected.

The resolver is deliberately independent of the optional Impeccable plugin. The DWA native quick profile must still work when Impeccable is unavailable.

When the effective shared/local detection config explicitly sets `detector.designSystem.enabled=false`, source-scope proof skips DESIGN.md and sidecar discovery (the detector itself does not consume them). It still validates, fingerprints and attests both present config files, preserves the per-source `null` design bindings, and separately binds linked HTML stylesheets. Local config overrides the shared config. A new config re-enabling design policy restores full DESIGN.md validation, including strict symlink/out-of-root rejection. This is an application-level matching of the vendored config precedence; it must remain synchronized with `readDetectionConfig()`.

## HTML-linked stylesheet dependencies

A selected **single HTML source file**, with Impeccable enabled and without Taste,
can still cause the vendored static-HTML detector to read local
`<link rel="stylesheet" href="...">` CSS files outside the selected target.
`sourceScopeProof()` therefore binds existing local linked stylesheets to an
optional sorted `manifest.linkedStylesheets` array containing only
project-relative paths and SHA-256 digests. Their file metadata also joins
`observedInputsSha256`. A CSS change invalidates the before/after proof even
when the HTML itself is byte-for-byte unchanged.

This path resolution follows Impeccable's local href query/fragment stripping
and rejects symlinked, out-of-project, or ambiguous entity-encoded local
stylesheets rather than silently claiming full provenance. Files already
included in the selected source manifest are not duplicated. The native-only
quick profile does not acquire these optional detector inputs.

## Limits

This strengthens provenance; it **does not** prove the static detector saw every relevant design failure, that Taste Skill captured the intended application state, or that source files were OS-level immutable during the scan.

The nearest-design-root lookup mirrors the bundled detector's project markers and search locations. If upstream Impeccable's policy resolution changes, this mapping must be updated and regression-tested. External environment variables, executable versions and dynamically imported code may also affect verdicts and are not represented by this policy-file list. Independently pinned provider/runtime versions remain necessary.

This change is separate from PRs #195/#196/#197/#198/#200 and the joint candidate #205. **Keep Draft and do not merge without review.**
