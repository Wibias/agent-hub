# Reference Graph P21 Daily Projection Refresh Cron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically refresh the P10 Quick runtime projection at UTC midnight with a five-minute retry, using database-local Supabase Cron and no production credentials.

**Architecture:** Migration 013 enables `pg_cron` idempotently and owns one named job that directly invokes the existing P10 refresh function at 00:00 and 00:05 UTC. P21 adds source contracts plus a disposable Supabase Postgres 17 governance lane that proves the migration, job identity, idempotence, execution, and unchanged P10 privilege boundary.

**Tech Stack:** PostgreSQL 17, Supabase Postgres, `pg_cron`, Node.js 24 ESM, `node:test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-25-reference-graph-p21-daily-refresh-cron-design.md`

## Global Constraints

- Job name exactly `reference-graph-p10-daily-refresh`.
- Schedule exactly `0,5 0 * * *`.
- Command calls only `public.reference_graph_refresh_quick_runtime_projection_p10()`.
- No production project ref, API credential, Vault secret, HTTP, `pg_net`, or Edge Function.
- Do not widen P10 refresh EXECUTE privileges.
- No activation, nonce, grant, P17 state, or repository-default mutation.

## Review Focus

- Reapplying migration 013 must not create duplicate named jobs.
- The disposable DB must use a Supabase Postgres image that actually contains `pg_cron`.
- Cron command must not embed credentials or network calls.
- P10 refresh must remain executable by `service_role` and denied to `anon`/`authenticated`.
- Existing migrations 001-012 must still apply before 013.

---

### Task 1: P21 RED contracts

**Files:**
- Create: `tests/reference-graph/p21-daily-refresh-cron-sql.test.mjs`
- Create: `tests/reference-graph/p21-ci-contract.test.mjs`

**Interfaces:**
- Consumes: P20 migration 012 and existing P10 refresh function name.
- Produces: exact source/CI contract for migration 013 and P21 governance.

- [ ] **Step 1: Write failing SQL contract tests**

Assert migration 013 exists and contains `create extension if not exists pg_cron`, exact named `cron.schedule`, exact schedule `0,5 0 * * *`, and only the P10 refresh call. Assert it contains no HTTP, `pg_net`, Supabase URL/key names, or GRANT widening.

- [ ] **Step 2: Write failing CI contract tests**

Assert `.github/workflows/verify-reference-graph-p21.yml` runs P21 tests, uses a Supabase Postgres 17 image, applies 013, checks `cron.job`, reapplies 013 for idempotence, executes P10 refresh, checks role privileges, and contains no production credentials/project ref.

- [ ] **Step 3: Run RED**

Run: `node --test tests/reference-graph/p21-*.test.mjs`
Expected: FAIL because migration 013 and P21 workflow do not exist.

- [ ] **Step 4: Commit RED tests**

Commit only the two P21 test files.

### Task 2: Migration 013

**Files:**
- Create: `reference-graph/schema/013_reference_graph_daily_refresh_cron.sql`
- Test: `tests/reference-graph/p21-daily-refresh-cron-sql.test.mjs`

**Interfaces:**
- Consumes: `public.reference_graph_refresh_quick_runtime_projection_p10()`.
- Produces: one active named `pg_cron` job.

- [ ] **Step 1: Implement minimal migration**

Enable `pg_cron` if absent and call `cron.schedule` with the exact job name, schedule, and direct refresh SQL.

- [ ] **Step 2: Run SQL contract GREEN**

Run: `node --test tests/reference-graph/p21-daily-refresh-cron-sql.test.mjs`
Expected: PASS.

- [ ] **Step 3: Commit migration**

Commit migration 013 without unrelated changes.

### Task 3: P21 governance

**Files:**
- Create: `.github/workflows/verify-reference-graph-p21.yml`
- Test: `tests/reference-graph/p21-ci-contract.test.mjs`

**Interfaces:**
- Consumes: migrations 001-013 and Supabase Postgres 17 with `pg_cron`.
- Produces: PR/main governance evidence for scheduler correctness.

- [ ] **Step 1: Add disposable Supabase Postgres 17 workflow**

Use a pinned Supabase Postgres 17 image, bootstrap missing roles, apply migrations 001-013, reapply 013 once, and assert exactly one matching `cron.job` row with exact active schedule/command.

- [ ] **Step 2: Add runtime and privilege smoke**

Execute the P10 refresh as `service_role`, validate JSON receipt fields, and assert `anon`/`authenticated` lack EXECUTE while `service_role` retains it.

- [ ] **Step 3: Run P21 GREEN**

Run: `node --test tests/reference-graph/p21-*.test.mjs`
Expected: PASS.

- [ ] **Step 4: Commit workflow**

Commit P21 governance only.

### Task 4: PR, merge, and live boundary

**Files:**
- No additional production code unless CI exposes a concrete defect.

**Interfaces:**
- Consumes: exact P21 branch head and governance run IDs.
- Produces: merge SHA eligible for live migration 013 deployment.

- [ ] **Step 1: Open draft PR and run all governance**

Require all Reference Graph and Release lanes green on the exact branch head.

- [ ] **Step 2: Merge with expected-head lease**

Verify `main` base has not drifted, mark ready, and merge with exact expected head SHA.

- [ ] **Step 3: Require all post-merge governance green**

Do not deploy migration 013 from PR evidence alone.

- [ ] **Step 4: Live dry-run and deploy**

Use Supabase CLI against project `vrznfnxzlxaavpqbzbzd`; dry-run must show exactly migration 013. Deploy, verify migration history and the exact active cron job definition, then retain P19 soak routing invariants.