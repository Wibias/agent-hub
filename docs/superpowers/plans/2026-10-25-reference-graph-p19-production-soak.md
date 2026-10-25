# Reference Graph P19 Production Soak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independently attestable, read-only 24-hour production-soak gate for the already activated Quick Reference Graph without performing repository-default promotion.

**Architecture:** Migration 011 exposes only a service-role-only aggregate attestation over the private P16 ledger. Node core modules separately implement publishable-only production health sampling and offline soak evaluation. A narrow CLI records sanitized attestation/sample/eligibility receipts outside the repository; CI proves migration privileges and all read-only/fail-closed boundaries in disposable PostgreSQL.

**Tech Stack:** Node.js 24 ESM, `node:test`, PostgreSQL 16/pgvector disposable CI, existing `ReferenceGraphSupabaseStore`, P17 local actuator/probe, Supabase REST RPC.

**Spec:** `docs/superpowers/specs/2026-10-25-reference-graph-p19-production-soak-design.md`

## Global Constraints

- Implementation base is `87415c0441b9ff9e1333177ef9b6cefae68ea6c6`.
- P18 receipt evidence SHA-256 is `5b86bd3aaa6a87399006126b56cb0db84212c48c8135acae9e77bd8d69dd5ba9`.
- Production target remains `https://vrznfnxzlxaavpqbzbzd.supabase.co` / project ref `vrznfnxzlxaavpqbzbzd`.
- P19 never generates, signs, consumes, retries, or resets an activation grant.
- P19 never mutates or rolls back P17 activation state.
- P19 never enables repository-default graph mode.
- P16 ledger table privileges remain private; only the new aggregate P19 RPC is executable by `service_role`.
- `SUPABASE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` must never reach the production P17/P11 probe.
- No raw grant, signature, nonce, consumption ID, API key, private/public authority key bytes, or local authority path may enter P19 durable output.
- Promotion eligibility requires 24 hours, at least 24 healthy samples, and no adjacent gap greater than 90 minutes.
- Live production migration 011 is not part of repository implementation execution; it happens only after the exact merged implementation SHA passes governance.

## Review Focus

- Malformed or extra-key attestation RPC responses must fail closed rather than being normalized permissively; Task 2 pins this.
- Wrong Supabase target or missing publishable key must produce an unhealthy sample without attempting a production probe; Task 3 pins this.
- Elevated Supabase credentials present in the operator environment must be absent from the env object passed into the P17 probe; Task 3 pins this.
- Duplicate timestamps, malformed JSONL, and >90 minute gaps must block eligibility even if every individual sample says healthy; Task 4 pins this.
- P19 workflow/CLI source must contain no activation/mutation entrypoint (`--activate-production`, `executeP17Activation`, consume RPC invocation, P17 apply/rollback); Task 6 pins this.

---

### Task 1: Migration 011 read-only activation attestation

**Files:**
- Create: `reference-graph/schema/011_reference_graph_activation_attestation.sql`
- Create: `tests/reference-graph/p19-activation-attestation-sql.test.mjs`

**Interfaces:**
- Consumes: P16 table `reference_graph.activation_grant_consumptions_p16`.
- Produces: `public.reference_graph_attest_activation_consumption_p19(text,text,text) -> jsonb` with exact keys `matching_count`, `total_count`, `exact_match`.

- [ ] **Step 1: Write failing SQL contract tests**

Add tests asserting migration 011:
- creates the exact RPC signature;
- validates all three hashes as lowercase 64-hex and raises `22023`;
- is `SECURITY DEFINER`, `STABLE`, fixed search path, 5s timeout;
- selects from P16 ledger and contains no INSERT/UPDATE/DELETE/TRUNCATE;
- returns only aggregate match/total/exact fields;
- revokes execute from all four roles then grants only service_role;
- does not grant table SELECT/INSERT or modify the P16 table definition.

- [ ] **Step 2: Run RED**

Run: `node --test tests/reference-graph/p19-activation-attestation-sql.test.mjs`
Expected: FAIL because migration 011 does not exist.

- [ ] **Step 3: Implement migration 011**

