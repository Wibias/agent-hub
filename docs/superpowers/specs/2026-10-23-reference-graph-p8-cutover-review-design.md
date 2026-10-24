# Reference Graph P8 — Cutover Review & Runtime Safety Design

## Intent

P7 proved exact graph-native lexical parity for the **quick** design-reference profile on the dedicated Reference Graph target. P8 does not activate that path. Its job is to prove that the real production handoff can be made safely later without weakening the current local-library contract, expanding privileged credentials into the design runtime, or accidentally routing standard/deep traffic through a path that has never been parity-certified.

P8 is therefore a **review and dry-run phase**. Production stays `legacy-control` for every profile.

## Current state

The production-facing design-reference command is:

`knowledge/design-references/scripts/query.mjs`

It is the command documented by both the shared Knowledge Index and `skills/design-with-ai/references/reference-library.md`. It is local/offline: it loads committed records and patterns, runs `selectRecords()`, records usage locally, and emits the stable JSON query contract.

P7 is different:

- `reference_graph_quick_candidate_pool_p7(jsonb)` exposes the current eligible graph pool;
- `selectP7ParityLexicalResults()` reproduces the frozen **quick** selector only;
- the policy explicitly rejects any request whose profile is not `quick`;
- live access currently requires the service-role-only Supabase RPC surface;
- P7's canonical receipt proves 24/24 quick cases at overlap `1.0`, top-1 `1.0`, empty `0`, with a byte-equivalent 275-row candidate pool;
- P7 still records `production_source: legacy-control`.

The normal query CLI therefore has two properties P8 must preserve:

1. standard/deep support exists only on the legacy path;
2. the normal design runtime does not require `SUPABASE_SERVICE_ROLE_KEY`.

## Goals

P8 must:

- prove the production query boundary and the graph parity boundary can coexist without behavior drift;
- keep the production `query.mjs` path unchanged and offline;
- make the profile boundary explicit: only `quick` is a graph cutover candidate;
- provide a read-only operator that dual-runs quick requests against legacy and P7 graph selection;
- hydrate graph-selected legacy IDs from the existing local catalog so future graph routing can preserve the established record payload contract;
- fail closed on missing, duplicate, or unknown graph IDs;
- never record usage during a review/dry-run;
- preserve P7's service-role-only DB grants;
- keep the service role credential out of `knowledge/design-references/**` and the normal `query.mjs` runtime;
- produce a canonical P8 review receipt that distinguishes **quick-path review eligibility** from **production activation readiness**;
- leave production routing unchanged.

## Non-goals

P8 does not:

- switch `query.mjs` to the graph;
- modify the Knowledge Index query command;
- modify `skills/design-with-ai/references/reference-library.md` to instruct production use of the graph;
- grant P7 RPC execution to `anon` or `authenticated`;
- introduce a new database migration;
- add ANN, semantic, or hybrid ranking;
- establish parity for standard or deep;
- write catalog records, freshness, TTL, review state, embeddings, or usage logs;
- merge P7/P8 or mark a PR ready;
- perform a cutover.

## Anti-goals

P8 is a failure if it achieves a convenient graph call by:

- placing `SUPABASE_SERVICE_ROLE_KEY` in normal design-reference runtime instructions;
- silently falling back from an explicitly requested graph review to an unreported legacy result;
- sending standard/deep through P7 because P7 happened to pass quick cases;
- recreating the query-output contract from incomplete graph metadata when the local canonical record already exists;
- changing query output, pattern selection, usage semantics, or exit codes in `query.mjs` during a review-only phase;
- lowering any P7/P5 quality gate;
- treating `cutover_ready` from P7 as permission to activate production.

## Approaches considered

### A. Global graph cutover in `query.mjs`

Rejected.

The CLI supports quick, standard, and deep, while P7 intentionally supports quick only. A global switch would claim evidence that does not exist.

### B. Quick-only direct graph switch in `query.mjs` using the Supabase service-role key

Rejected for P8.

It is technically possible, but it would expand a broad database credential into the normal design-agent runtime. P7 deliberately kept its RPCs service-role-only. P8 must not erase that security boundary merely to make activation easy.

### C. Separate quick-only dual-run review adapter, with legacy still serving production

Selected.

A separate read-only operator can use the existing privileged evidence path, fetch the P7 candidate pool, select graph IDs using the exact P7 policy, hydrate those IDs from the canonical local catalog, and compare them to the real legacy selection. This proves the handoff contract while keeping `query.mjs`, standard/deep, usage recording, and production routing untouched.

## Architecture

### 1. Pure cutover-review adapter

Create `reference-graph/p8-cutover-review.mjs`.

It owns no network access.

Primary interfaces:

```js
hydrateP8LegacyIds({ records, legacyIds })
```

Returns local catalog records in `legacyIds` order.

Contract:

- `records` must be an array of catalog records with unique non-empty `id` values;
- `legacyIds` must be an array of unique non-empty strings;
- every requested ID must exist exactly once locally;
- unknown or duplicate IDs fail closed;
- returned records are the original record objects, ordered exactly by graph selection order.

```js
compareP8QuickHandoff({ records, request, graphLegacyIds, legacySelection })
```

Contract:

- `request.profile` must be exactly `quick`;
- graph IDs are hydrated locally;
- compares ordered IDs against `legacySelection.selected`;
- returns parity diagnostics, hydrated graph records, and whether the handoff is exact;
- does not mutate records, selection, usage logs, or filesystem state.

```js
assessP8ActivationBoundary({ profile, handoffExact, runtimeCredentialMode })
```

