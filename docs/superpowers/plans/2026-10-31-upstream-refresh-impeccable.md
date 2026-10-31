# Upstream Refresh With Impeccable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the upstream audit through 2026-10-31 and make Addy, Emil, Matt, pstack, and Impeccable part of one durable update check.

**Architecture:** Add a checked-in source registry that separates the last reviewed upstream commit from local adoption state, plus an offline-testable checker. Keep the current Impeccable vendor internally consistent and record its audited 4.8.0 delta as pending rather than shipping a partial vendor bump.

**Tech Stack:** Markdown, JSON, Node.js.

**Spec:** `docs/superpowers/specs/2026-10-31-upstream-refresh-impeccable.md`

## Global Constraints

- Track all five canonical upstream sources.
- `reviewedCommit` means audited upstream state, not automatically adopted state.
- Preserve Impeccable's existing 4.6.0 / engine 0.1.15 vendor until a complete vendor sync can update all shared runtime files together.
- Do not duplicate Emil PR #139.
- Do not adopt Matt's orchestration model into Superpowers.
- Do not broaden `code-simplification` generic routing.
- No temporary workflow changes may remain in the final diff.
- Do not merge the PR.

## Review Focus

- The checker must expose reviewed-but-unadopted deltas instead of calling them current.
- Impeccable must appear as `PENDING` with both reviewed and local pin SHAs.
- pstack must remain `current` even though the parent repository advanced outside `pstack/`.
- The offline checker path must execute in CI without network access.
- The final diff must not change the existing Impeccable vendor files.

---

### Task 1: Pin the five-source contract

**Files:**
- Create: `tests/skill-catalog/upstream-update-check.test.mjs`

- [x] Write the failing five-source contract.
- [x] Run Release Governance and confirm RED at `Test catalog discovery audit`.

### Task 2: Add the durable update check

**Files:**
- Create: `upstream-sources.json`
- Create: `scripts/check-upstream-sources.mjs`

- [x] Record all five reviewed checkpoints and decisions.
- [x] Distinguish `CURRENT`, `UPDATE`, and `PENDING`.
- [x] Execute `--offline` from the catalog test.

### Task 3: Preserve Impeccable consistency

**Files:**
- No final changes under `skills/impeccable/`.

- [x] Audit upstream 4.8.0 / engine 0.1.18.
- [x] Record local pin `6af45ac9a5eb8792f033d3242f52e99812fd91fa` as `update-pending`.
- [x] Reject a partial sync because the audited delta includes shared runtime/launcher files that must move together.

### Task 4: Verify and deliver

- [ ] Run complete Release Governance on the final head.
- [ ] Compare branch with main and prove no Impeccable vendor or workflow residue remains.
- [ ] Update PR with audit decisions and RED/GREEN evidence.
- [ ] Mark Ready for review only when final governance is green.
