# Reference Graph P3 Live Shadow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operate the Reference Graph end to end on an explicitly bound dedicated Supabase project, collect secret-free live lexical/semantic/hybrid shadow evidence, and keep production retrieval on `legacy-control`.

**Architecture:** Keep Supabase project creation and DDL application in the Supabase control-plane/database tool path rather than adding a second infrastructure client to the repository. Repository code owns target identity binding, fail-closed live CLI validation, deployed semantic/hybrid retrieval, latency/evidence collection, and durable secret-free receipts; existing P1/P2 import, embedding, and ranking modules remain the data-plane building blocks.

**Tech Stack:** Node.js 24 ESM, PostgreSQL/Supabase, pgvector, PostgREST RPC, Ollama 384-dimensional embeddings, GitHub Actions, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-23-reference-graph-p3-live-shadow-design.md`

## Global Constraints

- Production retrieval remains `legacy-control`; P3 cannot cut over.
- No `skills/design-with-ai/**` changes.
- Do not mutate the currently connected generically named Supabase project by assumption.
- Dedicated project purpose is `agent-hub-reference-graph`; preferred region is `eu-central-1`.
- Migrations remain exactly `001_reference_graph.sql`, `002_reference_graph_rpc.sql`, `003_reference_graph_embeddings_rpc.sql` in that order.
- Every live write must prove the expected project ref matches the Supabase URL before network mutation.
- `SUPABASE_SERVICE_ROLE_KEY`, database passwords, access tokens, and Authorization headers never enter repository artifacts or logs.
- External reference content remains untrusted data and never gains Memory authority.
- Experimental embeddings require explicit acknowledgement and never imply cutover approval.
- Quality benchmark control time remains `2026-07-21T12:00:00.000Z`; current legacy-control health is reported separately.
- Cutover thresholds remain: >=20 total cases, >=20 comparable cases, overlap >=0.65, top-1 >=0.75, graph empty <=0.05, exact surface >=0.70, exact platform >=0.80.

## Review Focus

- A valid key paired with the wrong Supabase project URL must fail before the first live write; Task 1 pins URL/project-ref mismatch rejection.
- Errors containing credential material must be redacted before logging or receipt serialization; Tasks 1 and 2 pin secret handling.
- A partially completed deployment must stop at the failed phase and must not mark later phases successful; Task 2 pins monotonic phase state.
- Missing compatible persisted embeddings must be reported as `unavailable`, while provider/RPC errors remain `failed`; Task 4 pins the distinction.
- Re-running the deterministic 600-record import against the same target must preserve 600 assets rather than duplicate them; Task 6 verifies live idempotency before acceptance.

---

## File Structure

**Create**
- `reference-graph/target-binding.mjs` — parse and verify non-secret target identity; URL/project-ref assertion; diagnostic redaction.
- `reference-graph/p3-receipt.mjs` — phase-state and durable secret-free deployment/evidence receipt contract.
- `reference-graph/live-shadow.mjs` — deployed lexical/semantic/hybrid challenger adapters using persisted embeddings.
- `reference-graph/cli/p3-live-shadow.mjs` — focused read/verify operator CLI for bound-target preflight and live shadow evidence.
- `tests/reference-graph/p3-target-binding.test.mjs`
- `tests/reference-graph/p3-receipt.test.mjs`
- `tests/reference-graph/p3-cli-targeting.test.mjs`
- `tests/reference-graph/p3-live-shadow.test.mjs`
- `tests/reference-graph/p3-latency.test.mjs`

**Modify**
- `reference-graph/cli/import-design-references.mjs` — require verified target binding for `--apply`; keep `--plan` credential-free.
- `reference-graph/cli/embed-design-references.mjs` — require verified target binding for `--apply`; retain `--allow-experimental`.
- `reference-graph/cli/shadow-design-references.mjs` — add deployed semantic/hybrid modes through `live-shadow.mjs` without changing local P2 modes.
- `reference-graph/shadow-eval.mjs` — attach per-case graph latency and summary latency statistics without changing quality metrics.
- `reference-graph/README.md` — P3 operator sequence, target-binding contract, no-cutover boundary.
- `.github/workflows/verify-reference-graph.yml` — gate new P3 contracts and ensure receipts/config fixtures contain no secrets.

**Create only after the dedicated live project exists**
- `reference-graph/target.json` — committed non-secret binding `{purpose, project_ref, project_name, region}`.
- `reference-graph/evidence/p3-live-shadow-evidence.json` — committed final live receipt/evidence after successful verification.

---

### Task 1: Target Binding and Fail-Closed Identity Verification

**Files:**
- Create: `reference-graph/target-binding.mjs`
- Test: `tests/reference-graph/p3-target-binding.test.mjs`

**Interfaces:**
- Produces: `validateTargetBinding(binding) -> { purpose, project_ref, project_name, region }`
- Produces: `readTargetBinding(filePath) -> validated binding`
- Produces: `assertBoundSupabaseUrl({ binding, supabaseUrl }) -> binding`
- Produces: `redactDiagnostics(value, secrets = []) -> string`
- Consumed by: Tasks 3, 4, 6, and 8.

- [ ] **Step 1: Write failing tests for binding shape, URL matching, and redaction**

```js
assert.deepEqual(validateTargetBinding({
  purpose: 'agent-hub-reference-graph',
  project_ref: 'abcdefghijklmnopqrst',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
}), expected);
assert.throws(
  () => assertBoundSupabaseUrl({ binding: expected, supabaseUrl: 'https://wrongref.supabase.co' }),
  /project ref/i,
);
assert.equal(redactDiagnostics('Bearer secret-value', ['secret-value']), 'Bearer [redacted]');
```

Also assert malformed refs, non-HTTPS URLs, wrong purpose, missing region/name, and URL hosts with suffix tricks are rejected.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/reference-graph/p3-target-binding.test.mjs`
Expected: FAIL because `reference-graph/target-binding.mjs` does not exist.

- [ ] **Step 3: Implement the four exported interfaces**

Use exact hostname matching: the only accepted hosted URL form is `https://<project_ref>.supabase.co` with optional trailing slash. `readTargetBinding` reads JSON and delegates to `validateTargetBinding`; no secret values belong in the binding.

- [ ] **Step 4: Run focused tests and the existing P1/P2 contract suite**

Run: `node --test tests/reference-graph/p3-target-binding.test.mjs tests/reference-graph/*.test.mjs`
Expected: PASS with no existing Reference Graph regression.

- [ ] **Step 5: Commit**

```bash
git add reference-graph/target-binding.mjs tests/reference-graph/p3-target-binding.test.mjs
git commit -m "feat: bind Reference Graph live target identity"
```

### Task 2: Deployment Phase State and Secret-Free Receipt Contract

**Files:**
- Create: `reference-graph/p3-receipt.mjs`
- Test: `tests/reference-graph/p3-receipt.test.mjs`

**Interfaces:**
- Consumes: validated target binding from Task 1.
- Produces: `P3_PHASES = ['preflight', 'schema', 'import', 'embeddings', 'shadow']`
- Produces: `createP3Receipt({ binding, gitSha, verificationAt }) -> receipt`
- Produces: `recordP3Phase(receipt, { phase, status, detail }) -> new receipt`
- Produces: `finalizeP3Receipt(receipt, { evaluations, currentControlHealth, cutoverReady }) -> receipt`
- Produces: `assertSecretFreeReceipt(receipt, secrets = []) -> true`

- [ ] **Step 1: Write failing phase-state and receipt tests**

```js
const receipt = createP3Receipt({ binding, gitSha: 'a'.repeat(40), verificationAt });
assert.equal(receipt.production_source, 'legacy-control');
assert.equal(receipt.eligible_for_cutover_review, false);
const afterSchema = recordP3Phase(receipt, { phase: 'schema', status: 'success', detail: { migrations: ['001','002','003'] } });
assert.throws(
  () => recordP3Phase(afterSchema, { phase: 'import', status: 'success', detail: {} }),
  /preflight|phase order/i,
);
assert.throws(
  () => assertSecretFreeReceipt({ token: 'secret-value' }, ['secret-value']),
  /secret/i,
);
```

Also pin: only `pending|success|failed|skipped|unavailable` are valid statuses; a failed phase blocks later success; `cutover_ready` can be evidence but never changes `production_source`.

- [ ] **Step 2: Run focused test and confirm RED**

Run: `node --test tests/reference-graph/p3-receipt.test.mjs`
Expected: FAIL because module is missing.

- [ ] **Step 3: Implement immutable receipt/state helpers**

Keep receipt schema JSON-serializable and deterministic except timestamps explicitly passed by the caller. Do not read environment secrets inside this module.

- [ ] **Step 4: Run receipt + target tests**

Run: `node --test tests/reference-graph/p3-target-binding.test.mjs tests/reference-graph/p3-receipt.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add reference-graph/p3-receipt.mjs tests/reference-graph/p3-receipt.test.mjs
git commit -m "feat: add P3 deployment receipt contract"
```

### Task 3: Require Target Binding on Existing Live Write CLIs

**Files:**
- Modify: `reference-graph/cli/import-design-references.mjs`
- Modify: `reference-graph/cli/embed-design-references.mjs`
- Test: `tests/reference-graph/p3-cli-targeting.test.mjs`

**Interfaces:**
- Consumes: `readTargetBinding`, `assertBoundSupabaseUrl` from Task 1.
- Existing `--plan` behavior must remain network/credential free.
- `--apply` gains required `--target <path>` and validates `SUPABASE_URL` before constructing a store or provider.

- [ ] **Step 1: Write failing CLI tests**

```js
const plan = spawnSync(process.execPath, ['reference-graph/cli/import-design-references.mjs', '--plan']);
assert.equal(plan.status, 0);
assert.doesNotMatch(plan.stderr.toString(), /target/i);

const applyWithoutTarget = spawnSync(process.execPath, ['reference-graph/cli/import-design-references.mjs', '--apply'], { env: fakeEnv });
assert.notEqual(applyWithoutTarget.status, 0);
assert.match(applyWithoutTarget.stderr.toString(), /--target/i);
```

Add a fixture target whose ref does not match `SUPABASE_URL`; assert both import and embedding apply modes fail before mocked `fetch`/Ollama transport can run. Retain the existing missing `--allow-experimental` failure.

- [ ] **Step 2: Run focused CLI tests and confirm RED**

Run: `node --test tests/reference-graph/p3-cli-targeting.test.mjs`
Expected: FAIL because apply modes do not require/verify a target.

- [ ] **Step 3: Add `--target <path>` resolution and validation to both apply paths**

Order is fixed: parse intent -> require target -> read/validate binding -> assert URL matches -> then construct `ReferenceGraphSupabaseStore` / Ollama provider -> then perform writes.

- [ ] **Step 4: Run P1/P2/P3 CLI tests**

Run: `node --test tests/reference-graph/p1-cli.test.mjs tests/reference-graph/p2-cli.test.mjs tests/reference-graph/p3-cli-targeting.test.mjs`
Expected: PASS; all plan modes remain credential-free.

- [ ] **Step 5: Commit**

```bash
git add reference-graph/cli/import-design-references.mjs reference-graph/cli/embed-design-references.mjs tests/reference-graph/p3-cli-targeting.test.mjs
git commit -m "feat: fail closed on unbound Reference Graph writes"
```

### Task 4: Deployed Semantic/Hybrid Shadow Retriever

**Files:**
- Create: `reference-graph/live-shadow.mjs`
- Modify: `reference-graph/cli/shadow-design-references.mjs`
- Test: `tests/reference-graph/p3-live-shadow.test.mjs`

**Interfaces:**
- Consumes: `ReferenceGraphSupabaseStore.lexicalCandidates`, `.semanticCandidates`, `.candidateContext`; `REFERENCE_EMBEDDING_PROFILE`; profile query provider.
- Produces: `createSupabaseShadowRetriever({ store, queryProvider, mode, modelId, modelRevision }) -> async graphRetrieve(args)` where `mode` is `lexical|semantic|hybrid`.
- Produces: `classifyEmbeddingAvailability({ stats, expectedCount }) -> { status: 'available'|'unavailable', ... }`.
- CLI adds `--supabase-semantic --target <path>` and `--supabase-hybrid --target <path>`; existing `--supabase` remains lexical.

- [ ] **Step 1: Write failing retriever tests**

```js
const semantic = createSupabaseShadowRetriever({ store, queryProvider, mode: 'semantic', modelId, modelRevision });
await semantic({ query: 'creator dashboard', filters, maxItems: 4 });
assert.equal(store.lexicalCalls, 0);
assert.equal(store.semanticCalls, 1);

const hybrid = createSupabaseShadowRetriever({ store, queryProvider, mode: 'hybrid', modelId, modelRevision });
await hybrid({ query: 'creator dashboard', filters, maxItems: 4 });
assert.equal(store.lexicalCalls, 1);
assert.equal(store.semanticCalls, 1);
```

Pin that zero compatible persisted embeddings yields `unavailable`, not `failed`; an RPC/provider exception propagates as a failure and must not be relabeled unavailable. Assert returned bundles still use bounded P0 fusion and one-hop context.

- [ ] **Step 2: Run focused test and confirm RED**

Run: `node --test tests/reference-graph/p3-live-shadow.test.mjs`
Expected: FAIL because `live-shadow.mjs` and deployed semantic/hybrid modes do not exist.

- [ ] **Step 3: Implement deployed retriever and CLI modes**

For semantic/hybrid, embed only each query locally using the pinned P2 profile; document vectors come exclusively from persisted Supabase embeddings. Never regenerate the 600 document vectors inside live shadow evaluation.

- [ ] **Step 4: Run semantic, store, and CLI tests**

Run: `node --test tests/reference-graph/p1-persistence.test.mjs tests/reference-graph/p2-semantic-shadow.test.mjs tests/reference-graph/p3-live-shadow.test.mjs tests/reference-graph/p2-cli.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add reference-graph/live-shadow.mjs reference-graph/cli/shadow-design-references.mjs tests/reference-graph/p3-live-shadow.test.mjs
git commit -m "feat: add deployed semantic shadow retrieval"
```

### Task 5: Add Shadow Latency Evidence Without Changing Quality Scoring

**Files:**
- Modify: `reference-graph/shadow-eval.mjs`
- Test: `tests/reference-graph/p3-latency.test.mjs`

**Interfaces:**
- `runCatalogShadowEvaluation(...)` keeps all existing return fields and adds `graph_latency_ms` to each row.
- `summarizeShadowEvaluation(rows, thresholds)` adds `latency_ms: { min, p50, p95, max, average }` computed only from finite non-negative row latencies.

- [ ] **Step 1: Write failing deterministic latency-summary tests**

```js
const summary = summarizeShadowEvaluation([
  comparableRow({ graph_latency_ms: 10 }),
  comparableRow({ graph_latency_ms: 20 }),
  comparableRow({ graph_latency_ms: 100 }),
]);
assert.deepEqual(summary.latency_ms, {
  min: 10,
  p50: 20,
  p95: 100,
  max: 100,
  average: 130 / 3,
});
```

Use an injected `nowMs`/clock function in `runCatalogShadowEvaluation` tests so no timing assertion depends on wall-clock speed. Existing overlap/top-1/surface/platform assertions must remain byte-for-byte equivalent for the same rows.

- [ ] **Step 2: Run focused test and confirm RED**

Run: `node --test tests/reference-graph/p3-latency.test.mjs`
Expected: FAIL because latency fields are missing.

- [ ] **Step 3: Add monotonic timing and percentile summary**

Default clock is `performance.now`; test clock is injectable. Percentiles use nearest-rank over sorted finite values; empty input yields null fields.

- [ ] **Step 4: Run all shadow evaluator tests**

Run: `node --test tests/reference-graph/p1-shadow-eval.test.mjs tests/reference-graph/p2-control-health.test.mjs tests/reference-graph/p3-latency.test.mjs`
Expected: PASS with unchanged quality metrics.

- [ ] **Step 5: Commit**

```bash
git add reference-graph/shadow-eval.mjs tests/reference-graph/p3-latency.test.mjs
git commit -m "feat: record Reference Graph shadow latency"
```

### Task 6: Focused P3 Operator CLI and Receipt Assembly

**Files:**
- Create: `reference-graph/cli/p3-live-shadow.mjs`
- Modify: `reference-graph/README.md`
- Test: extend `tests/reference-graph/p3-cli-targeting.test.mjs`
- Test: extend `tests/reference-graph/p3-receipt.test.mjs`

**Interfaces:**
- Consumes: target binding (Task 1), receipt helpers (Task 2), store adapter, deployed retriever (Task 4), evaluator (Task 5).
- CLI supports exactly one read/verify phase per invocation: `--preflight`, `--verify-import`, `--verify-embeddings`, `--shadow-lexical`, `--shadow-semantic`, `--shadow-hybrid` plus `--target <path>`.
- Produces JSON to stdout; optional `--receipt-out <path>` writes a secret-free receipt fragment/result.
- No schema mutation, catalog import, embedding persistence, project creation, or cutover is hidden behind this CLI.

- [ ] **Step 1: Write failing operator CLI tests**

```js
const bad = spawnSync(process.execPath, ['reference-graph/cli/p3-live-shadow.mjs', '--preflight', '--target', mismatchFixture], { env: fakeEnv });
assert.notEqual(bad.status, 0);
assert.match(bad.stderr.toString(), /project ref/i);

const conflictingModes = spawnSync(process.execPath, ['reference-graph/cli/p3-live-shadow.mjs', '--preflight', '--shadow-lexical', '--target', fixture], { env: fakeEnv });
assert.notEqual(conflictingModes.status, 0);
assert.match(conflictingModes.stderr.toString(), /exactly one/i);
```

Pin output `production_source: 'legacy-control'`, benchmark control time, current control health, embedding availability, and latency summary. Receipt tests must reject embedded secrets and full Authorization values.

- [ ] **Step 2: Run focused CLI/receipt tests and confirm RED**

Run: `node --test tests/reference-graph/p3-cli-targeting.test.mjs tests/reference-graph/p3-receipt.test.mjs`
Expected: FAIL because operator CLI is missing.

- [ ] **Step 3: Implement the focused verification CLI**

`--verify-import` requires live stats `assets === 600` and `sources === 576`; call out any mismatch without mutating data. `--verify-embeddings` reports unavailable when no compatible embeddings are present. Shadow modes never set a production selector.

- [ ] **Step 4: Run all Reference Graph tests**

Run: `node --test tests/reference-graph/*.test.mjs`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add reference-graph/cli/p3-live-shadow.mjs reference-graph/README.md tests/reference-graph/p3-cli-targeting.test.mjs tests/reference-graph/p3-receipt.test.mjs
git commit -m "feat: add P3 live shadow operator surface"
```

### Task 7: Permanent CI Coverage for P3 Non-Secret Contracts

**Files:**
- Modify: `.github/workflows/verify-reference-graph.yml`
- Test: existing `tests/reference-graph/*.test.mjs`

**Interfaces:**
- CI remains secret-free and uses disposable `pgvector/pg16` only.
- CI verifies target/receipt fixtures and scans committed P3 JSON artifacts for secret-like fields/values.
- CI does not call a live Supabase project.

- [ ] **Step 1: Add a failing repository contract if the workflow omits P3 gates**

Add assertions to the appropriate Reference Graph contract test that `.github/workflows/verify-reference-graph.yml` runs `tests/reference-graph/*.test.mjs` and a P3 artifact secret-scan command.

- [ ] **Step 2: Run the contract and confirm RED**

Run: `node --test tests/reference-graph/foundation-contract.test.mjs`
Expected: FAIL on missing P3 artifact scan step.

- [ ] **Step 3: Add the permanent secret-free P3 CI step**

The scan must inspect `reference-graph/target.json` and `reference-graph/evidence/p3-live-shadow-evidence.json` only when present and reject keys/values matching `service_role`, database password, bearer token, Authorization header, or Supabase secret/access-token material. Do not require live secrets in CI.

- [ ] **Step 4: Run local contract suite and the disposable PostgreSQL workflow equivalent**

Run: `node --test tests/reference-graph/*.test.mjs`
Then run the same `psql` migration/grant commands already present in `.github/workflows/verify-reference-graph.yml`.
Expected: tests and all three migrations/grant smokes PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/verify-reference-graph.yml tests/reference-graph/foundation-contract.test.mjs
git commit -m "ci: gate P3 live shadow contracts"
```

### Task 8: Provision Dedicated Supabase Target and Produce Live P3 Evidence

**Files created/modified only after explicit infrastructure authorization:**
- Create: `reference-graph/target.json`
- Create: `reference-graph/evidence/p3-live-shadow-evidence.json`
- Modify: `reference-graph/README.md` only if observed operator details differ from documented commands.

**Interfaces:**
- Consumes all Tasks 1-7.
- External control plane uses the Supabase project/migration/advisor tools; repository code does not create the project itself.
- Produces the final dedicated project binding and secret-free P3 receipt/evidence.

- [ ] **Step 1: Stop for organization and cost authorization before project creation**

At execution time, list available Supabase organizations/projects. Ask the user which organization should own `agent-hub-reference-graph`. Call Supabase cost lookup for a new project and present the exact recurring cost. Create the project only after the user explicitly accepts any nonzero cost/confirmation flow.

Expected: no existing generic project is modified.

- [ ] **Step 2: Bind and commit the non-secret project identity**

After project creation is ACTIVE_HEALTHY, obtain project ref/name/region and create:

```json
{
  "purpose": "agent-hub-reference-graph",
  "project_ref": "<real ref>",
  "project_name": "agent-hub-reference-graph",
  "region": "eu-central-1"
}
```

Run: `node --test tests/reference-graph/p3-target-binding.test.mjs`
Expected: PASS against the committed binding shape.

- [ ] **Step 3: Run live preflight before any DDL**

Use Supabase project metadata plus `node reference-graph/cli/p3-live-shadow.mjs --preflight --target reference-graph/target.json` once server-side credentials are supplied outside the repo.
Expected: project ref/URL match; no secret appears in output.

- [ ] **Step 4: Apply the three committed migrations with Supabase migration tooling**

Use `apply_migration` in order with names corresponding to `001_reference_graph`, `002_reference_graph_rpc`, `003_reference_graph_embeddings_rpc`, passing the exact committed SQL files. Do not rewrite SQL during live apply.

After apply: list migrations and verify all three are present.

- [ ] **Step 5: Run Supabase security and performance advisors**

Run both advisor classes. Expected: no new blocking security finding attributable to Reference Graph. If a security finding exists, STOP P3 and fix through a new tested migration before continuing.

- [ ] **Step 6: Verify RPC permissions before data import**

Execute read-only checks confirming `service_role` can call Reference Graph stats and exposed client roles cannot execute privileged RPCs. Expected: privileged success, anonymous/authenticated denial.

- [ ] **Step 7: Import the reviewed catalog and prove idempotency**

First run plan mode and confirm `600` records / `600` assets / `576` sources. Then run explicit bound apply:

`node reference-graph/cli/import-design-references.mjs --apply --target reference-graph/target.json --batch-size 25`

Run `--verify-import`; expected live stats: `assets=600`, `sources=576`. Run the same import a second time, then verify the counts remain `600` and `576`.

- [ ] **Step 8: Optionally persist the P2 experimental embeddings**

If Ollama with the exact committed model revision is available, run plan mode, then:

`node reference-graph/cli/embed-design-references.mjs --apply --target reference-graph/target.json --allow-experimental`

Run `--verify-embeddings`; expected compatible persisted count equals the current searchable chunk count and model/revision matches the committed P2 profile. If Ollama/profile is unavailable, mark embeddings `unavailable` and continue lexical-only live evidence rather than treating this as deployment failure.

- [ ] **Step 9: Run live shadow evidence classes**

Always run lexical:

`node reference-graph/cli/p3-live-shadow.mjs --shadow-lexical --target reference-graph/target.json --receipt-out /tmp/p3-lexical.json`

When embeddings are available, also run semantic and hybrid using the same target and healthy benchmark clock. Expected: 24 cases complete per available class; `production_source` remains `legacy-control`; current control health is reported separately; no automatic cutover occurs.

- [ ] **Step 10: Assemble and secret-scan the durable P3 receipt**

Merge target, migration, advisor, import, embedding availability, shadow metrics, latency summaries, current control health, benchmark time, Git SHA, and run IDs into `reference-graph/evidence/p3-live-shadow-evidence.json` through `p3-receipt.mjs`.

Run: `node --test tests/reference-graph/p3-receipt.test.mjs tests/reference-graph/*.test.mjs`
Expected: PASS; committed receipt contains no credential material.

- [ ] **Step 11: Run broad final governance**

Run permanent Reference Graph governance plus existing broad Agent Hub governance on the final P3 head. Confirm no `skills/design-with-ai/**` diff and no new failure beyond any separately documented pre-existing baseline issue.

- [ ] **Step 12: Commit final live binding/evidence**

```bash
git add reference-graph/target.json reference-graph/evidence/p3-live-shadow-evidence.json reference-graph/README.md
git commit -m "docs: record P3 live shadow evidence"
```

Do not merge or enable cutover as part of this task.
