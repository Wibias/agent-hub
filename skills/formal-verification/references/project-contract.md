# Project Formal Verification Contract

Project-local formal verification must remain understandable and rerunnable by an
agent that did not create it.

## Location

Prefer a project-local skill under:

```text
<project>/.agents/skills/formal-verify-<area>/
```

Do not use the `verify-*` prefix reserved by Agent Hub runtime-verification
routing. Formal verification is not a substitute for driving the real
application.

## Statechart capability

For TLA+/TLC-backed state-machine visualization and concrete counterexample
paths, read `statechart.md`. `formal-verification` remains the proof and verdict
owner; the nested Statechart compiler is an interpretation and visualization
capability, not a second routing owner.

For a TLA+/TLC handoff, use the shared Statechart reference when a state-machine
view materially helps the reader: surface the shortest readable path for each
reported violation and use the generated state-machine overview when the
compiler emits one. The current compiler consumes a TLA+ model; it does not turn
a Mermaid chart into a TLA+ skeleton and it does not provide the removed
`--against` or `--fixed` comparison modes. Keep release-sensitive commands,
options, runtime requirements, and output behavior in `statechart.md` instead of
copying them into a project-local verifier.

## Required record

The project-local `SKILL.md` or a directly linked one-level reference must state:

- **Property:** one plain-language sentence describing what must hold.
- **Harm:** one sentence describing what failure means to users or the system.
- **Covered code:** concrete repository-relative files and functions/state
  transitions represented by the verification.
- **Verification form:** model checker, proof, SMT/native verifier, or generated
  real-code input check, plus the reproducible tool version when material.
- **Command:** the exact project-root command that reruns the check.
- **Bounds and assumptions:** every bound or environmental assumption that limits
  what a pass proves.
- **Sync commit:** the full Git commit last confirmed to match the covered code.
- **Failure-sensitivity check:** the reversible break used to show the check can
  actually fail on the protected behavior.
- **Maintenance rule:** covered-code changes require a source diff from the sync
  commit and a fresh in-sync/updated/bug/blocked judgment.

Keep model/proof/harness files adjacent to the project-local skill or at a stable
project-owned path the skill names directly. Do not hide required state in a
conversation transcript.

## Truth hierarchy

The current covered code defines how the implementation behaves. Requirements,
contracts, tests, ADRs, and other repository evidence may define what it is
supposed to promise. The verification describes those two surfaces; it does not
become the source of truth merely because it passes.

Write verification updates from the code before rerunning. A passing result is
not permission to distort the model, shrink a bound without disclosure, or
weaken the property.

## Sync semantics

Advance the sync commit only after the verification has been checked against the
target code and all required update steps ran. `in sync`, `updated`, and `bug`
may advance when the verification accurately describes that target commit.
`blocked` never advances the sync commit.

When an intended property changes, cite the repository evidence for that change
and preserve the old/new wording in the maintenance report.

## Product-code boundary

Creation may use a reversible scratch mutation to prove failure sensitivity.
Maintenance otherwise keeps product code read-only unless the user separately
authorizes a product fix. A feasible counterexample is a finding, not permission
to edit the implementation or weaken the property.
