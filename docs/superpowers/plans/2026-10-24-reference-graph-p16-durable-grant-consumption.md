# Reference Graph P16 Durable Grant Consumption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship and live-deploy the durable atomic grant-nonce replay ledger required by the P15 activation executor, while leaving production routing unchanged and legacy-controlled.

**Architecture:** Add migration 010 with a private `reference_graph` ledger and a service-role-only public RPC, reuse `ReferenceGraphSupabaseStore` as the privileged transport, prove atomic/replay/privilege behavior in permanent governance, then deploy the exact migration to the bound Supabase project and record live readiness evidence. The actual environment/deployment actuator stays outside P16 and becomes P17.

**Tech Stack:** PostgreSQL 17 / Supabase, SQL, Node.js 24 ESM, `node:test`, GitHub Actions, existing Reference Graph governance.

**Spec:** `docs/superpowers/specs/2026-10-24-reference-graph-p16-durable-grant-consumption-design.md`

## Global Constraints

- Base exactly on P15 final evidence head `04b6056721697060d10dac640899a11d68c7bc05`.
- Bind P15 evidence SHA-256 `f95e2b2112962881d499191d21a762b2f2dca0e3abe28c65e2e8abc2f67bdbe7`.
- Live target is exactly Supabase project `vrznfnxzlxaavpqbzbzd` (`agent-hub-reference-graph`, `eu-central-1`).
- No signer, private key, authority shortcut, grant fabrication, production activation, routing change, Standard/Deep graph path, or provider-specific deployment adapter.
- Never consume a synthetic nonce in the live production ledger.
- Replay consumption is irreversible; there is no reset/unconsume path.
- Service-role credentials remain external and secret-free in repository artifacts.
- P16 must leave `REFERENCE_GRAPH_QUICK_RUNTIME` production state unchanged and `production_source=legacy-control`.

## Review Focus

- Two concurrent first-use attempts for the same nonce: exactly one succeeds and one reports replay.
- Replay must not disclose the original `consumption_id` or stored hashes.
- Uppercase, wrong-length, non-hex, empty, or null nonce/hash inputs must fail before insert.
- `PUBLIC`, `anon`, and `authenticated` must have neither table mutation/read authority nor RPC execution authority.
- A malformed RPC payload must fail closed in the Node adapter and must never be normalized into a successful P15 consumption result.

---

### Task 1: Migration 010 atomic ledger contract

**Files:**
- Create: `reference-graph/schema/010_reference_graph_activation_grant_consumption.sql`
- Create: `tests/reference-graph/p16-grant-consumption-sql.test.mjs`

**Interfaces:**
- Consumes: P15 `consumeGrantNonce(input)` exact result shape `{ consumed, consumption_id }`.
- Produces: `public.reference_graph_consume_activation_grant_nonce_p16(text,text,text,text) -> jsonb` backed by `reference_graph.activation_grant_consumptions_p16`.

- [ ] **Step 1: Write the failing SQL-structure contract**

Pin the private table name/fields, lowercase-64-hex checks, nonce PK, unique generated consumption UUID, `INSERT ... ON CONFLICT (nonce) DO NOTHING RETURNING`, exact true/id and false/null JSON outcomes, bounded `SECURITY DEFINER` search path, and explicit execute revokes/grant.

- [ ] **Step 2: Run RED**

Run: `node --test tests/reference-graph/p16-grant-consumption-sql.test.mjs`

Expected: FAIL because migration 010 does not exist.

- [ ] **Step 3: Implement migration 010**

Create the exact ledger and RPC from the design. Store only nonce, three hashes, generated consumption id, and consumed timestamp.

- [ ] **Step 4: Run GREEN**

Run the same test and the complete Reference Graph contract suite.

- [ ] **Step 5: Commit**

Commit only the migration and its structural tests.

### Task 2: Reuse the existing Supabase store as P15 consumer

**Files:**
- Modify: `reference-graph/supabase-store.mjs`
- Create: `tests/reference-graph/p16-supabase-store.test.mjs`

**Interfaces:**
- Consumes: existing `ReferenceGraphSupabaseStore.rpc(name,args)` secret-redacting service-role transport.
- Produces: `ReferenceGraphSupabaseStore.consumeActivationGrantNonceP16({ nonce, grant_payload_hash, request_hash, authority_hash })` returning the exact P15 consumption result.

- [ ] **Step 1: Write failing adapter tests**

