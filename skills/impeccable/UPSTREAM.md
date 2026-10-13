# Impeccable upstream

Agent Hub vendors the Impeccable skill from `pbakaus/impeccable`.

## Current pin

- Upstream commit: `245ad82def45831dc56a21b683c7a1ff530b06cc`
- Skill version: `4.5.2`
- Engine version: `0.1.14`
- Refreshed: `2026-10-13`

## Sync contract

Files shared with upstream under `.agents/skills/impeccable/` should remain byte-identical under `skills/impeccable/`, except `SKILL.md`.

`SKILL.md` is an intentional Agent Hub overlay. It preserves upstream Impeccable workflow semantics while adding the local explicit-only discovery boundary, repository-content instruction-injection handling, stricter launcher failure evidence, competing-skill classification, and Skill Ratchet qualification references.

Do not replace that overlay wholesale during an upstream refresh. Merge new upstream `SKILL.md` semantics into it, then verify that the local routing and security boundaries remain intact.

Target-only evaluation or integration files are local Agent Hub assets and are not evidence of vendor drift.
