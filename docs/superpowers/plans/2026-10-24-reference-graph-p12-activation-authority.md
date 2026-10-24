# Reference Graph P12 Activation Authority Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a non-executable, machine-verifiable activation preflight that binds the exact P11 quick runtime conditions into one deterministic hash while keeping activation unauthorized, unperformed, and default-off.

**Architecture:** P12 adds one pure activation-binding/preflight module, one canonical receipt, and one read-only CLI that consumes repository state plus externally gathered live read-only state. Permanent governance proves the binding is benchmark-independent, non-activating, secret-free, and compatible with P11. Live execution only reads the dedicated Supabase target and commits a canonical receipt; P12 never mutates runtime configuration or database state.

**Tech Stack:** Node.js 24 ESM, `node:test`, built-in `crypto`/`fs`, existing Reference Graph receipt/target helpers, GitHub Actions, Supabase control-plane read-only verification.

**Spec:** `docs/superpowers/specs/2026-10-24-reference-graph-p12-activation-authority-design.md`

## Global Constraints

- Base exactly on final P11 evidence head `541e9667ea28c75de5492b79d84edf89f9cac8ac`.
- Bind P11 tested implementation SHA `849a8782be4081a5821bdb354e54c33b2e2b0fb9`.
- Dedicated target remains `vrznfnxzlxaavpqbzbzd / agent-hub-reference-graph / eu-central-1`.
- Activation scope remains `quick` only.
- Activation flag contract remains exact `REFERENCE_GRAPH_QUICK_RUNTIME=graph`.
- Runtime auth remains publishable-only; service-role runtime use is forbidden.
- Runtime timeout remains exactly `1500 ms`.
- Legacy-first + exact ordered record parity + exact ordered pattern parity remain mandatory.
- Standard and deep remain legacy-only with zero graph network calls.
- Projection preflight requires current UTC snapshot and exactly `275` candidates / `275` metadata-complete / `275` unique legacy IDs.
- P12 introduces no database migration and no projection refresh.
- P12 introduces no activation/deploy/set-env action.
- P12 final state always keeps `activation_authorized: false`, `activation_performed: false`, `repository_default_graph_enabled: false`, and `production_source: legacy-control`.
- A later phase must reference the exact P12 `binding_hash` before activation authority can exist.

## Review Focus

- **Canonical hash drift:** recursively reordered object keys must produce the same binding hash; any semantic field change must change it. Covered in Task 1 tests.
- **Readiness/authority confusion:** a fully green preflight must still finalize with authorization and activation false. Covered in Task 2 tests.
- **UTC rollover:** a live snapshot from yesterday must fail preflight even when every count and security check passes. Covered in Task 1 tests.
- **Hidden activation surface:** CLI/source must not gain `--activate`, `--apply`, `--deploy`, `--set-env`, environment mutation, or service-role runtime access. Covered in Tasks 3 and 4.
- **Historical/runtime drift:** changes to P11 evidence, query source, router source, quick-only scope, or standard/deep isolation must invalidate the binding/preflight. Covered in Tasks 1 and 4.

---

### Task 1: Pure Activation Binding and Preflight Evaluator

**Files:**
- Create: `reference-graph/p12-activation-authority.mjs`
- Test: `tests/reference-graph/p12-activation-authority.test.mjs`

**Interfaces:**
- Produces: `createP12ActivationBinding(input) -> binding`
- Produces: `hashP12ActivationBinding(binding) -> lowercase SHA-256 hex`
- Produces: `evaluateP12ActivationPreflight({ binding, p11Evidence, liveProjection, security, repository, now }) -> { preflightReady, bindingHash, checks, blockers }`
- Later tasks consume the returned binding/hash/checks without recomputing policy independently.

- [ ] **Step 1: Write failing binding tests**

Pin tests for:

