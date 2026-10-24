# Reference Graph P17 Local Runtime Actuator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind P15/P16 to the real local AgentHub runtime with an atomic, fail-closed projection wrapper that activates Reference Graph only for Quick queries after a valid external grant.

**Architecture:** A new P17 local actuator stores exact mutable state under the established AgentHub state directory. A new `query-runtime.mjs` wrapper reads that state and projects only the existing P11 environment flag into the unchanged `query.mjs` child process. A P17 runner composes the P15 executor, P16 Supabase nonce consumption, local apply/rollback, and production-path probes. Live activation remains blocked until real external authority/grant inputs exist.

**Tech Stack:** Node.js 24 ESM, `node:test`, filesystem atomic rename, child-process spawn, existing P15/P16 modules, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-24-reference-graph-p17-local-runtime-actuator-design.md`

## Global Constraints

- Preserve exact P11 activation flag `REFERENCE_GRAPH_QUICK_RUNTIME=graph`; do not make `query.mjs` read P17 state directly.
- Quick may use Reference Graph; Standard and Deep remain `legacy-control`.
- No private key generation/loading/signing path.
- No fabricated authority enrollment or signed grant.
- No live nonce consumption or production activation for tests/evidence.
- No migration 011+.
- Mutable state uses `%LOCALAPPDATA%\agent-hub` on Windows and XDG state on POSIX; `AGENT_HUB_REFERENCE_GRAPH_STATE` is the test/operator override.
- Missing or malformed state must fail closed to legacy.
- Local apply and rollback use same-directory temporary file + atomic rename.

## Review Focus

1. A caller process already containing `REFERENCE_GRAPH_QUICK_RUNTIME=graph` must not bypass a durable legacy/missing state; wrapper removes the variable unless exact P17 state says graph.
2. Truncated/extra-key/wrong-schema state must not enable graph.
3. An interrupted write must not expose a partial graph state; only rename completes a change.
4. P15 must consume the P16 nonce exactly once before any local graph mutation.
5. A failed graph probe must return the host to verified legacy and require a new grant.

---

### Task 1: Local activation state and atomic actuator

**Files:**
- Create: `tests/reference-graph/p17-local-runtime-actuator.test.mjs`
- Create: `reference-graph/p17-local-runtime-actuator.mjs`

**Interfaces:**
- Produces: `defaultP17ActivationStatePath({ env, platform, homeDir }) -> string`
- Produces: `readP17ActivationState({ statePath }) -> { production_source, quick_graph_enabled, repository_default_graph_enabled }`
- Produces: `applyP17LocalActivation(input, { statePath, now, randomUUID, fsOps? }) -> Promise<{ applied: true, change_id: string }>`
- Produces: `rollbackP17LocalActivation(input, { statePath, now, randomUUID, fsOps? }) -> Promise<{ rolled_back: true, change_id: string }>`
- Produces: `readP17RawState({ statePath }) -> exact validated state | null`

- [ ] **Step 1: Write the failing actuator tests**

Pin Windows/XDG path resolution, missing/malformed fail-closed legacy, exact-key/schema validation, graph apply metadata, no raw grant/signature/credential fields, and rollback to legacy.

- [ ] **Step 2: Run the P17 actuator test and verify RED**

Run: `node --test tests/reference-graph/p17-local-runtime-actuator.test.mjs`
Expected: FAIL because `reference-graph/p17-local-runtime-actuator.mjs` does not exist.

- [ ] **Step 3: Implement the minimal actuator**

Use same-directory temporary file, `mkdir({ recursive:true })`, write with mode `0o600`, then rename. Exact state keys are `schema`, `mode`, `change_id`, `consumption_id`, `grant_payload_hash`, `updated_at`.

- [ ] **Step 4: Run actuator tests**

Expected: PASS.

- [ ] **Step 5: Commit**

`test: pin P17 local runtime actuator` for RED, then `feat: add P17 local runtime actuator` for GREEN.

### Task 2: Production projection wrapper

**Files:**
- Create: `tests/reference-graph/p17-query-runtime.test.mjs`
- Create: `knowledge/design-references/scripts/query-runtime.mjs`
- Modify: `skills/design-with-ai/references/reference-library.md`
- Modify: `knowledge/build-index.mjs`
- Modify/generated: `knowledge/index.json`
- Modify/generated: `knowledge/INDEX.md`

**Interfaces:**
- Consumes: `readP17RawState()` and default state-path resolver from Task 1.
- Produces: `planP17QueryRuntime({ argv, env, statePath, nodeExecutable, queryPath }) -> { executable, args, env, mode }`
- Produces: `runP17QueryRuntime(...) -> { mode, exitCode }`

- [ ] **Step 1: Write failing wrapper tests**

Assert argument order preservation, graph projection only from exact graph state, activation env removal for missing/legacy/malformed state, preservation of unrelated env, exact child exit code, and no state/secret logging.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/reference-graph/p17-query-runtime.test.mjs`
Expected: FAIL because wrapper does not exist.

- [ ] **Step 3: Implement wrapper**

Spawn `process.execPath`/provided Node executable with unchanged query args, inherited stdio, `shell:false`, and a copied environment whose activation flag is controlled exclusively by P17 state.

