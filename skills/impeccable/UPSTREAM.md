# Impeccable upstream

Agent Hub vendors the Impeccable skill from `pbakaus/impeccable`.

## Current pin

- Upstream commit: `df3a4abe7d0840d5f60324812c432e00b66a4e75`
- Skill version: `4.8.0`
- Engine version: `0.1.18`
- Refreshed: `2026-10-31`

## Sync contract

Files shared with upstream under `.agents/skills/impeccable/` should remain byte-identical under `skills/impeccable/`, except `SKILL.md`.

`SKILL.md` is an intentional Agent Hub overlay. It preserves upstream Impeccable workflow semantics while adding the local explicit-only discovery boundary, repository-content instruction-injection handling, stricter launcher failure evidence, competing-skill classification, and Skill Ratchet qualification references.

Do not replace that overlay wholesale during an upstream refresh. Merge new upstream `SKILL.md` semantics into it, then verify that the local routing and security boundaries remain intact.

After changing the overlay, regenerate the repository knowledge catalog with `node knowledge/build-index.mjs` and commit the generated `knowledge/index.json` and `knowledge/INDEX.md` outputs.

Target-only evaluation or integration files are local Agent Hub assets and are not evidence of vendor drift. Agent Hub runtime-integration files that were never present in the pinned upstream distribution are local overlays too; an upstream refresh must preserve them unless a separate migration deliberately retires them.
