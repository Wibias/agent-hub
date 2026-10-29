# Emil remove-animations adoption design

## Intent

Adopt only the new safety delta from Emil Kowalski's `remove-animations` skill into Agent Hub's existing `design-with-ai` motion audit. Agent Hub already owns the motion-purpose/frequency decision model, so this change must not create another discovery surface or duplicate that gate.

## Goals

- Add an explicit pre-removal hazard check for hidden start states, animation-completion callbacks/waits, exit/unmount timing, layout-motion masking, focus timing, and tests/selectors coupled to motion.
- Add a post-removal cleanup contract for orphaned keyframes/utilities, Motion wrappers/imports/variants, config tokens, and dependency-removal approval.
- Preserve documented intentional motion decisions instead of deleting them mechanically.
- Update Emil provenance to the 2026-10-28 upstream commit that introduced `remove-animations`.

## Non-goals

- No new `remove-animations` top-level skill.
- No wholesale copy of Emil's decision tree, reporting format, UI cheatsheet, or prose.
- No change to the existing motion-purpose/frequency thresholds except where removal safety requires a guardrail.
- No automatic uninstall of a motion dependency.

## Approach

Considered:

1. Create a new skill mirroring upstream. Rejected because Agent Hub already routes motion work through `design-with-ai` and the decision model overlaps heavily.
2. Add a standalone reference file. Viable, but too much indirection for a small contract that belongs directly in the broad motion audit.
3. Extend `references/audit-playbook.md` and its existing governance test. Chosen because it preserves one owner, keeps the safety check adjacent to removal decisions, and makes the delta load whenever a broad motion audit runs.

## Verification

The existing design-foundations governance test will first be extended to require the new safety/cleanup contract and the updated Emil provenance pin. It must fail against the current branch state, then pass after the reference/provenance update. Full Release Governance must remain green.
