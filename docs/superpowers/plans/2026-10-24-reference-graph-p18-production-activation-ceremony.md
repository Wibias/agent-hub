# Reference Graph P18 Production Activation Ceremony Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-safe external Ed25519 authority ceremony and one-shot local Quick Reference Graph activation operator on top of P17.

**Architecture:** P18 keeps signing external to AgentHub. AgentHub only handles public authority material, exact canonical unsigned payload bytes, signature assembly/verification, preflight, and the final P17 activation call. Supabase elevated access is modernized to prefer `sb_secret_...` while preserving legacy `service_role` compatibility.

**Tech Stack:** Node.js 24 ESM, `node:test`, Node crypto for public-key validation/hash/randomness only, OpenSSL 3+ as external operator signer, existing P14/P15/P16/P17 modules, Supabase REST RPC.

**Spec:** `docs/superpowers/specs/2026-10-24-reference-graph-p18-production-activation-ceremony-design.md`

## Global Constraints

- P17 base/head is `1042b502e895e050b398f66b45b313c477eaab2f`.
- Production private key never enters the repository, `.agents`, Supabase, CLI args, env, logs, receipts, or CI.
- P18 production source contains no private-key generation/import/signing API.
- External signing uses OpenSSL Ed25519 over exact canonical UTF-8 payload bytes.
- Grant lifetime is 10 minutes in P18 and never exceeds P14/P13 max 15 minutes.
- Activation requires exact token `ACTIVATE-QUICK-REFERENCE-GRAPH`.
- P16 nonce consumption occurs before local mutation and is never retried.
- No migration 011+.
- Quick only may activate graph; Standard/Deep remain legacy.
- `SUPABASE_SECRET_KEY` is preferred; `SUPABASE_SERVICE_ROLE_KEY` is fallback only.
- `sb_secret_...` is sent only as `apikey`; legacy JWT elevated key keeps `Authorization: Bearer` compatibility.

## Review Focus

1. `sb_secret_...` must never be placed in `Authorization`; legacy service-role JWT must still work.
2. Canonical payload bytes signed by OpenSSL must be byte-for-byte what P13/P14 verifies.
3. A mismatched manually approved authority hash must block before any grant generation or activation.
4. Read-only preflight must never instantiate/call a consuming RPC path.
5. Activation must fail before nonce consumption on wrong target URL, missing publishable key, malformed/expired grant, or wrong confirmation token.

---

### Task 1: Modern elevated Supabase key transport

**Files:**
- Modify: `reference-graph/supabase-store.mjs`
- Create: `tests/reference-graph/p18-supabase-secret-key.test.mjs`

**Interfaces:**
- `ReferenceGraphSupabaseStore.fromEnv(env, options)` prefers `env.SUPABASE_SECRET_KEY`, falls back to `env.SUPABASE_SERVICE_ROLE_KEY`.
- `rpc()` always sends `apikey`; sends `authorization` only for non-`sb_secret_` elevated keys.

- [ ] Write RED tests for secret-key preference, secret-only header behavior, legacy fallback, and redaction.
- [ ] Run P18 test and verify only new expectations fail.
- [ ] Implement minimal transport change.
- [ ] Run full Reference Graph governance and commit GREEN.

### Task 2: Public authority descriptor and canonical grant artifacts

**Files:**
- Create: `reference-graph/p18-production-ceremony.mjs`
- Create: `tests/reference-graph/p18-production-ceremony.test.mjs`

**Interfaces:**
- `createP18AuthorityDescriptor({ publicKeySpkiDer, authorityId, keyId }) -> authority`
- `hashP18AuthorityDescriptor(authority) -> lowercase sha256`
- `createP18GrantArtifacts({ p13Evidence, authority, approvedAuthoritySha256, now, nonce? }) -> { enrollment_manifest, grant_payload, canonical_payload_utf8, payload_sha256 }`
- `assembleAndVerifyP18Grant({ p13Evidence, authority, approvedAuthoritySha256, grantPayload, signature, now }) -> { grant, verification }`

