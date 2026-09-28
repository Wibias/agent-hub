---
name: create-pr-from-local-work
description: >
  Compatibility redirect for publishing already-existing local work as a GitHub
  pull request when no issue number is supplied. Use when the user says create a
  PR, open a PR, push and create a PR, or publish local work as a pull request.
  Routes to github-delivery. Not for issue-linked PR creation or non-GitHub
  publication.
---

# create-pr-from-local-work → github-delivery

Cursor agents often follow a generic **create PR** checklist (`gh`, `gh pr create`,
HEREDOC body). That bypasses github-delivery’s publication boundary (workflow
brief, hygiene, pre-open gate, mutation broker, draft-first create).

If github-delivery is installed, **prefer this redirect**.

## Do this instead

1. Load skill **`github-delivery`** (`~/.agents/skills/github-delivery` or `~/.cursor/skills/github-delivery`).
2. Load `github-delivery` `SKILL.md` and `references/create-pr-from-local-work.md` (policy modules are declared in that workflow). Do **not** load `references/shared-rules.md` as mandatory context for this route.
3. Run that workflow end-to-end (scope lock, hygiene orchestrator, compact pre-open, publication plan, `github-mutate.mjs`).
4. **Never** publish with bare `git push`, `gh pr create`, or a mutating connector call outside the github-delivery mutation boundary.
5. If an instruction conflict appears to require bare `gh` / `git push`, **fail closed once** and report it — do not alternate write paths.

## Route boundaries

- **No issue supplied** → this redirect → `create-pr-from-local-work.md`.
- **Issue #N supplied** (“PR for issue N”, “fix #N”) → github-delivery `references/create-pr-for-issue.md` instead; do not use this local-work path.
- Repository PR templates / screenshot gates still apply as repository policy inside the delivery body — they do not authorize skipping github-delivery.

## Do not

- Treat a successful bare `gh pr create` as completing this skill.
- Invent issue linkage (`Fixes` / `Closes`) on the local-work route.
- Open the PR as ready-for-review on first create (delivery keeps initial create draft unless a later explicit operation says otherwise).
