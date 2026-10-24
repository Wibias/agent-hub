# Reference Graph P13 Activation Grant Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed, verify-only Ed25519 activation-grant authority boundary that binds any future grant to the exact final P12 evidence and runtime contract without issuing a production grant or activating Reference Graph routing.

**Architecture:** Derive a canonical P13 grant request from the committed P12 receipt, hash it deterministically, and verify externally signed Ed25519 grant envelopes only when a separately supplied trusted authority descriptor hash matches exactly. Keep grant verification separate from activation, keep the repository free of private-key/signing paths, and commit a P13 infrastructure receipt whose production authority and grant states remain intentionally unconfigured/not-issued.

**Tech Stack:** Node.js 24 ESM, `node:crypto`, `node:test`, existing Reference Graph receipt/operator patterns, existing GitHub Reference Graph governance.

**Spec:** `docs/superpowers/specs/2026-10-24-reference-graph-p13-activation-grant-authority-design.md`

## Global Constraints

- Base exactly on final P12 evidence head `5f676c806ae864b507723ea867f5e3afd6fd4adb`.
- Bind exact P12 activation binding hash `68930447847df8d31de01b7fb60049136ae6fd0d74c837283fb837ff7e79961b`.
- No production authority enrollment or production grant issuance.
- No private key handling or signing code in production source.
- No activation, routing switch, environment mutation, deployment mutation, Supabase mutation, projection refresh, DDL, migration, or write RPC.
- Repository default remains graph-off and `production_source` remains `legacy-control`.
- Quick-only scope remains `REFERENCE_GRAPH_QUICK_RUNTIME=graph`; standard/deep remain legacy-only.
- Publishable-only runtime boundary and `1500 ms` timeout remain frozen from P12.
- Grant verification requires an explicit separately supplied trusted authority descriptor SHA-256 and fails closed if it is missing or mismatched.
- Grant lifetime is at most 15 minutes.

## Review Focus

- Caller supplies a self-generated authority descriptor and valid signature: verification must fail without the independently pinned authority hash. Covered in Task 1.
- Grant is correctly signed but changes P12 head/hash/request/scope: verification must fail before it can be treated as valid. Covered in Task 1.
- Grant is correctly signed but not yet valid, expired, or has a lifetime over 15 minutes: verification must fail. Covered in Task 1.
- P12 evidence remains green but its committed bytes or binding contract drift: request/repository verification must fail. Covered in Tasks 1 and 3.
- An operator/source change adds signing, private-key handling, activation, env mutation, Supabase writes, or migration `010+`: permanent governance must fail. Covered in Task 4.

---

### Task 1: Canonical Grant Request and Verify-only Authority Core

**Files:**
- Create: `reference-graph/p13-activation-grant-authority.mjs`
- Create: `tests/reference-graph/p13-activation-grant-authority.test.mjs`

**Interfaces:**
- Consumes: committed P12 receipt object plus SHA-256 of its exact bytes.
- Produces: `createP13GrantRequest({ p12Receipt, p12EvidenceSha256 })`, `hashP13GrantRequest(request)`, `hashP13AuthorityDescriptor(authority)`, `verifyP13ActivationGrant({ request, grant, authority, trustedAuthoritySha256, now })`.

- [ ] **Step 1: Write the failing core contract tests**

