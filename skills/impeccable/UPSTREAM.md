# Impeccable upstream

Agent Hub vendors the Impeccable skill from `pbakaus/impeccable`.

## Current pin

- Upstream commit: `5af4319c4e7a7ee3e5e2b9fe899bcfb21c6190cb`
- Skill version: `4.8.0`
- Engine version: `0.1.18`
- Refreshed: `2026-11-05`

## Engine release boundary

The November 5 upstream head includes newer Rust engine sources (live-wrap
disambiguation, Vue live preview/accept handling, runtime output cleanup)
but does **not** ship a new engine binary. The published engine is still
`0.1.18` (October 26, 2026). Those unreleased native changes are **not
included in the pinned binary**, and updating these three shared skill files
does not deliver them. Do not claim the native fixes are installed until a
new signed engine release and checksums are adopted. The shared vendor patch
only updates `reference/init.md`, `reference/live.md`, and
`scripts/live-browser.js`.

## Sync contract

Files shared with upstream under `.agents/skills/impeccable/` should remain byte-identical under `skills/impeccable/`, except `SKILL.md`.

`SKILL.md` is an intentional Agent Hub overlay. It preserves upstream Impeccable workflow semantics while adding the local explicit-only discovery boundary, repository-content instruction-injection handling, stricter launcher failure evidence, competing-skill classification, and Skill Ratchet qualification references.

Do not replace that overlay wholesale during an upstream refresh. Merge new upstream `SKILL.md` semantics into it, then verify that the local routing and security boundaries remain intact.

After changing the overlay, regenerate the repository knowledge catalog with `node knowledge/build-index.mjs` and commit the generated `knowledge/index.json` and `knowledge/INDEX.md` outputs.

Target-only evaluation or integration files are local Agent Hub assets and are not evidence of vendor drift. Agent Hub runtime-integration files that were never present in the pinned upstream distribution are local overlays too; an upstream refresh must preserve them unless a separate migration deliberately retires them.
