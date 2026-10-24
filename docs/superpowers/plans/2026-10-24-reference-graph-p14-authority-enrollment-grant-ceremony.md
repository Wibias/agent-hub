# Reference Graph P14 Authority Enrollment and Grant Ceremony Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed production public-authority enrollment and externally signed grant ceremony that can authorize the exact P13 activation request without ever handling a production private key or performing activation.

**Architecture:** Pin the final P13 evidence head, exact P13 evidence bytes, and P13 request hash. Build an enrollment manifest that requires an independently supplied approved authority hash, emit the exact unsigned P13 grant payload for an external Ed25519 signer, and accept a returned signature only through the hardened P13 verifier. Keep private-key custody entirely external and keep authorization separate from activation execution.

**Tech Stack:** Node.js 24 ESM, `node:crypto`, `node:test`, existing P13 verifier/receipt/operator patterns, existing Reference Graph GitHub governance.

**Spec:** `docs/superpowers/specs/2026-10-24-reference-graph-p14-authority-enrollment-grant-ceremony-design.md`

## Global Constraints

- Base exactly on final P13 evidence head `bbd29fbe596801fdb7594f45045cb41e9c9b1a5b`.
- Bind exact P13 request hash `ed31630f9bda1362f42e747a6366d8504d17638b8ba458228db6fec5a2074ce7`.
- Compute and then freeze SHA-256 of the exact committed P13 evidence bytes.
- No production private-key generation, parsing, storage, environment variable, artifact, or signing API.
- No activation execution, routing switch, environment mutation, deployment mutation, Supabase mutation, projection refresh, DDL, migration, or write RPC.
- Repository default remains graph-off and `production_source` remains `legacy-control`.
- Quick-only scope remains `REFERENCE_GRAPH_QUICK_RUNTIME=graph`; standard/deep remain legacy-only.
- Authority enrollment requires an independently supplied approved authority SHA-256 equal to the canonical descriptor hash.
- Authority public key must actually be Ed25519 SPKI.
- Grant lifetime remains at most 15 minutes and all timestamps are canonical UTC ISO strings.
- `activation_authorized` may become true only for a fully verified exact grant; `activation_performed` must remain false.

## Review Focus

- Caller commits a self-generated authority and self-declared hash without independent approval: enrollment must fail. Covered in Task 1.
- Authority descriptor says Ed25519 but contains RSA/EC or unknown fields: enrollment must fail. Covered in Task 1.
- Externally signed grant contains extra fields, wrong P13 request, wrong authority, noncanonical time, or a lifetime over 15 minutes: authorization must fail. Covered in Task 1.
- An ephemeral test key or generated key leaks into durable production evidence: governance must fail. Covered in Tasks 2 and 4.
- A future change adds private-key/signing, activation, env, deployment, Supabase, or migration `010+` behavior: permanent governance must fail. Covered in Task 4.

---

### Task 1: P13 Binding, Authority Enrollment, and Grant Ceremony Core

**Files:**
- Create: `reference-graph/p14-authority-enrollment-grant.mjs`
- Create: `tests/reference-graph/p14-authority-enrollment-grant.test.mjs`

**Interfaces:**
- Consumes: final P13 evidence object/bytes, P13 hardened authority hash/verifier functions, externally supplied authority descriptor and approved hash.
- Produces: `createP14EnrollmentManifest(...)`, `createP14UnsignedGrantPayload(...)`, `hashP14GrantPayload(payload)`, and `verifyP14SignedGrant(...)`.

- [ ] **Step 1: Write failing binding/enrollment tests**

