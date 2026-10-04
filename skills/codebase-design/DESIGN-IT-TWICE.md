# Design It Twice

Based on "Design It Twice" (Ousterhout): the first interface idea is unlikely
to be the best. Generate multiple radically different designs, then compare.

This file owns the former `design-an-interface` workflow. Use the vocabulary in
[SKILL.md](SKILL.md) — **module**, **interface**, **seam**, **adapter**,
**leverage**, **locality**. This is software module interface design (what
callers see), not visual UI. For visual frontend work use `design-with-ai` or
`impeccable`.

Do not implement. This pass is about interface shape only.

## When to run

- Standalone: the user wants a module API, calling-pattern comparison, or says
  "design it twice".
- After `improve-codebase-architecture`: the user picked a deepening candidate
  and now wants alternative interfaces for that module.

## Process

### 1. Gather requirements

Before spawning sub-agents, pin:

- [ ] What problem does this module solve?
- [ ] Who are the callers? (other modules, external users, tests)
- [ ] What are the key operations?
- [ ] Any constraints? (performance, compatibility, existing patterns)
- [ ] What should be hidden inside vs exposed?

If this follows an architecture scan, also write a user-facing problem-space
note: constraints any new interface must satisfy, dependency categories from
[DEEPENING.md](DEEPENING.md), and a rough illustrative sketch that is not a
proposal. Show that note, then immediately proceed to Step 2 so the user can
read while sub-agents work.

### 2. Generate designs (parallel sub-agents)

Spawn 3+ sub-agents. Each must produce a **radically different** interface.
If no runner is available, run isolated sequential passes. Difference matters
more than parallelism.

Give each agent a different constraint:

- Agent 1: "Minimize the interface — 1–3 entry points max. Maximise leverage per entry point."
- Agent 2: "Maximise flexibility — support many use cases and extension."
- Agent 3: "Optimise for the most common caller — make the default case trivial."
- Agent 4 (if useful): "Design around ports and adapters for cross-seam dependencies" or take inspiration from a named paradigm.

Include both [SKILL.md](SKILL.md) vocabulary and the project's `CONTEXT.md`
domain language in each brief.

Each sub-agent outputs:

1. Interface (types, methods, params — plus invariants, ordering, error modes)
2. Usage example showing how callers use it
3. What the implementation hides behind the seam
4. Dependency strategy and adapters when [DEEPENING.md](DEEPENING.md) applies
5. Trade-offs — where leverage is high, where it is thin

### 3. Present and compare

Present designs sequentially so the user can absorb each one, then compare them
in prose. Contrast by:

- **Depth** / leverage at the interface
- **Locality** — where change concentrates
- **Seam placement**
- **Ease of correct use** vs ease of misuse
- **Implementation efficiency** — does the shape allow efficient internals?
- **Agent resistance** — does the shape avoid split ownership, duplicate ways to
  perform one task, importable internals, and hand-synced lists/registries?

For agent resistance, judge the candidate from one file at a time. Ask whether a
contributor following the nearest local example can accidentally create a
globally inconsistent state while still compiling and passing obvious checks.

Do not score on implementation effort. After comparing, give a recommendation.
If elements from different designs combine well, propose a hybrid. Be
opinionated.

Ask: which design fits the primary use case, and whether any element from
another design should be kept.

## Anti-patterns

- Do not let sub-agents produce similar designs — enforce radical difference
- Do not skip comparison — the value is in contrast
- Do not implement
- Do not evaluate based on implementation effort
- Do not accept duplicate ownership or duplicate task paths merely because both
  are documented
- Do not rely on "contributors should know not to import this" when the module can
  make the internal path unreachable
- Do not keep hand-synced registries when one source of truth or a deterministic
  consistency check can own the invariant
