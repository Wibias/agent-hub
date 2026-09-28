---
name: simplify
description: >-
  Canonical default owner for ordinary code cleanup and simplification across branch or uncommitted changes: over-engineering review, YAGNI/dead-code cuts, readability and reuse cleanup, and small behavior-preserving simplifications. Use for ordinary requests to simplify, shrink, clean up, review complexity, or ask what can be deleted. Not for explicit /ponytail-review or code-simplification invocations.
---

# Simplify

## Choose the mode

| Mode | User signal | Action |
|---|---|---|
| `review` | "cut list", "what can we delete", "no edits" | Return a cut list only. Do not edit. |
| `apply` | "apply cleanup", "skip the cut list", "readability only" | Apply small behavior-preserving edits. Do not run a discovery scan. |
| `full` | "review then simplify", "clean up this branch", edit-authorized `/simplify` | Review, select, apply, verify. |

If edit authority is ambiguous, choose `review`.

## Set scope

Honor explicit paths and scope. Otherwise:

- `branch changes`: merge-base diff plus staged, unstaged, and untracked work;
- `uncommitted changes`: working tree versus `HEAD`;
- `full repo`: only when explicitly requested.

Read repository instructions and neighboring code. Exclude generated files,
lockfiles, dependencies, and unrelated work. Split independent concerns into
disjoint packets with exclusive file ownership.

## Review

Do the cut list in this file. Do not load `ponytail-review` unless the user names that skill.

Return only high-confidence findings, one line each:

- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library ships. Name the function.
- `native:` dependency or code doing what the platform already does. Name the feature.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.

Format: `file:L..`, or `file:L: ...` for multi-file diffs. End with `net: -N lines possible.` If there is nothing to cut, say `Lean already. Ship.` and stop. Do not edit in review mode.

## Apply

Do the edits in this file. Do not load `code-simplification` unless the user names that skill.

Accept only clear, small, local changes: equivalent guard clauses, clearer
names, proven dead-code removal, identical-semantic helper reuse, and local
deduplication.

Preserve behavior, errors, ordering, APIs, UI, and edge cases. Skip uncertainty,
line-count tricks, new abstractions, test rewrites, and unrelated refactors.

## Full

Define scope, packets, and verification. Run `review` without editing, select
clear in-scope findings, run `apply`, verify each packet, then inspect the final
diff.

Run a second `review` only if apply changed more than one packet or introduced
a new abstraction.

## Verify edits

Derive commands from the repository; never invent a green gate. Run focused
tests, relevant build/typecheck/lint or UI smoke, and available diff hygiene.
Report exact commands, results, skipped gates, and uncertainty.

A failed required check prevents a success claim. Revert only this pass's unsafe
edit, never unrelated user work.

## Roles

| Skill | Owns |
|---|---|
| **ponytail-review** | Named cut-list-only requests |
| **code-simplification** | Named readability-refactor requests |
| **simplify** | Ordinary cleanup: mode selection, cut list, edits, and verify |

## Common mistakes

- Never load `ponytail-review` or `code-simplification` on an ordinary simplify run.
- Never run three reviews, edit in `review`, expand scope, overlap files, or chase line count.
- Never claim success after a skipped or failed gate.

## References

Do not read evaluation fixtures during ordinary cleanup or capability routing.
They are only for evaluating this skill.

<!-- eval:references -->
- tests/evals/cases.jsonl -- when to read: before discovery, execution, or adversarial evaluation
- tests/evals/regression-cases.jsonl -- when to read: before rerunning or appending retained regressions
- tests/evals/regression-lock.json -- when to read: when validating immutable retained regressions
<!-- /eval:references -->