Use a PL/pgSQL `STABLE SECURITY DEFINER` function that validates inputs, computes `matching_count` and `total_count` with SELECTs only, and returns `jsonb_build_object('matching_count', ..., 'total_count', ..., 'exact_match', matching_count = 1)`.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/reference-graph/p19-activation-attestation-sql.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat: add P19 activation attestation RPC`

---

### Task 2: Supabase store attestation contract

**Files:**
- Modify: `reference-graph/supabase-store.mjs`
- Create: `tests/reference-graph/p19-supabase-store.test.mjs`

**Interfaces:**
- Consumes: `ReferenceGraphSupabaseStore.rpc(name,args)` and migration 011 RPC.
- Produces: `ReferenceGraphSupabaseStore.attestActivationConsumptionP19({ grant_payload_hash, request_hash, authority_hash }) -> { matching_count, total_count, exact_match }`.

- [ ] **Step 1: Write failing store tests**

Tests must prove:
- exact RPC name/argument mapping;
- all three input hashes must be lowercase 64-hex;
- valid `{matching_count:1,total_count:1,exact_match:true}` is returned unchanged;
- negative/non-integer counts, non-boolean exact_match, arrays, missing keys, or extra keys throw `P19 activation attestation response is malformed`;
- RPC error text still redacts a supplied secret key through existing transport.

- [ ] **Step 2: Run RED**

Run: `node --test tests/reference-graph/p19-supabase-store.test.mjs`
Expected: FAIL because method does not exist.

- [ ] **Step 3: Implement minimal normalizer and store method**

Add a focused `normalizeP19AttestationResponse()` beside the P16 normalizer and the new class method after `consumeActivationGrantNonceP16()`.

- [ ] **Step 4: Run GREEN plus existing P16/P18 store tests**

Run: `node --test tests/reference-graph/p19-supabase-store.test.mjs tests/reference-graph/p16-supabase-store.test.mjs tests/reference-graph/p18-supabase-secret-key.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat: add P19 Supabase attestation client`

---

### Task 3: Read-only production health sampler

**Files:**
- Create: `reference-graph/p19-production-soak.mjs`
- Create: `tests/reference-graph/p19-production-health.test.mjs`

**Interfaces:**
- Consumes: `readP17ActivationState({statePath})`, `probeP17Runtime({statePath,env})`.
- Produces: `sampleP19ProductionHealth({ env, statePath, now, monotonicNow, readState, probeRuntime })` returning a sanitized `reference-graph.p19-production-health-sample.v1` object.
- Produces: `runtimeEnvWithoutElevatedSupabaseCredentialsP19(env)` for explicit testability.

- [ ] **Step 1: Write failing health-sample tests**

Tests must assert:
- exact healthy state/probe produces `healthy=true`, empty blockers, canonical UTC timestamp, non-negative duration;
- wrong URL produces blocker `wrong-supabase-target` and does not call probe;
- missing publishable key produces blocker `missing-publishable-key` and does not call probe;
- legacy/malformed P17 state blocks with deterministic state blocker(s);
- Quick not graph or parity false blocks;
- Standard or Deep graph blocks;
- thrown probe becomes only `probe-error` without raw error text in the returned sample;
- env passed to probe retains URL/publishable key but omits both elevated credential names even when present on input;
- returned sample contains no raw records, API keys, nonce, consumption ID, signature, or grant.

- [ ] **Step 2: Run RED**

Run: `node --test tests/reference-graph/p19-production-health.test.mjs`
Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement sampler**

Use exact production target constant, injected clocks, P17 state/probe dependencies, deterministic blocker ordering, and no persistence.

- [ ] **Step 4: Run GREEN plus P17 probe tests**

Run: `node --test tests/reference-graph/p19-production-health.test.mjs tests/reference-graph/p17-activation-runner.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat: add P19 production health sampler`

---

### Task 4: Consumption attestation + 24-hour soak evaluator

**Files:**
- Modify: `reference-graph/p19-production-soak.mjs`
- Create: `tests/reference-graph/p19-soak-evaluator.test.mjs`

**Interfaces:**
- Consumes: immutable P18 receipt evidence and Task 2 store method.
- Produces: `attestP19ActivationConsumption({ p18Evidence, store, now })` returning `reference-graph.p19-activation-attestation.v1`.
- Produces: `evaluateP19PromotionReadiness({ attestation, samples })` returning `reference-graph.p19-promotion-readiness.v1`.

- [ ] **Step 1: Write failing attestation/evaluator tests**

Tests must prove:
- P18 evidence schema, target, activation success and three fixed hashes are required before RPC call;
- initial `{1,1,true}` attestation is healthy and secret-free;
- matching count !=1, total count !=1, or exact_match false blocks;
- 24 healthy hourly samples spanning exactly 23 hours are **not** eligible;
- 25 healthy hourly samples spanning 24 hours are eligible (minimum 24 samples still satisfied);
- 24 samples may be eligible only when their first/last timestamps span >=24h (e.g. longer spacing within 90-minute gap limit);
- any unhealthy sample blocks;
- duplicate timestamp blocks;
- any adjacent gap >90 minutes blocks;
- malformed/noncanonical timestamp blocks;
- repository-default enabled in any sample blocks even if `healthy` was forged true;
- output contains aggregates/blockers only, no individual raw probe data.

- [ ] **Step 2: Run RED**

Run: `node --test tests/reference-graph/p19-soak-evaluator.test.mjs`
Expected: FAIL because functions do not exist.

- [ ] **Step 3: Implement attestation and evaluator**

Pin the three P18 hashes and production target in validation. Sort samples by UTC timestamp, detect duplicates/gaps, and compute aggregate window/sample values. Keep evaluator pure and offline.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/reference-graph/p19-soak-evaluator.test.mjs tests/reference-graph/p19-production-health.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat: evaluate P19 production soak readiness`

