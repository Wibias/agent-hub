# Motion implementation plan template

Each plan must be self-contained for an executor with no conversation context.

```markdown
# NNN - <Imperative title>

- **Status**: TODO
- **Commit**: <short SHA when authored>
- **Severity**: HIGH | MEDIUM | LOW
- **Category**: <audit category>
- **Estimated scope**: <files and rough size>

## Problem

Explain what is wrong, where, and why it affects feel. Cite every location as
`path:line` and include the exact current excerpt.

## Target

State the precise end state with exact curves, durations, spring values, media
queries, and code shape from the canonical standards.

## Repository conventions

Name the existing token locations and one correct exemplar the executor must
follow.

## Steps

1. One concrete edit per step, including file and resulting behaviour.

## Boundaries

- List files and behaviours that must not change.
- Do not add dependencies unless explicitly authorised.
- Stop on code drift instead of improvising.

## Verification

- **Mechanical**: exact commands and expected results.
- **Feel check**: exact route, interaction, playback-speed inspection,
  interruptibility check, and reduced-motion check.
- **Done when**: observable completion criteria.
```

Use one plan per finding unless multiple findings share the same files and fix
pattern. Maintain `plans/README.md` with number, title, severity, status,
dependencies, and recommended order.
