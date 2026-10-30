# Upstream Refresh With Impeccable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh applicable upstream guidance, fully update the Impeccable vendor, and make the five-source upstream audit durable.

**Architecture:** Add a small checked-in source registry plus an offline-testable checker. Refresh Impeccable by replacing only the union of old/new upstream-vendored paths, preserve local-only files, then merge the two upstream `SKILL.md` semantic changes into Agent Hub's overlay and update provenance.

**Tech Stack:** Markdown, JSON, Node.js, GitHub Actions shell tooling.

**Spec:** `docs/superpowers/specs/2026-10-31-upstream-refresh-impeccable.md`

## Global Constraints

- Preserve Impeccable's explicit-only Agent Hub routing boundary.
- Preserve local Impeccable files never present in the old or new upstream distribution.
- Shared Impeccable vendor files must match upstream `df3a4abe7d0840d5f60324812c432e00b66a4e75` byte-for-byte, except `SKILL.md`.
- Do not duplicate Emil PR #139.
- Do not adopt Matt's orchestration model into Superpowers.
- Do not broaden `code-simplification` generic routing.
- Do not merge the PR.

## Review Focus

- A vendor sync must not delete Agent Hub-only Impeccable runtime/eval files.
- The local Impeccable overlay must keep its security and explicit-routing clauses.
- New engine downloads must retain upstream checksum verification files and launcher behavior.
- Registry `reviewedCommit` values must represent audited repository heads, not local adoption pins.
- The update checker must be deterministic offline when only validating registry shape.

---

### Task 1: Pin the new contracts

**Files:**
- Create: `tests/skill-catalog/upstream-update-check.test.mjs`
- Modify later: `tests/skill-catalog/upstream-guidance-adoption.test.mjs`

- [ ] Write failing tests requiring all five canonical sources and Impeccable 4.8.0 / engine 0.1.18 / engine-checksums.
- [ ] Run Release Governance and confirm the new contract fails before implementation.

### Task 2: Add the durable update check

**Files:**
- Create: `upstream-sources.json`
- Create: `scripts/check-upstream-sources.mjs`

- [ ] Record the five audited checkpoints and scopes.
- [ ] Implement offline validation and live HEAD comparison.
- [ ] Run the targeted test green.

### Task 3: Refresh Impeccable vendor

**Files:**
- Sync shared paths under `skills/impeccable/`
- Modify: `skills/impeccable/SKILL.md`
- Modify: `skills/impeccable/UPSTREAM.md`
- Modify: `tests/skill-catalog/upstream-guidance-adoption.test.mjs`
- Regenerate: `knowledge/INDEX.md`, `knowledge/index.json`

- [ ] Sync the old/new upstream path union from the pinned source snapshot while preserving local-only files.
- [ ] Merge upstream 4.8.0 SKILL semantics into the local overlay.
- [ ] Update provenance and assertions.
- [ ] Verify shared vendor bytes against the pin.

### Task 4: Verify and deliver

- [ ] Run the complete Release Governance workflow on the final head.
- [ ] Compare branch with main and inspect changed files.
- [ ] Update the PR with audit decisions and RED/GREEN evidence.
- [ ] Mark Ready for review only when final governance is green.
