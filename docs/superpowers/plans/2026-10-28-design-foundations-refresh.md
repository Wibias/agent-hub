# Design Foundations Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh `design-with-ai` with bounded perceptual design fundamentals and current `ui-ux-pro-max` guidance governance without adding a new discovery surface or stereotype-driven design corpus.

**Architecture:** Keep `design-with-ai` as the canonical owner and add only progressive references/contract edits. Upgrade `knowledge/design-guidance` in place with explicit snapshot/freshness metadata and deterministic relevance regressions. Preserve the existing evidence hierarchy and project-native design authority.

**Tech Stack:** Markdown skill contracts, Node.js ESM tests/scripts, JSON catalog, PowerShell structural validation.

**Spec:** `docs/superpowers/specs/2026-10-28-design-foundations-refresh.md`

## Global Constraints

- No new top-level design skill.
- No product-category-to-style/palette/font/motion mappings.
- Practitioner material is guidance/inspiration, not tested usability evidence.
- Existing project design authority outranks generic upstream guidance.
- Existing `design-with-ai` routing ownership and Penpot boundaries remain unchanged.
- Upstream `ui-ux-pro-max-skill` snapshot is `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03`.

## Review Focus

- Category words such as `SaaS`, `luxury`, `public-sector`, or `AI` must not assign dial values by themselves.
- A stale guidance catalog must not be reported as verified/current guidance.
- Relevance regression cases must fail if the top result silently changes.
- Perceptual checks must remain diagnostics, not claims of usability proof.
- Durable imagery/AI-asset rules must extend existing design truth rather than create a parallel source of truth.

---

### Task 1: Pin the new contracts with failing tests

**Files:**
- Create: `skills/design-with-ai/tests/design-foundations-refresh.test.mjs`
- Create: `knowledge/design-guidance/tests/relevance-cases.json`
- Modify: `knowledge/design-guidance/tests/query.test.mjs`

**Interfaces:**
- Consumes: current skill/reference/catalog files.
- Produces: deterministic assertions for the new contracts and retrieval cases.

- [ ] **Step 1: Write failing skill-contract tests**

Assert that:
- `perceptual-hierarchy.md` exists and names proximity, similarity, figure/ground, continuity, visual-weight/semantic-priority, and blur/thumbnail diagnostic boundaries;
- `dials.md` does not contain the old category/signal preset headings and explicitly requires evidence-derived calibration;
- `durable-design-contract.md` covers imagery grammar, positive/negative examples, AI-generated imagery constraints, and no parallel design truth;
- `taste-workflow.md` operationalizes desired/avoid vocabulary and maps words to observable choices.

- [ ] **Step 2: Write failing guidance-governance tests**

Assert that catalog schema/source metadata contains the new upstream snapshot, `reviewedAt=2026-10-28`, freshness policy, and query output includes freshness status. Add a hard-expiry test using an injected clock value so stale guidance fails closed.

- [ ] **Step 3: Add relevance cases and regression test**

Create representative domain/query -> expected top-ID cases for chart, native, interaction, text-layout, and accessibility; loop over them and assert the top result remains stable.

- [ ] **Step 4: Run only the new/modified tests and verify RED**

Run the relevant Node test files. Expected: failures for missing perceptual reference, old dial presets, old catalog snapshot/freshness behavior, and missing imagery/visual-intent contracts.

### Task 2: Implement perceptual hierarchy and visual-intent guidance

**Files:**
- Create: `skills/design-with-ai/references/perceptual-hierarchy.md`
- Modify: `skills/design-with-ai/references/baseline-ui.md`
- Modify: `skills/design-with-ai/references/taste-workflow.md`
- Modify: `skills/design-with-ai/references/core-design-workflow.md`
- Modify: `skills/design-with-ai/SKILL.md`

**Interfaces:**
- Consumes: existing Direction -> Baseline -> Craft -> Gate workflow.
- Produces: progressive perceptual diagnostic and operational visual-intent language.

- [ ] **Step 1: Add the bounded perceptual reference**

Cover proximity/common region, similarity/semantic consistency, connectedness/continuity, figure/ground, visual weight versus semantic priority, competing accents, and the blur/thumbnail check as a diagnostic only.

- [ ] **Step 2: Wire it progressively**