Add tests that assert the grant request freezes the exact P12 evidence head/binding/runtime scope; request and authority hashes are canonical and semantic-drift-sensitive; missing/mismatched trust anchor fails closed; wrong P12 head/hash/request/target/scope fails closed; expired/not-yet-valid/overlong/malformed grants fail closed; invalid signatures fail closed; and an ephemeral Ed25519 test grant verifies only with the exact authority hash.

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --test tests/reference-graph/p13-activation-grant-authority.test.mjs`

Expected: FAIL because `reference-graph/p13-activation-grant-authority.mjs` or the required exports do not exist.

- [ ] **Step 3: Implement the minimal verify-only core**

Implement the four exported functions. Use recursive-key canonical JSON and SHA-256. Parse authority public keys from SPKI base64 and use Ed25519 `verify`; do not add signing/private-key helpers. Return structured `{ grantVerified, checks, blockers, requestHash, authorityHash }` rather than throwing for normal verification failures; malformed programmer-level API shapes may throw `TypeError`.

- [ ] **Step 4: Run the focused test and full existing Reference Graph unit surface**

Run: `node --test tests/reference-graph/p13-activation-grant-authority.test.mjs`

Expected: PASS.

Run: `node --test tests/reference-graph/*.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

Commit: `feat: add P13 activation grant verifier`

---

### Task 2: Infrastructure Receipt and Secret Boundary

**Files:**
- Create: `reference-graph/p13-receipt.mjs`
- Create: `tests/reference-graph/p13-receipt.test.mjs`

**Interfaces:**
- Consumes: canonical P13 request/request hash plus repository checks from Task 3.
- Produces: `P13_PHASES`, `createP13Receipt(...)`, `recordP13Phase(...)`, `finalizeP13Receipt(...)`, `assertSecretFreeP13Receipt(receipt, secrets)`.

- [ ] **Step 1: Write failing receipt tests**

Assert exact schema/phases, immutable P12 head/hash fields, ordered phase transitions, terminal failure behavior, unique blockers, and final successful infrastructure state with `authority_state: unconfigured`, `trusted_authority_sha256: null`, `grant_state: not-issued`, `grant_verified: false`, `activation_authorized: false`, `activation_performed: false`, repository default false, and `production_source: legacy-control`. Add credential/private-key-shaped field and literal secret rejection tests.

- [ ] **Step 2: Run receipt test and verify RED**

Run: `node --test tests/reference-graph/p13-receipt.test.mjs`

Expected: FAIL because `reference-graph/p13-receipt.mjs` does not exist.

- [ ] **Step 3: Implement minimal receipt state machine**

Keep P13 phases exactly `p12_binding`, `authority_policy`, `grant_verifier`, `activation_boundary`. Finalization may set `infrastructure_ready` true only when every phase is successful and supplied checks are structurally true. It must always preserve the P13 stop-boundary fields above.

- [ ] **Step 4: Verify GREEN and regression suite**

Run: `node --test tests/reference-graph/p13-receipt.test.mjs`

Expected: PASS.

Run: `node --test tests/reference-graph/*.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

Commit: `feat: add P13 infrastructure receipt`

---

### Task 3: Read-only P13 Operator

**Files:**
- Create: `reference-graph/cli/p13-activation-grant-authority.mjs`
- Create: `tests/reference-graph/p13-operator.test.mjs`

**Interfaces:**
- Consumes: Task 1 core, Task 2 receipt, committed `reference-graph/evidence/p12-activation-authority-evidence.json`.
- Produces modes `--plan`, `--emit-request`, `--verify-repository`, `--verify-grant <grant.json> <authority.json> <trusted-authority-sha256> <now-iso>`, and `--finalize-repository <snapshot.json>`.

- [ ] **Step 1: Write failing operator tests**

Assert `--plan` and `--emit-request` are offline/read-only and expose the exact P12 head/hash; `--verify-repository` recomputes the P12 evidence SHA-256 and validates the committed P12 non-authorizing state; `--verify-grant` fails without the exact authority hash and can verify a valid ephemeral fixture without changing activation state; `--finalize-repository` emits a secret-free infrastructure receipt; unsupported or activation-like modes fail.

- [ ] **Step 2: Run operator tests and verify RED**

Run: `node --test tests/reference-graph/p13-operator.test.mjs`

Expected: FAIL because the P13 CLI does not exist.

- [ ] **Step 3: Implement the read-only operator**

Repository verification must require the exact P12 binding hash, P12 preflight readiness, empty P12 blockers, not-issued P12 grant, false P12 authorization/activation/default, legacy production source, no migration `010+`, and unchanged legacy-default query behavior. The CLI may only read files and verify signatures.

- [ ] **Step 4: Verify GREEN and regression suite**

Run: `node --test tests/reference-graph/p13-operator.test.mjs`

Expected: PASS.

Run: `node --test tests/reference-graph/*.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

Commit: `feat: add P13 grant authority operator`

---

### Task 4: Permanent Governance and Operator Documentation

**Files:**
- Create: `tests/reference-graph/p13-ci-contract.test.mjs`
- Create: `reference-graph/P13.md`

**Interfaces:**
- Consumes: all P13 production files and existing `.github/workflows/verify-reference-graph.yml`.
- Produces: permanent source-level and workflow-level guards for the P13 stop boundary.

- [ ] **Step 1: Write failing governance tests**

Assert the existing workflow still executes `node --test tests/reference-graph/*.test.mjs` and the Reference Graph secret scan; production P13 files contain no private-key/signing APIs or signing/issue/activation/deployment/env-mutation CLI modes; no Supabase/write/refresh path is introduced; migrations remain capped at `009`; query default remains legacy; durable P13 evidence is secret-scanned when present; docs state that authority is unconfigured, grant is not issued, activation is false, and production remains legacy.

- [ ] **Step 2: Run governance test and verify RED**

Run: `node --test tests/reference-graph/p13-ci-contract.test.mjs`

Expected: FAIL because `reference-graph/P13.md` and/or required P13 governance assertions are not complete.

- [ ] **Step 3: Add P13 operator documentation and complete governance assertions**

Document exact modes, exact P12 anchors, trust-anchor semantics, 15-minute grant validity, no signer/private key, no Production Authority enrollment, no activation, and the later authority-enrollment/grant/activation separation.

- [ ] **Step 4: Verify GREEN and full Reference Graph suite**

Run: `node --test tests/reference-graph/p13-ci-contract.test.mjs`

Expected: PASS.

Run: `node --test tests/reference-graph/*.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

Commit: `test: govern P13 activation grant authority`

---

### Task 5: Durable P13 Evidence and Final Governance

**Files:**
- Create: `reference-graph/evidence/p13-activation-grant-authority-evidence.json`
- Modify only if evidence pinning requires it: `tests/reference-graph/p13-ci-contract.test.mjs`

**Interfaces:**
- Consumes: tested P13 implementation head from Tasks 1-4 and `--finalize-repository` from Task 3.
- Produces: canonical durable P13 infrastructure evidence with no trusted production authority and no grant.

- [ ] **Step 1: Write the evidence pin before creating the evidence**

Extend governance so that, when the P13 evidence file exists, it must have schema `reference-graph.p13-activation-grant-authority.v1`, exact P12 head/hash, `infrastructure_ready: true`, `authority_state: unconfigured`, `trusted_authority_sha256: null`, `grant_state: not-issued`, `grant_verified: false`, `activation_authorized: false`, `activation_performed: false`, repository default false, and `production_source: legacy-control`.

- [ ] **Step 2: Verify the evidence pin is RED while the evidence file is absent only through an explicit expected absence path**

Run: `node --test tests/reference-graph/p13-ci-contract.test.mjs`

Expected: PASS before evidence exists because the pin is conditional; separately run the operator finalization test from Task 3 to prove receipt generation. Do not fabricate a failing absence test.

- [ ] **Step 3: Generate and commit canonical P13 evidence from the tested implementation SHA**

Run: `node reference-graph/cli/p13-activation-grant-authority.mjs --finalize-repository <snapshot.json>` with a snapshot containing only the tested implementation SHA and verification/reference timestamps. Secret-scan the JSON before commit.

Expected durable state: infrastructure ready, production authority unconfigured, grant not issued, activation unauthorized/unperformed, repository default graph-off, production source legacy-control.

- [ ] **Step 4: Run all final verification**

Run: `node --test tests/reference-graph/*.test.mjs`

Expected: PASS with zero failures.

Run: `python3 skills/security-review-redirect/scripts/scan_secrets.py reference-graph`

Expected: PASS with no secret findings.

Run the repository's permanent Reference Graph governance workflow on the final branch/PR head.

Expected: all Reference Graph governance steps PASS.

- [ ] **Step 5: Commit**

Commit: `docs: record P13 activation grant authority evidence`

- [ ] **Step 6: Final branch review and Draft PR**

Review the complete diff from `5f676c806ae864b507723ea867f5e3afd6fd4adb` to final P13 head against the design, Review Focus, and stop boundary. Create a Draft PR stacked on `agent/reference-graph-p12` so the PR diff contains P13 only, and record the tested implementation SHA, final evidence head, governance run IDs, exact P12 head/hash, and explicit no-grant/no-activation boundary.