Returns explicit review state:

- `quick` + exact handoff => `quick_path_review_eligible: true`;
- `standard`/`deep` => graph unsupported, legacy-only;
- `runtimeCredentialMode === 'service-role'` => production activation blocked even when quick parity is exact;
- P8 itself always returns `production_activation_ready: false`.

### 2. Read-only review operator

Create `reference-graph/cli/p8-cutover-review.mjs`.

Modes:

- `--offline-contract`
- `--supabase-quick-review --target <path>`

Both are read-only.

`--offline-contract`:

- loads the committed 24 quick shadow cases;
- loads local catalog records;
- computes legacy selections;
- derives an offline P7 candidate pool using committed catalog/metadata helpers;
- runs the exact P7 parity policy;
- hydrates selected IDs through the P8 adapter;
- reports handoff parity across all cases;
- never accesses Supabase and never records usage.

`--supabase-quick-review`:

- requires the existing target binding;
- requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only in this operator process;
- asserts the bound Supabase URL;
- reads the live P7 candidate pool through `ReferenceGraphSupabaseStore.quickCandidatePoolP7()`;
- runs the exact P7 policy over the same quick cases;
- compares against current legacy control and hydrates graph IDs locally;
- reports live handoff parity;
- never changes production routing or usage logs.

The operator must reject any non-quick request supplied through future per-request interfaces rather than silently using graph behavior.

### 3. Query CLI remains immutable

P8 does **not** edit:

- `knowledge/design-references/scripts/query.mjs`
- `skills/design-with-ai/references/reference-library.md`
- `knowledge/build-index.mjs`
- `knowledge/index.json`

Permanent governance pins the `query.mjs` Git blob from P7:

`4963cfbaf4306a03084f4513a1e324f649ce36e5`

It also asserts that `knowledge/design-references/**` contains no reference to `SUPABASE_SERVICE_ROLE_KEY` and no import of Reference Graph network clients.

### 4. P8 receipt

Create `reference-graph/p8-receipt.mjs`.

Schema:

`reference-graph.p8-cutover-review.v1`

Phases:

- `preflight`
- `offline_contract`
- `live_review`
- `security_boundary`

The final receipt carries:

- final P7 base SHA;
- P8 implementation SHA;
- target binding;
- P7 canonical receipt summary;
- current control health;
- candidate-pool health;
- offline and live handoff summaries;
- profile support matrix;
- credential boundary result;
- production source;
- activation performed flag;
- blockers.

Decision fields:

- `quick_path_review_eligible`
- `production_activation_ready`
- `production_source`
- `activation_performed`

P8 can set `quick_path_review_eligible: true` only if:

- P7 receipt remains cutover-ready and blocker-free;
- current control remains healthy;
- live pool remains complete/unique;
- offline and live quick handoff parity are exact over all 24 cases;
- all P8 phases succeed.

P8 must still set:

- `production_activation_ready: false`
- `production_source: 'legacy-control'`
- `activation_performed: false`

because the only available live credential is the service role and normal production routing remains intentionally unchanged.

Blockers must include the runtime credential boundary. Standard/deep are reported as legacy-only, not as failures of the quick review.

### 5. Security boundary

P8 does not weaken database grants.

The live review verifies:

- migration 007 remains applied;
- `reference_graph_quick_candidate_pool_p7(jsonb)` exists;
- `service_role` can execute;
- `anon` cannot execute;
- `authenticated` cannot execute;
- candidate pool is 275 eligible / 275 metadata-complete / 275 unique legacy IDs.

The service-role key is allowed only in explicit operator/evidence execution and must be redacted from all receipts and diagnostics.

### 6. Rollback semantics

P8 has no activation, so rollback is structurally trivial: production never leaves legacy.

The receipt nevertheless documents the future rollback invariant:

- the canonical production fallback is always `knowledge/design-references/scripts/query.mjs` legacy selection;
- future activation must be profile-scoped and reversible without catalog/database mutation;
- no future cutover may delete or rewrite the legacy selector as part of activation.

## Evidence strategy

P8 evidence uses three independent facts:

1. **Immutable P7 evidence:** exact quick parity, identity, live candidate-pool equivalence, and service-only grants.
2. **P8 offline handoff contract:** graph IDs hydrate to the same local records and preserve exact order across all 24 quick cases.
3. **P8 live review:** the current live candidate pool still produces exact handoff parity against the current legacy selector.

The live review may reuse P7's ranking policy but must execute through the P8 hydration/comparison adapter so it tests the production handoff boundary, not merely ranking again.

## Governance

Permanent Reference Graph CI must add:

- P8 contract tests;
- secret scan of P8 evidence;
- immutable P7 receipt checks;
- `query.mjs` blob immutability check;
- static guard against service-role references under `knowledge/design-references/**`;
- standard/deep graph-rejection tests;
- unknown/duplicate graph-ID fail-closed tests;
- offline 24-case handoff parity;
- existing migrations 001→007 and P7 DB smoke unchanged.

No migration 008 is needed.

## Stop boundary

P8 is complete when:

- the dry-run handoff adapter is tested;
- the operator proves exact offline/live quick handoff parity;
- the security boundary is explicitly evaluated;
- a canonical secret-free P8 receipt is committed;
- permanent Reference Graph governance is green;
- production remains `legacy-control`;
- PR remains draft/open/unmerged.

P8 must **not** activate graph routing.

A later phase may address a least-privilege runtime transport and then propose a reversible quick-only canary. That later phase requires its own design and evidence.