- [ ] **Step 4: Update documented/generated query command**

Replace direct `query.mjs` invocation with `query-runtime.mjs`; regenerate knowledge index using the existing build script when applicable.

- [ ] **Step 5: Run wrapper and relevant knowledge tests**

Expected: PASS and no direct documented production query path remains.

- [ ] **Step 6: Commit RED then GREEN**

### Task 3: P15 + P16 live adapter composition

**Files:**
- Create: `tests/reference-graph/p17-activation-runner.test.mjs`
- Create: `reference-graph/p17-activation-runner.mjs`

**Interfaces:**
- Consumes: `executeP15Activation()` from P15.
- Consumes: `ReferenceGraphSupabaseStore.consumeActivationGrantNonceP16()` from P16.
- Consumes: Task 1 apply/read/rollback callbacks.
- Produces: `executeP17Activation({ p13Evidence, enrollmentManifest, grant, supabaseStore, statePath, probeRuntime, now }) -> Promise<P15Result>`

- [ ] **Step 1: Write failing composition tests**

Assert P16 consume input is exact nonce/grant/request/authority hashes, consume occurs once and before apply, replay/consume failure blocks mutation, apply receives only P15 exact activation metadata, and no signer/private-key API is reachable.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/reference-graph/p17-activation-runner.test.mjs`
Expected: FAIL because runner does not exist.

- [ ] **Step 3: Implement minimal composition**

Bind the P15 callbacks directly. Do not duplicate grant verification or authorize from caller booleans.

- [ ] **Step 4: Run tests and commit GREEN**

### Task 4: Production-path Quick/Standard/Deep probe and rollback verification

**Files:**
- Extend: `tests/reference-graph/p17-local-runtime-actuator.test.mjs`
- Extend: `tests/reference-graph/p17-activation-runner.test.mjs`
- Modify: `reference-graph/p17-local-runtime-actuator.mjs`
- Modify: `reference-graph/p17-activation-runner.mjs`

**Interfaces:**
- Produces: `probeP17Runtime({ statePath, runQuery? }) -> Promise<{ quick, standard, deep }>` where each profile reports at least `authoritative_source`, and Quick graph additionally reports `record_exact` and `pattern_exact`.

- [ ] **Step 1: Add failing probe tests**

Use disposable fixture/query runners to prove the same state projection path yields Quick graph while Standard/Deep remain legacy; malformed graph output fails validation.

- [ ] **Step 2: Verify RED**

Expected: only new probe expectations fail.

- [ ] **Step 3: Implement bounded production-path probe**

Use fixed deterministic request arguments and parse only JSON stdout from the wrapper invocation. Never print credentials.

- [ ] **Step 4: Add and pass rollback-path test**

Force post-activation probe failure; assert P15 calls rollback, fresh probe sees all three profiles legacy, result is `rolled-back`, and `retry_requires_new_grant=true`.

- [ ] **Step 5: Commit GREEN**

### Task 5: Permanent P17 governance and operator runbook

**Files:**
- Create: `tests/reference-graph/p17-ci-contract.test.mjs`
- Create: `.github/workflows/verify-reference-graph-p17.yml`
- Create: `reference-graph/P17.md`

**Interfaces:**
- CI runs all `tests/reference-graph/p17-*.test.mjs` and the existing Reference Graph governance suite.

- [ ] **Step 1: Write RED CI/runbook contract tests**

Require dedicated P17 workflow, secret scan, no migration 011+, disposable state path, graph/legacy projection smoke, rollback smoke, and runbook statements that production remains legacy until real external grant execution.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Add workflow and runbook**

The workflow must never use repository/environment secrets and must never touch the live Supabase project or user local state.

- [ ] **Step 4: Run full governance**

Run: `node --test tests/reference-graph/*.test.mjs`
Expected: all tests PASS.

- [ ] **Step 5: Commit GREEN**

### Task 6: Frozen P17 evidence

**Files:**
- Create: `tests/reference-graph/p17-evidence-binding.test.mjs`
- Create: `reference-graph/evidence/p17-local-runtime-actuator-evidence.json`

**Interfaces:**
- Evidence pins P16 final head/evidence SHA, P17 tested implementation SHA, final governance run IDs, local-control-plane design, and unchanged production activation state.

- [ ] **Step 1: Write RED evidence-binding test**

Require exact schema, P16 head `0e82d287d15066027d81613c3bc08f65cda8081d`, tested P17 implementation SHA, all final governance run IDs, `activation_performed=false`, `production_source=legacy-control`, `repository_default_graph_enabled=false`, `grant_consumed=false`, `host_actuator_state=ready-unexecuted`, and blocker `production-ed25519-authority-grant-not-provided`.

- [ ] **Step 2: Verify exact RED**

Expected: only missing evidence file/binding fails.

- [ ] **Step 3: Create evidence from verified results**

No invented live local-state observation. Record only repo/CI facts and explicitly state that live local activation has not run.

- [ ] **Step 4: Run final Reference Graph, P17, and Release governance on the frozen evidence head**

- [ ] **Step 5: Update draft PR with final SHAs/run IDs and compare P16→P17**