Load it when hierarchy/grouping/salience is materially unresolved, and reference it from Baseline and the SKILL reference map/eval references without making it a second router.

- [ ] **Step 3: Add operational visual-intent vocabulary**

In Direction/visual-world work, require desired terms, avoid terms, a tension statement, and observable mappings/refusals; reject unqualified `modern/clean/premium/sleek` as sufficient rationale.

- [ ] **Step 4: Re-run the focused skill-contract test**

Expected: perceptual and visual-intent assertions PASS.

### Task 3: Clean up design dials and strengthen durable design truth

**Files:**
- Modify: `skills/design-with-ai/references/dials.md`
- Modify: `skills/design-with-ai/references/durable-design-contract.md`
- Modify: `skills/design-with-ai/UPSTREAM.md`

**Interfaces:**
- Consumes: existing three dial names and durable contract authority rule.
- Produces: evidence-derived dial calibration and broader cross-surface imagery/asset contract.

- [ ] **Step 1: Remove category/signal dial presets**

Keep only `DESIGN_VARIANCE`, `MOTION_INTENSITY`, `VISUAL_DENSITY`; derive values from explicit user direction, incumbent measurements, inspected references, or an explicitly selected direction. Unresolved material choices expose alternatives.

- [ ] **Step 2: Extend durable contract**

Add optional imagery grammar, logo/asset constraints, icon/illustration grammar, prohibited motifs, positive/negative examples, and AI-generated-image constraints while preserving project-native authority.

- [ ] **Step 3: Refresh provenance**

Update `UPSTREAM.md` to the current `ui-ux-pro-max` commit and record the Webdesign Journal concepts as selectively adapted practitioner guidance, not copied corpus/evidence.

- [ ] **Step 4: Re-run focused contract tests**

Expected: dial and durable-contract assertions PASS.

### Task 4: Upgrade guidance freshness and relevance governance

**Files:**
- Modify: `knowledge/design-guidance/catalog.json`
- Modify: `knowledge/design-guidance/scripts/query.mjs`
- Modify: `knowledge/design-guidance/UPSTREAM.md`
- Modify: `skills/design-with-ai/references/design-guidance.md`
- Test: `knowledge/design-guidance/tests/query.test.mjs`
- Test: `knowledge/design-guidance/tests/relevance-cases.json`

**Interfaces:**
- Consumes: current bounded keyword-scoring query API.
- Produces: freshness-aware query results and stable relevance regression fixtures.

- [ ] **Step 1: Upgrade catalog metadata**

Set schema version 2, current upstream snapshot/review date, and explicit review/hard-expiry windows. Keep the existing bounded domains only.

- [ ] **Step 2: Implement freshness behavior**

Compute freshness from `reviewedAt` and an optional deterministic environment clock for tests. Include status/age in JSON provenance. If beyond hard expiry, return a distinct non-zero stale-catalog result before ranking.

- [ ] **Step 3: Document exit/fallback behavior**

Update `design-guidance.md` so stale guidance cannot be claimed as verified and must fall back to current standards/project evidence.

- [ ] **Step 4: Run guidance tests**

Expected: freshness, no-match, domain isolation, forbidden-domain, and relevance regressions all PASS.

### Task 5: Full verification and PR

**Files:**
- Potentially regenerate: `knowledge/INDEX.md`, `knowledge/index.json` only if frontmatter/indexed content requires it.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: reviewable branch with green governance evidence.

- [ ] **Step 1: Run complete design-with-ai tests**

Run `pwsh -File skills/design-with-ai/tests/validate.ps1` and `node --test skills/design-with-ai/tests/*.test.mjs` plus `node --test knowledge/design-guidance/tests/*.test.mjs`.

- [ ] **Step 2: Run Skill Ratchet structural validation**

Validate `skills/design-with-ai` and ensure eval references resolve.

- [ ] **Step 3: Run repository governance/index checks**

Regenerate index only if required, then verify generated JSON/JSONL and routing/reference-graph governance.

- [ ] **Step 4: Review diff for forbidden corpus/ownership drift**

Confirm no new top-level skill, no style/palette/font/landing/motion-preset corpus, no product-category dial presets, and no Penpot/server ownership change.

- [ ] **Step 5: Open a Draft PR**

Summarize RED -> GREEN evidence, sources/provenance, retained boundaries, and any remaining independent-model qualification gate. Do not merge.
