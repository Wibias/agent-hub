# Reference Graph P24 Retry Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the 1500 ms primary P10 hard deadline while allowing the single timeout retry up to 5000 ms.

**Architecture:** Extend the P10 client with a separately validated `retryTimeoutMs` that defaults to `timeoutMs`. Preserve the exact P22/P23 retry classification and hard-deadline implementation. Pin both production Quick callers to 1500/5000 while leaving non-opted-in callers unchanged.

**Tech Stack:** Node.js ESM, `node:test`, AbortController, Promise hard deadlines.

**Spec:** `docs/superpowers/specs/2026-11-02-reference-graph-p24-retry-budget-design.md`

## Global Constraints

- Primary production budget: 1500 ms.
- Single retry production budget: 5000 ms.
- Exactly one retry and only for the exact P10 timeout condition.
- P11 stays fail closed; Standard/Deep stay legacy-only.
- No schema, credential, activation, cron, readiness-rule, or repository-default changes.

## Review Focus

- Retry succeeds when it needs longer than the primary budget but less than its 5000 ms budget.
- Double-hung requests stop at the combined primary plus retry hard budgets.
- Non-timeout failures remain one-attempt failures.
- Query and P17 production probe both explicitly use 1500/5000.
- Existing callers without `retryTimeoutMs` retain equal primary/retry budgets.

---

### Task 1: Prove retry-budget gap

**Files:**
- Create: `tests/reference-graph/p24-retry-budget.test.mjs`

**Interfaces:**
- Consumes: `fetchP10QuickCandidatePool` and `P10RuntimeTransportError`.
- Produces: regression evidence for separate primary and retry budgets.

- [x] Add a test where the first attempt times out and the retry completes after the primary budget but before a larger retry budget.
- [x] Add a test where both attempts hang and verify the combined hard budget.
- [x] Run the Reference Graph suite and observe RED against P23.

Observed RED: both timing tests failed because P23 reused the primary timeout for the retry.

### Task 2: Implement separate retry budget

**Files:**
- Modify: `reference-graph/p10-runtime-client.mjs`

**Interfaces:**
- Consumes: `timeoutMs`, optional `retryTimeoutMs`.
- Produces: first attempt using `timeoutMs`; exact-timeout retry using `retryTimeoutMs`.

- [x] Add `retryTimeoutMs = timeoutMs` for backward compatibility.
- [x] Validate both timeout values as positive integers.
- [x] Use only `retryTimeoutMs` for the existing single retry.
- [x] Re-run timing regressions and observe GREEN.

### Task 3: Pin production callers

**Files:**
- Modify: `knowledge/design-references/scripts/query.mjs`
- Modify: `reference-graph/p17-activation-runner.mjs`
- Test: `tests/reference-graph/p24-retry-budget.test.mjs`

**Interfaces:**
- Produces: production Quick runtime and P19/P17 probe using primary 1500 ms and retry 5000 ms.

- [x] Add a source contract requiring both production callers to contain `timeoutMs: 1500` and `retryTimeoutMs: 5000`.
- [x] Observe RED while the callers still lack the 5000 ms retry setting.
- [x] Add `retryTimeoutMs: 5000` to both production callers.
- [ ] Run the full Reference Graph suite and required governance checks.

### Task 4: Delivery gate

**Files:**
- No additional production scope.

- [ ] Confirm the diff is limited to P10 retry budgeting, the two production callers, P24 tests, and P24 docs.
- [ ] Confirm all PR governance checks are green.
- [ ] Review the final diff for retry classification, timeout bounds, and activation/default invariants.
- [ ] Merge only with an unchanged expected head SHA.
- [ ] Confirm all post-merge main governance checks are green.
- [ ] Only then prepare a new isolated P19 soak pinned to the P24 merge SHA.