---

### Task 5: Operator CLI and sanitized external receipts

**Files:**
- Create: `reference-graph/cli/p19-production-soak.mjs`
- Create: `tests/reference-graph/p19-production-soak-cli.test.mjs`

**Interfaces:**
- Consumes: Task 2 store, Tasks 3/4 core, frozen P18 receipt evidence.
- Produces modes `--attest-consumption <out.json>`, `--sample <samples.jsonl>`, `--evaluate <attestation.json> <samples.jsonl> <out.json>`.

- [ ] **Step 1: Write failing CLI tests**

Tests must prove:
- exact argument counts/modes;
- `--attest-consumption` verifies the exact P18 evidence SHA-256 before store creation, writes sanitized mode-0600 JSON, and never prints/serializes credentials;
- wrong P18 evidence bytes fail before any RPC;
- `--sample` never creates an elevated store, appends exactly one JSON line, prints same sample, returns 0 healthy / nonzero unhealthy;
- sample path parent directory is created and file uses restricted permissions when created;
- `--evaluate` parses nonblank JSONL lines, fails closed on malformed lines, writes sanitized mode-0600 eligibility JSON;
- error redaction removes secret/service-role/publishable values from stderr-facing error messages;
- CLI/source contains no activation confirmation token, P16 consume invocation, P17 apply/rollback, or production mutation call.

- [ ] **Step 2: Run RED**

Run: `node --test tests/reference-graph/p19-production-soak-cli.test.mjs`
Expected: FAIL because CLI does not exist.

- [ ] **Step 3: Implement CLI**

Use existing Node fs APIs, explicit `mode: 0o600`, append-only JSONL for samples, exact frozen P18 evidence path/hash, `ReferenceGraphSupabaseStore.fromEnv(env)` only for attestation mode, and sanitized error redaction.

- [ ] **Step 4: Run GREEN across all P19 Node tests**

Run: `node --test tests/reference-graph/p19-*.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat: add P19 production soak CLI`

---

### Task 6: P19 governance workflow and operator runbook

**Files:**
- Create: `.github/workflows/verify-reference-graph-p19.yml`
- Create: `reference-graph/P19.md`
- Create: `tests/reference-graph/p19-ci-contract.test.mjs`

**Interfaces:**
- Consumes: migration 011, all P19 tests/CLI.
- Produces: permanent PR/main governance and documented live deployment/soak procedure.

- [ ] **Step 1: Write failing CI contract test**

Test source must require workflow:
- triggers on pull requests and main pushes;
- Node 24;
- `node --test tests/reference-graph/p19-*.test.mjs`;
- secret scan and public release verification;
- disposable PostgreSQL service;
- migrations 001 through 011 in order;
- synthetic P16 consumption followed by P19 attestation expecting matching=1,total=1,exact=true;
- anon/authenticated no P19 execute;
- service_role P19 execute;
- no direct P16 table SELECT/INSERT for unprivileged/service roles;
- no production project ref/credentials passed to SQL smoke except documentation constants in repository source;
- no activation/mutation command in workflow.

- [ ] **Step 2: Run RED**

Run: `node --test tests/reference-graph/p19-ci-contract.test.mjs`
Expected: FAIL because workflow/runbook do not exist.

- [ ] **Step 3: Implement workflow and `P19.md`**

Document:
- migration 011 must be deployed only after merged implementation governance;
- one-time elevated attestation command;
- immediate removal of elevated keys from operator shell;
- hourly publishable-only `--sample` command with recommended external path;
- 24-hour `--evaluate` command;
- `eligible=true` is only readiness evidence, not permission to promote default;
- no reuse of the consumed P18 grant.

- [ ] **Step 4: Run GREEN and repository safety gates**

Run: `node --test tests/reference-graph/p19-*.test.mjs`
Expected: PASS.

Run: `python3 skills/security-review-redirect/scripts/scan_secrets.py reference-graph`
Expected: PASS.

Run: `node scripts/verify-public-release.mjs`
Expected: PASS.

- [ ] **Step 5: Run Reference Graph regression tests**

Run: `node --test tests/reference-graph/*.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `ci: govern P19 production soak gate`

---

## Final branch verification

- Confirm diff from `87415c0441b9ff9e1333177ef9b6cefae68ea6c6` contains only planned P19 files plus the minimal `supabase-store.mjs` extension.
- Run all P19 tests, full Reference Graph tests, secret scan, and public release verification.
- Open a draft PR to `main` and require all applicable governance workflows to complete successfully.
- Do not deploy migration 011 to production before the exact PR head/merged implementation has passed governance.
- After merge and post-merge governance, perform the live migration/attestation as an explicit production-operator step; the connected Supabase MCP permission failure is not a reason to weaken the design.
