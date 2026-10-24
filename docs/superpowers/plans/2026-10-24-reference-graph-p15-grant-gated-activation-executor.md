# Reference Graph P15 Grant-Gated Activation Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed, one-shot production activation executor that consumes a freshly verified P14 grant, switches only quick routing, verifies live isolation/parity, and rolls back on failure.

**Architecture:** A provider-neutral P15 core delegates cryptographic authority to P14 and requires injected durable nonce consumption, deployment mutation, live probing, and rollback functions. A separate receipt module and read-only operator surface preserve the authorization/activation distinction. Committed evidence remains blocked because no real production authority/grant exists.

**Tech Stack:** Node.js ESM, `node:test`, Ed25519 via existing P13/P14 code, existing P11 runtime contract, GitHub Actions Reference Graph Governance.

**Spec:** `docs/superpowers/specs/2026-10-24-reference-graph-p15-grant-gated-activation-executor-design.md`

## Global Constraints

- Pin P14 final evidence head `43fd2adf9e73749b03283f7ae7c6e700bd383b35` and evidence SHA-256 `610f9f832d994e565fe6912e3aa1e25d5fe5b549fa08f1a48f477ee9b3956393`.
- Use P14 `verifyP14SignedGrant()` as the only grant verifier.
- Consume nonce atomically and irreversibly before the first production mutation.
- Re-verify grant after nonce consumption immediately before mutation.
- Activate only `REFERENCE_GRAPH_QUICK_RUNTIME=graph`; standard/deep remain legacy-only.
- Any post-mutation failure requires rollback and rollback verification.
- Never generate, import, store, or commit a production private key or fabricated production grant.
- Repository default remains graph-off.

## Review Focus

- Grant expires after nonce consumption but before mutation: stop without mutation; nonce remains consumed.
- Replay ledger reports an already-consumed or malformed result: no activation call occurs.
- Activation succeeds but live probe shows quick parity mismatch or standard/deep graph routing: rollback is mandatory.
- Rollback call succeeds but live state is not legacy: receipt must not claim restoration.
- Caller attempts to inject verified/authorized booleans instead of real ceremony artifacts: exact input contract rejects them.

---

### Task 1: P15 activation transaction core

**Files:**
- Create: `tests/reference-graph/p15-activation-executor.test.mjs`
- Create: `reference-graph/p15-activation-executor.mjs`

**Interfaces:**
- Consumes: P13 evidence, P14 enrollment manifest, real signed grant, `verifyP14SignedGrant()`, injected `readActivationState`, `consumeGrantNonce`, `applyActivation`, `probeRuntime`, `rollbackActivation`, and `now`.
- Produces: `executeP15Activation(input)` and frozen P14 binding constants.

- [ ] **Step 1: Write failing tests** for exact P14 byte binding, invalid/stale grant rejection, legacy pre-state, one-shot nonce consumption ordering, second verification before mutation, successful quick-only cutover, replay rejection, probe-triggered rollback, and rollback-verification failure.
- [ ] **Step 2: Run Reference Graph tests** and confirm failure is missing P15 module/API rather than an unrelated baseline failure.
- [ ] **Step 3: Implement `executeP15Activation(input)`** with direct P14 verification and strict external callback result validation.
- [ ] **Step 4: Run Reference Graph tests** and require PASS.
- [ ] **Step 5: Commit** core + tests.

### Task 2: Cryptographically bound P15 receipt

**Files:**
- Create: `tests/reference-graph/p15-receipt.test.mjs`
- Create: `reference-graph/p15-receipt.mjs`

**Interfaces:**
- Consumes: P15 executor result plus real ceremony artifacts for any activated/rolled-back finalization.
- Produces: `createP15Receipt()` and `finalizeP15Receipt()`; finalization must re-run P15 verification/execution contract rather than trust caller booleans.

- [ ] **Step 1: Write failing receipt tests** for blocked repository state, forbidden secret-shaped fields, fabricated activation claims, activated state, and rolled-back state.
- [ ] **Step 2: Confirm RED** due missing receipt module.
- [ ] **Step 3: Implement receipt schemas and secret boundary** with repository-default-off invariant.
- [ ] **Step 4: Run Reference Graph tests** and require PASS.
- [ ] **Step 5: Commit** receipt + tests.

### Task 3: Read-only operator and repository verifier

**Files:**
- Create: `tests/reference-graph/p15-operator.test.mjs`
- Create: `reference-graph/cli/p15-activation-executor.mjs`
- Create: `reference-graph/P15.md`

**Interfaces:**
- Consumes: frozen P14 evidence and P15 receipt helpers.
- Produces: `--plan` and `--verify-repository`; no provider-specific production mutation CLI.

- [ ] **Step 1: Write failing operator tests** proving plan/verify modes and proving no private-key/signing/deployment/Supabase mutation surface exists.
- [ ] **Step 2: Confirm RED** due missing CLI.
- [ ] **Step 3: Implement read-only operator and P15 runbook** documenting external actuator requirements and one-shot semantics.
- [ ] **Step 4: Run Reference Graph tests** and require PASS.
- [ ] **Step 5: Commit** operator + docs + tests.

### Task 4: Governance and durable blocked evidence

**Files:**
- Create: `tests/reference-graph/p15-ci-contract.test.mjs`
- Create: `tests/reference-graph/p15-evidence-binding.test.mjs`
- Create: `reference-graph/evidence/p15-activation-executor-evidence.json`

**Interfaces:**
- Consumes: final tested P15 implementation SHA and frozen P14 evidence bytes.
- Produces: immutable P15 evidence recording infrastructure ready but production still legacy-controlled without a real grant.

- [ ] **Step 1: Write failing CI/evidence tests** requiring P15 files, immutable P14 binding, no migration 010+, no committed private key, graph-off repository default, and exact blocked evidence state.
- [ ] **Step 2: Confirm RED** before evidence exists.
- [ ] **Step 3: Run complete Reference Graph Governance** on the implementation SHA and capture the successful run.
- [ ] **Step 4: Write durable evidence** with the tested implementation SHA and real governance run id; do not invent authority/grant/activation evidence.
- [ ] **Step 5: Run Reference Graph Governance and Release Governance again** on the evidence head and require both PASS.
- [ ] **Step 6: Perform final security review** for bypasses, replay, stale-grant, rollback, secret, and provider-mutation surfaces; fix with a RED regression before evidence refreeze if needed.
