# Floor guard

Adapted from `addyosmani/agent-skills` `constraint-driven-development/references/floor-guard.md` (MIT).

The guard protects the quality contract itself. It is a **diff-scoped lead generator and blocker for mechanically clear bar-lowering moves**, not a replacement for semantic review.

## Contract

Input is the complete candidate change against the intended base, including staged, unstaged and untracked files when applicable.

Detect at minimum:

1. **Silenced checker** - newly added `@ts-ignore`, `eslint-disable`, `# noqa`, `# type: ignore`, coverage/mutation/security suppressions or repository-equivalent forms.
2. **Test made easier** - newly skipped/todo tests, deleted tests, or removed assertions. Treat as a finding to reconcile against an explicit accepted reason; do not assume every deletion is wrong.
3. **Unfinished work** - obvious not-implemented stubs, empty catches that swallow failure, or project-defined placeholders in production paths.
4. **Contract weakened** - lowered blocking threshold, removed gate, warning substituted for block, or equivalent reduction.
5. **Exception broadened** - new or expanded exception without the contract-required reason/owner/removal condition.

## Exit semantics for a deterministic project guard

- `0`: no mechanical floor violation found.
- `1`: one or more confirmed mechanical floor violations.
- `2`: guard could not establish its base/input or otherwise could not run reliably.

Exit `2` is **blocked**, never clean.

## Implementation rules

- Reuse repository-native diff/parsing tooling before creating a custom checker.
- Never print matched secret values. Report rule and location only.
- Do not use one universal regex list as semantic truth across all languages. Adapt suppression/stub patterns to the project.
- Do not force-add an ignored diagnostic artifact merely to retain it; persistent outputs require an explicit repository contract.
- The guard must not automatically reject legitimate removal of obsolete tests or constraints when the same change proves the requirement disappeared. Surface the delta for reconciliation.