Assert exact P13 head/request binding, exact P13 evidence SHA pin, P13 pre-ceremony state, exact enrollment schema, actual Ed25519 SPKI, independent approval-hash match, and rejection of unknown/private-key-shaped fields.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/reference-graph/p14-authority-enrollment-grant.test.mjs`

Expected: FAIL because `reference-graph/p14-authority-enrollment-grant.mjs` or its exports do not exist.

- [ ] **Step 3: Implement minimal enrollment manifest and freeze P13 evidence SHA**

Derive the actual SHA-256 from the committed P13 evidence file during the first implementation verification and pin it as `P13_EVIDENCE_SHA256`. The builder must require `approvedAuthoritySha256 === hashP13AuthorityDescriptor(authority)` and must never accept approval derived implicitly from the descriptor.

- [ ] **Step 4: Extend failing tests for unsigned payload and signature acceptance**

Assert deterministic exact P13 payload construction, canonical timestamps, nonce, <=15-minute lifetime, payload hashing, valid ephemeral external signature acceptance, and fail-closed wrong-request/wrong-authority/extra-field/bad-signature cases. Assert successful verification returns `activationAuthorized: true` but `activationPerformed: false`.

- [ ] **Step 5: Implement minimal payload/verification path and verify GREEN**

Use P13 `verifyP13ActivationGrant` for final grant verification. Production P14 code must not call `sign`, `createPrivateKey`, or key-generation APIs.

Run: `node --test tests/reference-graph/p14-authority-enrollment-grant.test.mjs`

Expected: PASS.

Run: `node --test tests/reference-graph/*.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 6: Commit**

Commit: `feat: add P14 authority enrollment ceremony core`

---

### Task 2: P14 Ceremony Receipt and Secret Boundary

**Files:**
- Create: `reference-graph/p14-receipt.mjs`
- Create: `tests/reference-graph/p14-receipt.test.mjs`

**Interfaces:**
- Consumes: frozen P13 anchors, optional valid enrollment manifest, optional verified signed grant.
- Produces: `P14_PHASES`, `createP14Receipt(...)`, `recordP14Phase(...)`, `finalizeP14Receipt(...)`, `assertSecretFreeP14Receipt(...)`.

- [ ] **Step 1: Write failing receipt tests**

Assert exact schema/phases, immutable P13 anchors, ordered phases, terminal failure, unique blockers, and two valid final states: ceremony-ready with external blocker and authorized-not-activated with enrolled authority + verified grant.

- [ ] **Step 2: Run receipt tests and verify RED**

Run: `node --test tests/reference-graph/p14-receipt.test.mjs`

Expected: FAIL because `reference-graph/p14-receipt.mjs` does not exist.

- [ ] **Step 3: Implement minimal receipt state machine**

Ceremony-ready finalization must record `authority_state: awaiting-external-enrollment`, `grant_state: not-issued`, authorization false, activation false. Ceremony finalization may record enrolled/issued/verified/authorized only from supplied verified ceremony results. Activation remains false in both states.

- [ ] **Step 4: Add and pass private-key/secret rejection tests**

Reject credential/private-key-shaped keys and literal secret material recursively. Durable receipts may contain public SPKI material and detached signatures but no private-key material.

Run: `node --test tests/reference-graph/p14-receipt.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat: add P14 ceremony receipt`

---

### Task 3: Read-only P14 Ceremony Operator

**Files:**
- Create: `reference-graph/cli/p14-authority-enrollment-grant.mjs`
- Create: `tests/reference-graph/p14-operator.test.mjs`

**Interfaces:**
- Consumes: Task 1 core, Task 2 receipt, committed P13 evidence.
- Produces modes `--plan`, `--verify-repository`, `--enrollment-manifest`, `--emit-grant-payload`, `--verify-signed-grant`, `--finalize-repository`, and `--finalize-ceremony`.

- [ ] **Step 1: Write failing operator tests**

Assert plan/repository modes preserve legacy production, enrollment requires separate approved hash, payload emission never signs, signed-grant verification can authorize but cannot activate, repository finalization records the external blocker, ceremony finalization requires exact valid artifacts, and unsupported signing/activation/deployment modes fail.

- [ ] **Step 2: Run operator tests and verify RED**

Run: `node --test tests/reference-graph/p14-operator.test.mjs`

Expected: FAIL because the P14 CLI does not exist.

- [ ] **Step 3: Implement read-only/output-only operator**

The operator may read caller JSON and emit JSON only. It must not write repository files or use private-key/signing APIs. `--finalize-repository` must succeed as ceremony-ready even when no production authority is supplied, with the explicit external blocker.

- [ ] **Step 4: Verify GREEN and regression suite**

Run: `node --test tests/reference-graph/p14-operator.test.mjs`

Expected: PASS.

Run: `node --test tests/reference-graph/*.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

Commit: `feat: add P14 authority ceremony operator`

---

### Task 4: Permanent P14 Governance and Operator Documentation

**Files:**
- Create: `tests/reference-graph/p14-ci-contract.test.mjs`
- Create: `reference-graph/P14.md`

**Interfaces:**
- Consumes: all P14 production files and existing `.github/workflows/verify-reference-graph.yml`.
- Produces: permanent guards against key-generation/signing/private-key leakage and all activation/mutation paths.

- [ ] **Step 1: Write failing governance tests**

Assert permanent workflow runs all Reference Graph tests and secret scan; P14 source contains no signing/key-generation/private-key parsing APIs; no private key files or fields exist; no activation/deployment/env/Supabase mutation path exists; migrations remain capped at `009`; repository runtime stays legacy-default; docs clearly define external custody and ceremony-ready vs authorized-not-activated states.

- [ ] **Step 2: Run governance test and verify RED**

Run: `node --test tests/reference-graph/p14-ci-contract.test.mjs`

Expected: FAIL because P14 docs/governance are incomplete.

- [ ] **Step 3: Add operator documentation and complete governance assertions**

Document the exact P13 anchors, external approval hash, external signing ceremony, no production private key in repo/CI, exact operator modes, and later separate activation phase.

- [ ] **Step 4: Verify GREEN and full Reference Graph suite**

Run: `node --test tests/reference-graph/p14-ci-contract.test.mjs`

Expected: PASS.

Run: `node --test tests/reference-graph/*.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

Commit: `test: govern P14 authority enrollment ceremony`

---

### Task 5: Durable Ceremony-ready Evidence, Final Review, and Draft PR

**Files:**
- Create: `reference-graph/evidence/p14-authority-enrollment-grant-evidence.json`
- Modify only if final evidence pinning requires it: `tests/reference-graph/p14-ci-contract.test.mjs`

**Interfaces:**
- Consumes: tested P14 implementation SHA and `--finalize-repository`.
- Produces: secret-free durable P14 evidence that explicitly records the missing external production authority rather than fabricating one.

- [ ] **Step 1: Pin durable evidence contract**

When the file exists, require schema `reference-graph.p14-authority-enrollment-grant.v1`, exact P13 head/request/evidence SHA, `ceremony_ready: true`, `authority_state: awaiting-external-enrollment`, `grant_state: not-issued`, `grant_verified: false`, `activation_authorized: false`, `activation_performed: false`, repository default false, `production_source: legacy-control`, and external blocker `production-ed25519-authority-not-provided`.

- [ ] **Step 2: Generate ceremony-ready evidence from tested implementation SHA**

Run `node reference-graph/cli/p14-authority-enrollment-grant.mjs --finalize-repository <snapshot.json>`. Do not use an ephemeral test key to fill production fields.

- [ ] **Step 3: Run all final verification**

Run: `node --test tests/reference-graph/*.test.mjs`

Expected: PASS with zero failures.

Run: `python3 skills/security-review-redirect/scripts/scan_secrets.py reference-graph`

Expected: PASS with no secret findings.

Run permanent Reference Graph governance on the final branch/PR head.

Expected: PASS.

- [ ] **Step 4: Final diff review**

Compare final P14 head to `bbd29fbe596801fdb7594f45045cb41e9c9b1a5b`. P14 must add only P14-specific files unless a narrowly justified P13 test/governance update is required. No runtime, migration, Supabase, or deployment mutation is allowed.

- [ ] **Step 5: Create/update Draft PR stacked on `agent/reference-graph-p13`**

Record exact P13 anchors, tested P14 implementation SHA, final evidence head, governance run IDs, local test result, and the explicit external ceremony blocker. State clearly that P14 infrastructure is complete but production authority enrollment/grant issuance cannot be truthfully completed until a real externally held Ed25519 authority and signature are supplied.