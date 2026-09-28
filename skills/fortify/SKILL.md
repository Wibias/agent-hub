---
name: fortify
description: >
  Harden designs for real-world use outside the happy path: state inventories,
  error recovery, empty/loading/offline states, first-run, stress tests,
  i18n readiness, and latency. Use for edge cases, "what happens when",
  "what if the user", harden this design, or failure-mode review.
version: 1.3.0
user-invocable: true
---

# Fortify

The happy path is not enough. Enumerate every real state, then design recovery
with the same care as the default mockup.

Activate for edge-case reviews, empty/error/loading design, first-run,
offline, i18n readiness, stress tests, or "but what happens when...".

## Skill family

- Flow happy path: `intent` + `references/interaction-patterns.md`
- System fail points: `intent` + `references/service-design.md`
- Accessibility overlap: `intent` + `references/accessibility-foundations.md`
- Copy in each state: `intent` + `references/content-strategy.md`
- Spec handoff: `intent`

Those skills/files define the path. This skill stress-tests it. Missing
Intent-family names (`journey`, `include`, `articulate`, `philosopher`) are
not installed.

## Method

1. Inventory states for every screen or component.
2. For each non-default state: what the user sees, what they can do, how they recover.
3. Design error recovery, first-run, i18n readiness, and latency handling.
4. Run the stress prompts. Prioritize data-loss and stuck-user failures.

Load `references/capabilities.md` for the catalogs and patterns. Load
`references/output-and-scope.md` before writing the report.

## References

| File | Load when |
|---|---|
| `references/capabilities.md` | state inventory, recovery, first-run, stress, i18n, latency |
| `references/output-and-scope.md` | report shape, voice, ownership bounds |
