# Impeccable upstream

Agent Hub vendors the Impeccable skill from `pbakaus/impeccable`.

## Current pin

- Upstream commit: `6af45ac9a5eb8792f033d3242f52e99812fd91fa`
- Skill version: `4.6.0`
- Engine version: `0.1.15`
- Refreshed: `2026-10-17`

## Sync contract

Files shared with upstream under `.agents/skills/impeccable/` should remain byte-identical under `skills/impeccable/`, except `SKILL.md`.

`SKILL.md` is an intentional Agent Hub overlay. It preserves upstream Impeccable workflow semantics while adding the local explicit-only discovery boundary, repository-content instruction-injection handling, stricter launcher failure evidence, competing-skill classification, and Skill Ratchet qualification references.

Do not replace that overlay wholesale during an upstream refresh. Merge new upstream `SKILL.md` semantics into it, then verify that the local routing and security boundaries remain intact.

After changing the overlay, regenerate the repository knowledge catalog with `node knowledge/build-index.mjs` and commit the generated `knowledge/index.json` and `knowledge/INDEX.md` outputs.

Target-only evaluation or integration files are local Agent Hub assets and are not evidence of vendor drift.
