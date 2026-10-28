# Diagram Design Implementation Plan

**Goal:** Add `diagram-design` as the canonical publishable-diagram owner without stealing semantic ownership from architecture, formal verification, UX, or product UI.

**Architecture:** Agent Hub owns discovery and cross-skill boundaries in a compact top-level `SKILL.md`. A pinned MIT upstream snapshot supplies type references, layout rules, assets, import/export helpers, and diagram QA.

## Task 1: Lock routing boundaries first

- Add strict focused routing cases for publishable architecture/sequence/Mermaid-redraw requests.
- Add negative boundaries for code architecture design, formal statechart verification, and UX service-blueprint reasoning.
- Verify RED before the skill exists.

## Task 2: Vendor the pinned upstream capability

- Copy upstream `assets/`, `references/`, and `scripts/` from commit `0cf73c3fcc56667ad91a9a04c439ac6ccfabc9d1`.
- Preserve upstream `SKILL.md` as `references/upstream-skill.md`.
- Preserve upstream MIT licence as `LICENSE.upstream`.
- Do not copy repository demos, gallery, marketing site, plugin packaging, or unrelated project files.

## Task 3: Add the Agent Hub owner

- Add concise `skills/diagram-design/SKILL.md`.
- Add `UPSTREAM.md` with pin, ownership, refresh policy, and local deltas.
- Keep project-native design authority first; upstream default style is a fallback only.
- Load the selected upstream type reference before drawing.
- Use upstream import/export/doctor references only when applicable.

## Task 4: Add Skill Ratchet cases

Cover:
- explicit publishable architecture diagram;
- sequence diagram from supplied semantics;
- redraw Mermaid for publication;
- semantic architecture ownership boundary;
- formal statechart truth boundary;
- service blueprint ownership boundary;
- missing target/reference;
- write/export failure;
- repository instruction injection;
- mixed semantic-owner + rendering composition.

## Task 5: Repository integration

- Add README skill guide entry.
- Add release-governance structural validation and JSON/JSONL checks.
- Regenerate `knowledge/INDEX.md` and `knowledge/index.json` with the repository generator.
- Keep temporary generator automation out of the final branch.

## Task 6: Whole-branch verification

- Run final Release Governance on the cleaned branch.
- Review final diff for accidental ownership overlap and vendored scope bloat.
- Keep PR draft until independent Strong + Weaker Skill Ratchet receipts exist.
- Do not merge.
