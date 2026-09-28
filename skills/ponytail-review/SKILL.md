---
name: ponytail-review
description: >-
  Specialist cut-list-only over-engineering review. Use only when the user explicitly names ponytail-review or invokes /ponytail-review. Finds what to delete, what stdlib or platform features replace, and speculative abstractions with no second caller, without applying edits. Not for ordinary cleanup or generic complexity review; use simplify.
---

# Ponytail Review

Review for unnecessary complexity. One line per finding: location, what to cut, what replaces it. The diff's best outcome is getting shorter.

## Scope modes

Pick one mode from the user's request. Default is `branch changes`.

| Mode | Trigger examples | What is reviewed |
|------|------------------|------------------|
| `branch changes` | `/ponytail-review`, no scope given | Merge-base diff vs default branch (committed + staged + unstaged) |
| `uncommitted changes` | "only uncommitted", "dirty work only" | Local working tree vs HEAD |
| `full repo` | "full repo", "whole codebase", "entire project" | All source in repo or subtree — see [references/full-repo-scope.md](references/full-repo-scope.md) |
| `full repo` + path | "full repo src/auth", `path: src/` | Only that directory subtree |

For diff modes: get the diff with git before reviewing.

For `full repo`: do not use git diff; scan per [references/full-repo-scope.md](references/full-repo-scope.md). Warn on very large trees and suggest narrowing unless the user insists.

Do not apply fixes unless the user asks.

## Format

`file:L..`, or `file:L: ...` for multi-file diffs.

Tags:

- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library ships. Name the function.
- `native:` dependency or code doing what the platform already does. Name the feature.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.

## Examples

❌ "This EmailValidator class might be more complex than necessary, have you considered whether all these validation rules are needed at this stage?"

✅ `L12-38: stdlib: 27-line validator class. "@" in email, 1 line; real validation is the confirmation mail.`

✅ `L4: native: moment.js imported for one format call. Intl.DateTimeFormat, 0 deps.`

✅ `repo.py:L88: yagni: AbstractRepository with one implementation. Inline it until a second one exists.`

✅ `L52-71: delete: retry wrapper around an idempotent local call. Nothing replaces it.`

✅ `L30-44: shrink: manual loop builds dict. dict(zip(keys, values)), 1 line.`

## Scoring

End with the only metric that matters: `net: -N lines possible.` (estimated OK for full repo)

If there is nothing to cut, say `Lean already. Ship.` and stop.

## Boundaries

Complexity only. Correctness bugs, security holes, and performance go to a normal review pass, not this one. A single smoke test or `assert`-based self-check is the ponytail minimum, not bloat — never flag it for deletion. Does not apply the fixes, only lists them.

"stop ponytail-review" or "normal mode": revert to verbose review style.
