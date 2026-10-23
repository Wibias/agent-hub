# Reference Graph P3 Live Shadow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the Reference Graph safely against an explicitly bound dedicated Supabase project, collect durable live lexical/semantic/hybrid shadow evidence, and keep production retrieval on `legacy-control`.

**Architecture:** Supabase project creation and DDL application stay in the Supabase control-plane/database tool path; the repo does not grow a second infrastructure client. Repository code owns target binding, fail-closed live CLI validation, deployed semantic/hybrid retrieval, latency/evidence collection, and secret-free receipts while reusing P1/P2 import, embedding, and ranking modules.

**Tech Stack:** Node.js 24 ESM, PostgreSQL/Supabase, pgvector, PostgREST RPC, Ollama 384-dimensional embeddings, GitHub Actions, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-23-reference-graph-p3-live-shadow-design.md`

## Global Constraints

- Production retrieval remains `legacy-control`; P3 cannot cut over.
- No `skills/design-with-ai/**` changes.
- Never mutate the generically named existing Supabase project by assumption.
- Dedicated project purpose: `agent-hub-reference-graph`; preferred region: `eu-central-1`.
- Apply committed migrations `001_reference_graph.sql`, `002_reference_graph_rpc.sql`, `003_reference_graph_embeddings_rpc.sql` in order.
- Every live write must prove the bound project ref matches the Supabase URL before network mutation.
- Never persist or log service-role keys, database passwords, access tokens, bearer tokens, or Authorization headers.
- External reference content remains untrusted data and never gains Memory authority.
- Experimental embeddings require explicit acknowledgement and never imply cutover approval.
- Benchmark control time remains `2026-07-21T12:00:00.000Z`; current legacy-control health is reported separately.
- Cutover thresholds remain: >=20 cases, >=20 comparable, overlap >=0.65, top-1 >=0.75, graph empty <=0.05, exact surface >=0.70, exact platform >=0.80.

## Review Focus

- Wrong project URL + valid-looking credentials must fail before any live write (Task 1/3).
- Credential-bearing errors must be redacted before logs/receipts (Task 1/2).
- Failed deployment phases must block later success states (Task 2).
- No compatible persisted embeddings must be `unavailable`; provider/RPC errors remain `failed` (Task 4/6).
- Re-running the 600-record import must preserve `600` assets / `576` sources (Task 8).

---

## File Map

**Create**
- `reference-graph/target-binding.mjs`
- `reference-graph/p3-receipt.mjs`
- `reference-graph/live-shadow.mjs`
- `reference-graph/cli/p3-live-shadow.mjs`
- `tests/reference-graph/p3-target-binding.test.mjs`
- `tests/reference-graph/p3-receipt.test.mjs`
- `tests/reference-graph/p3-cli-targeting.test.mjs`
- `tests/reference-graph/p3-live-shadow.test.mjs`
- `tests/reference-graph/p3-latency.test.mjs`

**Modify**
- `reference-graph/cli/import-design-references.mjs`
- `reference-graph/cli/embed-design-references.mjs`
- `reference-graph/cli/shadow-design-references.mjs`
- `reference-graph/shadow-eval.mjs`
- `reference-graph/README.md`
- `.github/workflows/verify-reference-graph.yml`
- `tests/reference-graph/foundation-contract.test.mjs`

**Create only after live project provisioning**
- `reference-graph/target.json`
- `reference-graph/evidence/p3-live-shadow-evidence.json`

---

### Task 1: Target Binding and Identity Verification

**Files:** create `reference-graph/target-binding.mjs`; test `tests/reference-graph/p3-target-binding.test.mjs`.

**Interfaces**
- `validateTargetBinding(binding)` -> normalized `{ purpose, project_ref, project_name, region }`
- `readTargetBinding(filePath)` -> validated binding
- `assertBoundSupabaseUrl({ binding, supabaseUrl })` -> binding or throw
- `redactDiagnostics(value, secrets = [])` -> redacted string

- [ ] **Write failing tests**

```js
const binding = validateTargetBinding({
  purpose: 'agent-hub-reference-graph',
  project_ref: 'abcdefghijklmnopqrst',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
});
assert.equal(assertBoundSupabaseUrl({ binding, supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co' }), binding);
assert.throws(() => assertBoundSupabaseUrl({ binding, supabaseUrl: 'https://wrongref.supabase.co' }), /project ref/i);
assert.equal(redactDiagnostics('Bearer secret-value', ['secret-value']), 'Bearer [redacted]');
```

Also reject wrong purpose, malformed ref, non-HTTPS URL, suffix-host tricks, missing name/region.

- [ ] **Run RED:** `node --test tests/reference-graph/p3-target-binding.test.mjs` -> FAIL because module is missing.
- [ ] **Implement the four interfaces** using exact host equality `https://<project_ref>.supabase.co` (optional trailing slash only).
- [ ] **Run GREEN:** `node --test tests/reference-graph/p3-target-binding.test.mjs tests/reference-graph/*.test.mjs` -> PASS.
- [ ] **Commit:** `git commit -am "feat: bind Reference Graph live target identity"` (include new files explicitly).

### Task 2: Deployment Phase State and Secret-Free Receipt

**Files:** create `reference-graph/p3-receipt.mjs`; test `tests/reference-graph/p3-receipt.test.mjs`.

**Interfaces**
- `P3_PHASES = ['preflight', 'schema', 'import', 'embeddings', 'shadow']`
- `createP3Receipt({ binding, gitSha, verificationAt })`
- `recordP3Phase(receipt, { phase, status, detail })`
- `finalizeP3Receipt(receipt, { evaluations, currentControlHealth, cutoverReady })`
- `assertSecretFreeReceipt(receipt, secrets = [])`

- [ ] **Write failing state tests**

```js
let receipt = createP3Receipt({ binding, gitSha: 'a'.repeat(40), verificationAt });
receipt = recordP3Phase(receipt, { phase: 'preflight', status: 'success', detail: {} });
receipt = recordP3Phase(receipt, { phase: 'schema', status: 'success', detail: { migrations: ['001','002','003'] } });
receipt = recordP3Phase(receipt, { phase: 'import', status: 'failed', detail: { reason: 'count mismatch' } });
assert.throws(() => recordP3Phase(receipt, { phase: 'shadow', status: 'success', detail: {} }), /failed|phase order/i);
assert.equal(receipt.production_source, 'legacy-control');
assert.throws(() => assertSecretFreeReceipt({ authorization: 'Bearer abc' }, ['abc']), /secret/i);
```

Statuses are exactly `pending|success|failed|skipped|unavailable`. Evidence may set `cutover_ready`, but `production_source` stays `legacy-control`.

- [ ] **Run RED:** `node --test tests/reference-graph/p3-receipt.test.mjs` -> FAIL.
- [ ] **Implement immutable JSON-serializable receipt helpers**; timestamps come from caller, not hidden globals.
- [ ] **Run GREEN:** target + receipt tests -> PASS.
- [ ] **Commit:** `feat: add P3 deployment receipt contract`.

### Task 3: Require Bound Target on Existing Write CLIs

**Files:** modify import/embed CLIs; create/extend `tests/reference-graph/p3-cli-targeting.test.mjs`.

**Behavior**
- `--plan` remains credential- and target-free.
- `--apply` requires `--target <path>`.
- Validation order: parse intent -> require target -> read/validate binding -> compare `SUPABASE_URL` -> only then construct store/provider -> perform write.

- [ ] **Write failing CLI tests** asserting plan succeeds without target, apply fails without target, and mismatched target fails before mocked fetch/Ollama can run.
- [ ] **Run RED:** `node --test tests/reference-graph/p3-cli-targeting.test.mjs`.
- [ ] **Implement `--target` validation** in both apply paths; retain `--allow-experimental` for embedding persistence.
- [ ] **Run GREEN:** `node --test tests/reference-graph/p1-cli.test.mjs tests/reference-graph/p2-cli.test.mjs tests/reference-graph/p3-cli-targeting.test.mjs`.
- [ ] **Commit:** `feat: fail closed on unbound Reference Graph writes`.

### Task 4: Deployed Semantic/Hybrid Shadow Retrieval

**Files:** create `reference-graph/live-shadow.mjs`; modify shadow CLI; test `tests/reference-graph/p3-live-shadow.test.mjs`.

**Interfaces**
- `createSupabaseShadowRetriever({ store, queryProvider, mode, modelId, modelRevision })` where `mode = lexical|semantic|hybrid`.
- `probeCompatibleEmbeddings({ store, queryProvider, modelId, modelRevision })` -> `{ status: 'available'|'unavailable', model_id, model_revision }` or throw on provider/RPC failure.

`probeCompatibleEmbeddings` must use the exact model/revision semantic path (no filters, bounded limit) rather than total embedding count; total stats alone are insufficient to prove compatibility.

- [ ] **Write failing retriever tests**

```js
await createSupabaseShadowRetriever({ store, queryProvider, mode: 'semantic', modelId, modelRevision })({ query, filters, maxItems: 4 });
assert.equal(store.lexicalCalls, 0);
assert.equal(store.semanticCalls, 1);

await createSupabaseShadowRetriever({ store, queryProvider, mode: 'hybrid', modelId, modelRevision })({ query, filters, maxItems: 4 });
assert.equal(store.lexicalCalls, 1);
assert.equal(store.semanticCalls, 1);
```

Pin: zero exact-model semantic candidates during the no-filter probe -> `unavailable`; provider/RPC exception -> thrown `failed` path, never downgraded to unavailable.

- [ ] **Run RED:** `node --test tests/reference-graph/p3-live-shadow.test.mjs`.
- [ ] **Implement retriever** using persisted document embeddings; generate only query embeddings locally with the pinned P2 profile.
- [ ] **Add CLI modes** `--supabase-semantic --target <path>` and `--supabase-hybrid --target <path>`; existing `--supabase` remains lexical.
- [ ] **Run GREEN:** persistence + P2 semantic + P3 live-shadow tests -> PASS.
- [ ] **Commit:** `feat: add deployed semantic shadow retrieval`.

### Task 5: Add Latency Evidence Without Changing Quality Metrics

**Files:** modify `reference-graph/shadow-eval.mjs`; test `tests/reference-graph/p3-latency.test.mjs`.

**Interfaces**
- `runCatalogShadowEvaluation({... , nowMs = performance.now })` adds `graph_latency_ms` per row.
- `summarizeShadowEvaluation(rows, thresholds)` adds `latency_ms: { min, p50, p95, max, average }`.

- [ ] **Write failing deterministic test** with latencies `[10,20,100]`; expect `{min:10,p50:20,p95:100,max:100,average:130/3}`.
- [ ] **Run RED:** `node --test tests/reference-graph/p3-latency.test.mjs`.
- [ ] **Implement monotonic timing**; use nearest-rank percentiles; empty finite set yields null fields.
- [ ] **Prove existing quality metrics unchanged** using existing P1/P2 evaluator tests.
- [ ] **Commit:** `feat: record Reference Graph shadow latency`.

### Task 6: Focused P3 Operator CLI

**Files:** create `reference-graph/cli/p3-live-shadow.mjs`; modify README; extend P3 CLI/receipt tests.

**Modes:** exactly one of `--preflight`, `--verify-import`, `--verify-embeddings`, `--shadow-lexical`, `--shadow-semantic`, `--shadow-hybrid`, always with `--target <path>` for live operations. Optional `--receipt-out <path>` writes a secret-free result fragment.

- [ ] **Write failing tests** for mismatched target, multiple modes, `production_source: 'legacy-control'`, benchmark control time, current control health, embedding availability, latency summary, and receipt redaction.
- [ ] **Run RED:** P3 CLI + receipt tests.
- [ ] **Implement CLI**: `--verify-import` requires live stats `assets=600`, `sources=576`; `--verify-embeddings` calls the exact model/revision probe from Task 4, not aggregate stats.
- [ ] **Run GREEN:** `node --test tests/reference-graph/*.test.mjs`.
- [ ] **Commit:** `feat: add P3 live shadow operator surface`.

### Task 7: Permanent Secret-Free P3 CI Gates

**Files:** modify `.github/workflows/verify-reference-graph.yml` and `tests/reference-graph/foundation-contract.test.mjs`.

- [ ] **Write failing workflow contract** requiring the existing full Reference Graph tests plus a P3 artifact secret scan.
- [ ] **Run RED:** `node --test tests/reference-graph/foundation-contract.test.mjs`.
- [ ] **Add scan step** that inspects `reference-graph/target.json` and `reference-graph/evidence/p3-live-shadow-evidence.json` when present. Reject secret-bearing field names/patterns such as `SUPABASE_SERVICE_ROLE_KEY`, `service_role_key`, database password fields, `authorization`, `Bearer ` values, `sb_secret_...`, and access-token/JWT material. Do **not** reject the public PostgreSQL role name `service_role` by itself.
- [ ] **Run GREEN:** all Reference Graph tests plus the existing disposable pgvector migration/grant smoke.
- [ ] **Commit:** `ci: gate P3 live shadow contracts`.

### Task 8: Provision Dedicated Target and Produce Live Evidence

This task is intentionally gated by external infrastructure authorization. It uses Tasks 1-7 but does not hide project creation or DDL inside repo code.

**Live artifacts:** `reference-graph/target.json`, `reference-graph/evidence/p3-live-shadow-evidence.json`.

- [ ] **Organization/cost gate:** list available Supabase organizations/projects; ask which organization owns `agent-hub-reference-graph`; follow the current Supabase project-cost confirmation flow and do not create the project until any required nonzero cost is explicitly accepted.
- [ ] **Create dedicated project** named `agent-hub-reference-graph` in `eu-central-1`; wait for `ACTIVE_HEALTHY`. Do not modify the existing generic project.
- [ ] **Commit non-secret binding** with purpose/project_ref/project_name/region; run target-binding tests.
- [ ] **Live preflight:** confirm Supabase control-plane project ref/region and run `p3-live-shadow.mjs --preflight --target reference-graph/target.json` with server-side credentials supplied outside the repo.
- [ ] **Apply DDL** using Supabase `apply_migration` with exact committed SQL, in order. Use migration names `reference_graph_001_schema`, `reference_graph_002_rpc`, `reference_graph_003_embeddings_rpc`; then `list_migrations` and verify all three.
- [ ] **Run security + performance advisors.** Any new blocking security finding stops P3; fix through tested migration work before continuing.
- [ ] **Verify RPC permissions**: privileged stats call succeeds; anon/authenticated execution of privileged RPCs is denied.
- [ ] **Import plan:** confirm `600` records / `600` assets / `576` sources.
- [ ] **First bound import:** `node reference-graph/cli/import-design-references.mjs --apply --target reference-graph/target.json --batch-size 25`; then `--verify-import` -> `assets=600`, `sources=576`.
- [ ] **Idempotency import:** run the same import again; verify counts remain `600` / `576`.
- [ ] **Optional experimental embeddings:** if exact pinned Ollama revision is available, run embedding plan then bound apply with `--allow-experimental`. Use Supabase read-only SQL to verify exact grouped count by `model_id` + `model_revision` and 384 dimensions; do not infer compatibility from total embedding count. If unavailable, mark embeddings `unavailable` and continue lexical-only evidence.
- [ ] **Live shadow:** always run lexical; when compatible embeddings exist, also run semantic + hybrid. Each available class must complete all 24 cases, keep `production_source=legacy-control`, use the healthy benchmark time, and separately report current control health and latency.
- [ ] **Assemble receipt:** include target identity, Git SHA, migration history, advisor outcome, import stats, exact embedding model/revision/count when used, benchmark/current control health, lexical/semantic/hybrid metrics, latency, blockers, eligibility, verification time, and relevant run IDs. Secret-scan it through `p3-receipt.mjs`.
- [ ] **Final verification:** `node --test tests/reference-graph/*.test.mjs`, permanent Reference Graph workflow, broad Agent Hub governance, and diff check proving no `skills/design-with-ai/**` changes.
- [ ] **Commit live evidence:** `git add reference-graph/target.json reference-graph/evidence/p3-live-shadow-evidence.json reference-graph/README.md && git commit -m "docs: record P3 live shadow evidence"`.

P3 stops here. Do not merge, switch production retrieval, or enable any cutover in this plan.