- exact constant values from Global Constraints;
- stable hash under object-key reordering;
- changed target/date/source hash/timeout changes the hash;
- malformed hashes or target fail closed;
- yesterday's projection snapshot fails current-date preflight;
- `274`, duplicate IDs, missing metadata, or non-healthy target fail;
- P11 evidence without exact 24/24 canary, full fallback matrix, publishable-only security, or standard/deep isolation fails;
- repository source-hash mismatch or default-on state fails;
- green input returns `preflightReady: true` and no blockers.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test tests/reference-graph/p12-activation-authority.test.mjs`

Expected: FAIL only because `reference-graph/p12-activation-authority.mjs` does not exist.

- [ ] **Step 3: Implement the pure module**

`createP12ActivationBinding(input)` must validate and return the exact schema from the spec. Use recursively sorted object keys for canonical JSON; arrays preserve input order. `hashP12ActivationBinding` hashes canonical UTF-8 JSON with built-in `crypto`.

`evaluateP12ActivationPreflight` must build named booleans in `checks`, collect deterministic blocker strings, and never infer authorization or mutate inputs.

- [ ] **Step 4: Run focused and full Reference Graph tests**

Run:

```bash
node --test tests/reference-graph/p12-activation-authority.test.mjs
node --test tests/reference-graph/*.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add reference-graph/p12-activation-authority.mjs tests/reference-graph/p12-activation-authority.test.mjs
git commit -m "feat: add P12 activation preflight binding"
```

---

### Task 2: Canonical Non-Executable P12 Receipt

**Files:**
- Create: `reference-graph/p12-receipt.mjs`
- Test: `tests/reference-graph/p12-receipt.test.mjs`

**Interfaces:**
- Consumes: Task 1 binding/hash/preflight output.
- Produces: `P12_PHASES = ['binding', 'repository', 'live_preflight', 'rollback']`
- Produces: `createP12Receipt({ binding, target, baseSha, gitSha, verificationAt, referenceTime })`
- Produces: `recordP12Phase(receipt, { phase, status, detail, error })`
- Produces: `finalizeP12Receipt(receipt, { preflight, blockers })`
- Produces: `assertSecretFreeP12Receipt(receipt, secrets = [])`

- [ ] **Step 1: Write failing receipt tests**

Pin:

- phase ordering and terminal failure semantics;
- exact target/base/git/timestamps;
- binding hash preserved from Task 1;
- green preflight can set `preflight_ready: true` and `blockers: []`;
- **even with green preflight**, final receipt hard-sets `grant_state: 'not-issued'`, `activation_authorized: false`, `activation_performed: false`, `repository_default_graph_enabled: false`, `production_source: 'legacy-control'`;
- quick profile becomes `preflight-ready`, standard/deep remain `legacy-only`;
- failed preflight yields `preflight_ready: false` plus blockers;
- credential-shaped fields and supplied secret material are rejected.

- [ ] **Step 2: Run focused test and confirm RED**

Run: `node --test tests/reference-graph/p12-receipt.test.mjs`

Expected: FAIL only because `p12-receipt.mjs` is absent.

- [ ] **Step 3: Implement the receipt**

Follow P11 receipt structure, but keep readiness separate from authority. No function in this file may accept or produce a runtime activation command.

- [ ] **Step 4: Run focused + full tests**

Run:

```bash
node --test tests/reference-graph/p12-receipt.test.mjs
node --test tests/reference-graph/*.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add reference-graph/p12-receipt.mjs tests/reference-graph/p12-receipt.test.mjs
git commit -m "feat: add P12 activation authority receipt"
```

---

### Task 3: Read-Only Activation Preflight CLI

**Files:**
- Create: `reference-graph/cli/p12-activation-preflight.mjs`
- Test: `tests/reference-graph/p12-operator.test.mjs`

**Interfaces:**
- Consumes: Task 1 binding/evaluator and Task 2 receipt.
- CLI modes are exactly one of:
  - `--plan`
  - `--verify-repository`
  - `--finalize-snapshot <path>`
- `--finalize-snapshot` consumes a secret-free JSON file containing live target/projection/security observations gathered externally.
- No network write path and no activation mode exists.

- [ ] **Step 1: Write failing CLI contract tests**

Pin:

- `--plan` prints the non-secret expected contract and `activation_authorized: false`;
- repository verification hashes the exact current `knowledge/design-references/scripts/query.mjs`, `reference-graph/p11-runtime-router.mjs`, and P11 evidence bytes;
- `--finalize-snapshot` emits a receipt through `finalizeP12Receipt` and `assertSecretFreeP12Receipt`;
- mutually exclusive modes are enforced;
- source contains no `--activate`, `--apply`, `--deploy`, `--set-env`, `process.env.REFERENCE_GRAPH_QUICK_RUNTIME =`, service-role key lookup, database write RPC, or projection refresh call.

- [ ] **Step 2: Run focused test and confirm RED**

Run: `node --test tests/reference-graph/p12-operator.test.mjs`

Expected: FAIL because the CLI is absent.

- [ ] **Step 3: Implement the CLI**

Use built-in `fs`, `crypto`, and existing target/evidence files only. `--verify-repository` is zero-network. `--finalize-snapshot` trusts no booleans blindly; Task 1 evaluator must structurally validate counts/date/security/P11 evidence.

- [ ] **Step 4: Run focused + full tests**

Run:

```bash
node --test tests/reference-graph/p12-operator.test.mjs
node --test tests/reference-graph/*.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add reference-graph/cli/p12-activation-preflight.mjs tests/reference-graph/p12-operator.test.mjs
git commit -m "feat: add read-only P12 activation preflight operator"
```

---

### Task 4: Permanent Governance and Documentation

**Files:**
- Modify: `.github/workflows/verify-reference-graph.yml`
- Modify: `reference-graph/README.md`
- Create: `tests/reference-graph/p12-ci-contract.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: permanent CI guards before any live P12 evidence is trusted.

- [ ] **Step 1: Write failing CI-contract tests**

Require permanent workflow text for:

- optional P12 receipt secret scan through `assertSecretFreeP12Receipt`;
- immutable successful P11 evidence semantics and exact final P11 evidence head binding;
- deterministic P12 `--plan` + repository verification;
- repository default remains off;
- quick-only + standard/deep zero-network boundaries remain pinned;
- benchmark IDs/outcomes forbidden from P12 sources;
- service-role runtime/preflight credential names forbidden from P12 sources;
- no P12 activation-capable CLI verbs;
- migrations still end at existing `009`; P12 adds no migration `010`.

- [ ] **Step 2: Run CI-contract test and confirm RED**

Run: `node --test tests/reference-graph/p12-ci-contract.test.mjs`

Expected: FAIL until workflow/docs are updated.

- [ ] **Step 3: Update permanent governance and README**

Do not weaken existing P11/P10/P7 checks. Add P12-only checks and document readiness-vs-authority semantics.

- [ ] **Step 4: Run full Reference Graph governance locally/CI**

Run: `node --test tests/reference-graph/*.test.mjs` and the permanent GitHub Reference Graph workflow.

Expected: all Reference Graph steps green. Separate inherited Release Governance may remain red only for `write-swift skill must exist`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/verify-reference-graph.yml reference-graph/README.md tests/reference-graph/p12-ci-contract.test.mjs
git commit -m "ci: govern P12 activation authority preflight"
```

---

### Task 5: Live Read-Only P12 Preflight Evidence

**Files:**
- Create: `reference-graph/evidence/p12-activation-authority-evidence.json`

**Interfaces:**
- Consumes: final tested implementation from Tasks 1–4.
- Produces: canonical durable P12 receipt only; no runtime mutation.

- [ ] **Step 1: Freeze the tested implementation SHA**

Require permanent Reference Graph governance green on the exact implementation head before live evidence is generated.

- [ ] **Step 2: Verify target and migration state read-only**

Using Supabase control-plane tools, confirm:

- project `vrznfnxzlxaavpqbzbzd` is `ACTIVE_HEALTHY`;
- existing migrations through P10/P11-era stack remain present;
- P12 applies **no** migration.

- [ ] **Step 3: Gather live preflight snapshot**

Read only:

- current UTC projection snapshot date;
- candidate count;
- metadata-complete count;
- unique non-empty legacy ID count;
- target identity/health;
- current Security Advisor findings relevant to the P9/P10 runtime boundary.

Expected for a green preflight: current UTC date, `275 / 275 / 275`, no P9/P10-attributable WARN/ERROR.

If the projection is stale, stop with `preflight_ready: false`. **Do not refresh it in P12.**

- [ ] **Step 4: Finalize canonical receipt through production code**

Feed the secret-free live snapshot into `p12-activation-preflight.mjs --finalize-snapshot` (or an equivalent one-shot credential-free CI wrapper that calls the same exported code). Run `assertSecretFreeP12Receipt` before committing.

Require:

- `preflight_ready` reflects structural checks;
- `binding_hash` is present;
- `grant_state` remains `not-issued`;
- `activation_authorized === false`;
- `activation_performed === false`;
- `repository_default_graph_enabled === false`;
- `production_source === 'legacy-control'`.

- [ ] **Step 5: Commit only durable evidence**

No temporary workflow or snapshot helper remains in final tree.

```bash
git add reference-graph/evidence/p12-activation-authority-evidence.json
git commit -m "evidence: record P12 activation authority preflight"
```

---

### Task 6: Final Verification, Scope Review, and Draft PR Update

**Files:**
- No new product files expected.
- Update PR body only after verification.

**Interfaces:**
- Consumes: final P12 evidence head.
- Produces: reviewed, draft, unmerged P12 stack boundary.

- [ ] **Step 1: Run final permanent Reference Graph governance**

Require green on the exact evidence head.

- [ ] **Step 2: Verify inherited Release Governance separately**

If red, confirm it is still only the pre-existing `write-swift skill must exist` baseline. Do not repair it in P12.

- [ ] **Step 3: Review P11 → P12 diff**

Confirm no:

- `query.mjs` or P11 router behavior change;
- runtime default activation;
- deployment/env mutation;
- Supabase DDL/migration;
- catalog/freshness/TTL/review/access/embedding mutation;
- standard/deep graph support;
- service-role runtime path;
- temporary live-run workflow/file;
- benchmark-specific ranking or activation allowlist.

- [ ] **Step 4: Update stacked Draft PR**

PR base: `agent/reference-graph-p11`.

Record implementation SHA, evidence head, governance run IDs, live preflight observations, `binding_hash`, and explicit final state:

```text
preflight_ready: <measured>
grant_state: not-issued
activation_authorized: false
activation_performed: false
repository_default_graph_enabled: false
production_source: legacy-control
```

Keep PR **draft, open, unmerged**.

- [ ] **Step 5: Stop**

Do not issue or apply an activation grant. A later phase must reference the exact P12 `binding_hash` and receive separate explicit operator/deployment authority before normal-user activation.
