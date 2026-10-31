# Reference Graph P23 Hard Deadline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing P10 1500 ms per-attempt timeout a true wall-clock deadline across fetch and response parsing while preserving P22 retry semantics.

**Architecture:** Keep `fetchP10QuickCandidatePool` retry policy unchanged. Change only `fetchProjectionAttempt` so the complete attempt races an independent deadline promise; the deadline also aborts the controller for cleanup. Add regression tests for fetch and JSON phases that never settle and ignore abort.

**Tech Stack:** Node.js ESM, `node:test`, `AbortController`, Promises.

**Spec:** `docs/superpowers/specs/2026-10-31-reference-graph-p23-hard-deadline-design.md`

## Global Constraints

- Per-attempt timeout remains 1500 ms in production callers.
- Exactly one retry remains allowed only for the exact P10 timeout error.
- Non-timeout HTTP, JSON, snapshot, duplicate, and parity failures remain non-retryable.
- P11 remains fail closed.
- No schema, credential, activation, or repository-default changes.

## Review Focus

- Fetch never settles and ignores AbortSignal: hard timeout and one retry.
- `response.json()` never settles: same hard timeout and one retry.
- Abort-aware timeout path still retries exactly once.
- HTTP 503 remains non-retryable.
- Fast successful fetch remains one request with unchanged candidate validation.

---

### Task 1: Add hard-deadline regressions

**Files:**
- Create: `tests/reference-graph/p23-hard-deadline.test.mjs`

**Interfaces:**
- Consumes: `fetchP10QuickCandidatePool(...)`, `P10RuntimeTransportError`.
- Produces: regression coverage proving the attempt settles under a bounded wall-clock time when fetch or JSON never settles.

- [ ] **Step 1: Write failing fetch-ignore-abort test**

Use `timeoutMs: 20`, a `fetchImpl` returning `new Promise(() => {})`, and a test timeout. Assert timeout error, exactly two fetch calls, and elapsed time below a generous 250 ms CI bound.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/reference-graph/p23-hard-deadline.test.mjs`

Expected: test does not complete through the production promise and fails/cancels under the test runner because P22 lacks a hard deadline.

- [ ] **Step 3: Add response-json-never-settles test**

Return an OK response whose `json()` returns `new Promise(() => {})`. Assert the same timeout error, two attempts, and bounded elapsed time.

- [ ] **Step 4: Verify RED for both cases**

Run the same test command and confirm both regressions fail against unchanged P22 code.

### Task 2: Enforce hard deadline in P10 attempt

**Files:**
- Modify: `reference-graph/p10-runtime-client.mjs`
- Test: `tests/reference-graph/p22-timeout-retry.test.mjs`
- Test: `tests/reference-graph/p23-hard-deadline.test.mjs`

**Interfaces:**
- Consumes: existing `timeoutMs`, `fetchImpl`, `RUNTIME_TIMEOUT_MESSAGE`.
- Produces: `fetchProjectionAttempt(...)` that settles by the deadline even when the underlying operation ignores abort.

- [ ] **Step 1: Add independent deadline promise**

Create a timer that calls `controller.abort()` and rejects with the existing exact `P10RuntimeTransportError(RUNTIME_TIMEOUT_MESSAGE)`.

- [ ] **Step 2: Race the complete attempt against the deadline**

Wrap fetch, HTTP validation, `response.json()`, and candidate validation in the attempt promise. `Promise.race([attempt, deadline])` defines the wall-clock boundary. Clear the timer in `finally`.

- [ ] **Step 3: Preserve error classification**

Existing P10 transport errors pass through unchanged. Abort-aware underlying rejections still map to the exact timeout error. Other request errors remain `P10 runtime projection request failed`. Invalid JSON before the deadline remains non-timeout.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/reference-graph/p22-timeout-retry.test.mjs tests/reference-graph/p23-hard-deadline.test.mjs`

Expected: all targeted P22 and P23 tests pass.

- [ ] **Step 5: Run repository verification/CI**

Run the repository test suite and required governance checks. Do not merge while any required check is red.

### Task 3: Delivery gate

**Files:**
- No production files beyond Task 2.

**Interfaces:**
- Produces: merge-ready P23 PR only after targeted tests and repository checks are green.

- [ ] **Step 1: Confirm diff scope**

Expected code scope: P10 runtime client, P23 regression test, P23 design, P23 plan.

- [ ] **Step 2: Confirm no production activation/default mutation**

No Supabase migration, activation state, grant, cron, or repository-default changes.

- [ ] **Step 3: Merge only after required CI is green**

After merge, start a new isolated clean P19 soak pinned to the P23 merge SHA. Preserve the failed P22 soak as historical evidence.
