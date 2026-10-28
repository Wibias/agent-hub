# Video Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `video-production` as Agent Hub's canonical authored-video owner with deterministic renderer selection, product-promo methodology, routing coverage, and release validation.

**Architecture:** One top-level skill owns the workflow. HyperFrames and Remotion are renderer backends described by focused references, while video-shotcraft contributes product-promo and shot-selection methodology. Existing UI motion, browser recording, transcript extraction, and current-source grounding stay with their existing owners.

**Tech Stack:** Agent Skills Markdown, JSONL routing/eval cases, Node.js Skill Ratchet and catalog validators, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-28-video-production.md`

## Global Constraints

- Do not vendor HyperFrames, Remotion, or video-shotcraft source trees.
- Explicit renderer choice and an existing project renderer override defaults.
- New standalone authored video defaults to HyperFrames only when no renderer is already selected.
- Remotion licensing must be surfaced as an execution-time concern, not copied into a local substitute licence.
- Product design truth remains project-native or owned by `design-with-ai`; video-production must not create a competing token system.
- UI motion remains owned by `design-with-ai/motion-build`.

## Review Focus

- A generic UI animation request must continue routing to `design-with-ai`, not `video-production`.
- Browser session recording must continue routing to `playwright` when recording is the task rather than authored film production.
- Existing Remotion projects must not be silently migrated to HyperFrames.
- Explicit HyperFrames or Remotion choice must override the default renderer rule.
- Source-only inspection must never be reported as a completed render.

---

### Task 1: Lock discovery ownership with failing routing cases

**Files:**
- Modify: `tests/skill-catalog/catalog-routing.jsonl`

**Interfaces:**
- Consumes: existing catalog routing scorer.
- Produces: deterministic discovery expectations for the new top-level owner and neighboring negative boundaries.

- [ ] **Step 1: Add failing positive routing cases** for product promo, launch film, and authored explainer requests expecting `video-production`.
- [ ] **Step 2: Add boundary cases** keeping ordinary UI motion with `design-with-ai` and browser session recording with `playwright` or no new owner as appropriate.
- [ ] **Step 3: Run catalog audit in CI and verify RED** because `video-production` does not exist yet.
- [ ] **Step 4: Commit the test-only change.**

### Task 2: Add the canonical video-production skill

**Files:**
- Create: `skills/video-production/SKILL.md`
- Create: `skills/video-production/UPSTREAM.md`
- Create: `skills/video-production/references/renderer-selection.md`
- Create: `skills/video-production/references/product-promo.md`
- Create: `skills/video-production/references/verification.md`
- Create: `skills/video-production/tests/evals/cases.jsonl`
- Create: `skills/video-production/tests/evals/regression-cases.jsonl`
- Create: `skills/video-production/tests/evals/regression-lock.json`

**Interfaces:**
- Consumes: project evidence, explicit renderer choice, existing design authority, existing neighboring skill ownership.
- Produces: `video-production` discovery surface and progressive references for renderer selection, promo craft, and verification.

- [ ] **Step 1: Implement minimal `SKILL.md`** that satisfies the routing cases and names neighboring owners.
- [ ] **Step 2: Add renderer-selection reference** with explicit-choice -> existing-stack -> Remotion-specialized -> HyperFrames-default ordering.
- [ ] **Step 3: Add product-promo reference** with selectively adapted Shotcraft rules.
- [ ] **Step 4: Add verification reference** that separates preview/frame evidence from final-render evidence and blocked execution.
- [ ] **Step 5: Add Skill Ratchet acceptance cases** for positive, negative, authority, and unavailable-tool behavior.
- [ ] **Step 6: Run catalog audit and Skill Ratchet structural validation; verify GREEN.**
- [ ] **Step 7: Commit.**

### Task 3: Wire release governance and documentation

**Files:**
- Modify: `.github/workflows/verify-skill-routing.yml`
- Modify: `README.md`
- Regenerate: `knowledge/INDEX.md`
- Regenerate: `knowledge/index.json`

**Interfaces:**
- Consumes: completed `video-production` skill tree.
- Produces: release validation, user-facing discovery documentation, and current generated index.

- [ ] **Step 1: Add structural validation for `skills/video-production`.**
- [ ] **Step 2: Add the skill to README under a dedicated media/video section or the nearest existing tooling section without creating duplicate ownership language.**
- [ ] **Step 3: Regenerate the knowledge index.**
- [ ] **Step 4: Run the full release-governance workflow and inspect every failed step.**
- [ ] **Step 5: Commit generated/documentation changes.**

### Task 4: Whole-branch verification

**Files:**
- No planned production files beyond fixes required by verification.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: merge-ready PR evidence or an explicit blocked list.

- [ ] **Step 1: Run/observe full PR CI.**
- [ ] **Step 2: Inspect routing results for ambiguity with `design-with-ai`, `playwright`, and source-related skills.**
- [ ] **Step 3: Run Skill Ratchet qualification as far as the available model-review surface permits; do not fake missing independent receipts.**
- [ ] **Step 4: Review the final diff and fix Critical/Important findings once.**
- [ ] **Step 5: Leave the PR unmerged.**