Assert exact RPC name/argument mapping, exact success and replay shapes, malformed-response rejection, validation of the four 64-lowercase-hex inputs, and service-role-key redaction on transport errors.

- [ ] **Step 2: Run RED**

Run: `node --test tests/reference-graph/p16-supabase-store.test.mjs`

Expected: FAIL because the method does not exist.

- [ ] **Step 3: Implement the minimal store method**

Reuse `rpc()`; add no second client and no runtime-query import.

- [ ] **Step 4: Run GREEN**

Run the focused test and full Reference Graph suite.

- [ ] **Step 5: Commit**

Commit store + tests only.

### Task 3: Permanent disposable-DB replay and privilege proof

**Files:**
- Create: `tests/reference-graph/p16-ci-contract.test.mjs`
- Modify: `.github/workflows/verify-reference-graph.yml`
- Create: `reference-graph/P16.md`

**Interfaces:**
- Consumes: migration 010 and its RPC.
- Produces: permanent CI proof of migration application, one-shot semantics, concurrency safety, and closed unprivileged access.

- [ ] **Step 1: Write the failing governance contract**

Require migration 010 in the migration sequence and a named P16 DB smoke proving first-use success, replay false/null, no more than one ledger row per nonce, service-role execute, anon/auth execute denial, and private-table denial.

- [ ] **Step 2: Run RED**

Run the P16 CI contract. Expected: FAIL because workflow migration/smoke entries and P16 runbook are absent.

- [ ] **Step 3: Add migration 010 and P16 DB smoke to permanent workflow**

Use disposable PostgreSQL only. The smoke may use deterministic synthetic hashes/nonces because it is not the production ledger.

- [ ] **Step 4: Document P16/P17 boundary**

State that P16 deploys replay protection only; production activation and host actuator remain blocked.

- [ ] **Step 5: Run GREEN and commit**

Run all Reference Graph tests and let Reference Graph Governance pass end-to-end, including DB smokes.

### Task 4: Freeze the tested implementation and deploy migration 010 live

**Files:**
- No repository changes before the implementation SHA is green.
- Live target: Supabase `vrznfnxzlxaavpqbzbzd`.

**Interfaces:**
- Consumes: green implementation SHA from Tasks 1-3.
- Produces: live private table + service-role-only consume RPC on the exact dedicated project.

- [ ] **Step 1: Freeze a green implementation SHA**

Require complete Reference Graph Governance success on the exact head before live DDL.

- [ ] **Step 2: Verify live pre-state read-only**

Confirm project identity, migrations 001-009 live, no pre-existing P16 table/function, and no existing consumption rows.

- [ ] **Step 3: Apply the exact migration 010 to the bound Supabase project**

Use the Supabase migration tool with the repository SQL unchanged.

- [ ] **Step 4: Verify live structure without consuming a nonce**

Read catalogs/privileges to prove table/function existence and zero ledger rows. Do not invoke the consume RPC with a synthetic grant nonce.

- [ ] **Step 5: Run Supabase security and performance advisors**

Resolve any P16-attributable finding before proceeding.

### Task 5: Durable live evidence and final governance

**Files:**
- Create: `reference-graph/evidence/p16-durable-grant-consumption-evidence.json`
- Create: `tests/reference-graph/p16-evidence-binding.test.mjs`
- Modify: `.github/workflows/verify-reference-graph.yml` only if required to permanently secret-scan/bind the new evidence.

**Interfaces:**
- Consumes: tested implementation SHA, real green governance run id, live Supabase verification facts.
- Produces: durable P16 evidence proving replay infrastructure live while activation remains blocked/legacy.

- [ ] **Step 1: Write evidence-binding RED**

Pin exact P15 head/hash, implementation SHA, green governance run id, target project ref, live migration presence, zero production ledger rows, and the unchanged legacy/activation-false state.

- [ ] **Step 2: Confirm RED because evidence is absent**

The only expected failure is the missing P16 evidence artifact.

- [ ] **Step 3: Commit secret-free live evidence**

Record no service-role key, no grant/signature, no private/public authority key, and no fabricated actuator state.

- [ ] **Step 4: Run final Reference Graph Governance and Release Governance**

Both must pass on the final P16 evidence head.

- [ ] **Step 5: Update the stacked draft PR**

Record frozen implementation/evidence heads, governance run IDs, live Supabase status, and the remaining P17 blocker.