- [ ] RED: real Ed25519 SPKI accepted; non-Ed25519 rejected; manual approval mismatch rejected; 10-minute timestamps and 64-hex nonce pinned; canonical bytes hash equals P14 payload hash; 64-byte signature required; valid ephemeral test signature verifies.
- [ ] GREEN implementation using only public-key/hash/random APIs; no sign/private-key APIs.
- [ ] Commit.

### Task 3: P18 read-only production preflight

**Files:**
- Extend: `reference-graph/p18-production-ceremony.mjs`
- Extend: `tests/reference-graph/p18-production-ceremony.test.mjs`

**Interfaces:**
- `preflightP18ProductionActivation({ p13Evidence, authority, approvedAuthoritySha256, grant, env, statePath, now }) -> Promise<secret-free preflight>`

- [ ] RED tests for exact project URL, publishable key required, elevated secret/service-role key required, valid external authority approval, valid current signed grant, and legacy local pre-state.
- [ ] Prove preflight has no Supabase store/RPC dependency and no nonce consumption callback.
- [ ] GREEN implementation and commit.

### Task 4: Production activation CLI and composition

**Files:**
- Create: `reference-graph/cli/p18-production-activation.mjs`
- Create: `tests/reference-graph/p18-production-activation-cli.test.mjs`
- Create: `reference-graph/P18.md`

**Interfaces:**
- CLI modes exactly as defined in the P18 design spec.
- `--activate-production` calls `executeP17Activation()` only after successful P18 preflight and exact confirmation token.
- Elevated key comes from env only through `ReferenceGraphSupabaseStore.fromEnv()`.

- [ ] RED CLI tests for all modes, secret-free stdout/stderr, no signer/private-key APIs, and wrong-confirmation no-mutation.
- [ ] GREEN CLI implementation.
- [ ] Add Windows/OpenSSL runbook commands that keep private key outside `.agents` and use `pkeyutl -sign -rawin`.
- [ ] Full governance + public-release verification.
- [ ] Commit tested implementation SHA.

### Task 5: P18 governance and pre-activation evidence

**Files:**
- Create: `.github/workflows/verify-reference-graph-p18.yml`
- Create: `tests/reference-graph/p18-ci-contract.test.mjs`
- Create: `tests/reference-graph/p18-evidence-binding.test.mjs`
- Create: `reference-graph/evidence/p18-production-activation-preflight-evidence.json`

**Interfaces:**
- CI uses only ephemeral authority keys and mocked/disposable P16 consumption paths.
- No live Supabase secret or production activation in CI.

- [ ] RED governance/evidence tests.
- [ ] Add P18 workflow: tests, secret scan, public release, OpenSSL Ed25519 external-signing compatibility smoke, no migration 011+.
- [ ] Freeze pre-activation evidence with `activation_performed=false`, `grant_consumed=false`, `production_source=legacy-control`, `authority_state=awaiting-real-operator-key` until the actual local ceremony occurs.
- [ ] Run Reference Graph + P16 + P17 + P18 + Release governance and freeze implementation/evidence heads.

### Task 6: Real operator ceremony

**Files:** none committed for secret material.

- [ ] On the user's Windows host, generate encrypted Ed25519 private key outside `.agents` using OpenSSL and export public SPKI DER.
- [ ] Use P18 CLI to create authority descriptor; manually approve its hash into a separate external approval file.
- [ ] Use P18 CLI to prepare a fresh 10-minute payload/canonical file.
- [ ] Sign canonical file externally with OpenSSL `pkeyutl -sign -rawin`.
- [ ] Assemble and preflight the grant.
- [ ] Load `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and preferably `SUPABASE_SECRET_KEY` only into the current operator process environment.
- [ ] Execute `--activate-production ... ACTIVATE-QUICK-REFERENCE-GRAPH` exactly once.
- [ ] Capture secret-free receipt and verify Quick graph + Standard/Deep legacy or verified rollback.
- [ ] Only after real activation, freeze final P18 live evidence without any secret/key/signature material.
