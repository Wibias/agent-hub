# Emil Removal Safety Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `design-with-ai` with Emil's new animation-removal safety and cleanup delta without creating a duplicate motion owner.

**Architecture:** Keep `design-with-ai` as the only discovery surface. Add the removal hazard and cleanup contract directly to `references/audit-playbook.md`, update Emil provenance in `UPSTREAM.md`, and pin both through the existing design-foundations governance test.

**Tech Stack:** Markdown guidance, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-29-emil-remove-animations-adoption.md`

## Global Constraints

- No new top-level `remove-animations` skill.
- Preserve existing motion-purpose/frequency rules.
- Do not copy the upstream skill wholesale.
- Do not automatically remove a motion dependency.
- Upstream source commit: `a81dbca07f2217b7103e510c0f13f8d5b017afc9`.

## Review Focus

- Removing motion must not leave hidden initial states behind.
- Removing exit motion must not strand unmount/focus/callback behavior.
- Layout motion that hides a real layout shift must not be deleted blindly.
- Cleanup must remove only artifacts orphaned by the approved removal.
- Dependency removal must remain proposal/approval gated.

---

### Task 1: Pin the removal-safety contract

**Files:**
- Modify: `skills/design-with-ai/tests/design-foundations-refresh.test.mjs`
- Modify: `skills/design-with-ai/references/audit-playbook.md`
- Modify: `skills/design-with-ai/UPSTREAM.md`

**Interfaces:**
- Consumes: existing broad motion-audit route and Emil provenance row.
- Produces: a tested removal-safety/cleanup contract inside the existing owner.

- [ ] **Step 1: Write the failing test**

Extend the existing design-foundations test to assert that `audit-playbook.md` covers hidden start states, completion callbacks/waits, exit/unmount timing, layout-motion masking, focus timing, motion-coupled tests/selectors, orphan cleanup, and approval before dependency removal; assert `UPSTREAM.md` pins Emil commit `a81dbca07f2217b7103e510c0f13f8d5b017afc9` and records the `remove-animations` delta.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/design-with-ai/tests/design-foundations-refresh.test.mjs`
Expected: FAIL because the current audit playbook lacks the new removal-safety contract and provenance still points to the previous Emil snapshot.

- [ ] **Step 3: Implement the minimal guidance/provenance update**

Add a compact `Removal safety and cleanup` section to `audit-playbook.md`; update only the Emil row and consolidation note needed to record the selective adoption.

- [ ] **Step 4: Run targeted test to verify it passes**

Run: `node --test skills/design-with-ai/tests/design-foundations-refresh.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run full repository governance**

Run: the repository's Release Governance workflow on the branch.
Expected: PASS.

- [ ] **Step 6: Commit and open the follow-up PR**

Use an isolated branch and include the upstream commit plus selective-adoption rationale in the PR body.
