# Reference Graph P12 — Activation Authority Preflight Design

## Intent

P11 proved that the real production design-reference query entrypoint can route `quick` requests through the Reference Graph behind the exact opt-in flag `REFERENCE_GRAPH_QUICK_RUNTIME=graph`, using only the least-privilege P10 publishable projection, while preserving exact public-output parity and failing closed to the existing legacy selector. P11 deliberately stopped at `quick_activation_ready: true`; repository defaults stayed legacy and no global activation was performed.

P12 creates the missing operational authority boundary **without activating anything**. It freezes the exact runtime, target, evidence, current-date snapshot, profile scope, transport, timeout, parity gate, and rollback contract into one deterministic activation binding. A read-only preflight may prove that binding is ready for a later operator decision, but P12 never issues an activation grant, never sets the runtime flag, never changes repository defaults, and never sends normal-user production traffic through the graph.

The distinction is structural:

- `preflight_ready: true` means the exact bound conditions are currently satisfied.
- `activation_authorized: false` means no separate execution authority has been issued.
- `activation_performed: false` means P12 did not turn the graph on.

## Goals

- Stack directly on final P11 evidence head `541e9667ea28c75de5492b79d84edf89f9cac8ac`.
- Bind P11's tested implementation SHA `849a8782be4081a5821bdb354e54c33b2e2b0fb9` and canonical P11 evidence.
- Bind the exact production query and P11 router source hashes used by the preflight.
- Bind the dedicated Supabase target `vrznfnxzlxaavpqbzbzd / agent-hub-reference-graph / eu-central-1`.
- Require the P10 runtime projection snapshot date to equal the preflight UTC date.
- Require the current projection to remain complete for the certified quick population: `275` candidates, `275` metadata-complete, `275` unique legacy IDs.
- Preserve P11's exact runtime contract: quick-only, publishable-only, `1500 ms` timeout, legacy-first selection, exact ordered record + pattern parity, fail-closed fallback.
- Preserve `standard` and `deep` as legacy-only with zero graph network calls.
- Preserve repository default-off behavior.
- Produce a deterministic SHA-256 `binding_hash` over the activation contract.
- Produce a canonical, secret-free P12 receipt proving whether the binding is preflight-ready.
- Keep any later activation dependent on a separate explicit operator/deployment authority that references the exact `binding_hash`.

## Non-goals

- No production activation.
- No environment-variable mutation.
- No deployment-platform mutation.
- No global or cohort rollout.
- No canary traffic beyond read-only preflight reads.
- No new Supabase DDL or migration.
- No projection refresh in P12.
- No catalog, freshness, TTL, review, access, embedding, pattern, or usage mutation.
- No changes to P7 ranking, P10 projection semantics, P11 routing, or public query output.
- No graph support for `standard` or `deep`.
- No service-role runtime path.
- No benchmark-specific allowlist or threshold change.

## Anti-goals

P12 must not let readiness become authority by convention. A green receipt must still contain:

- `activation_authorized: false`
- `activation_performed: false`
- `repository_default_graph_enabled: false`
- `production_source: legacy-control`
- `grant_state: not-issued`

P12 must not add an executable activation script, a deployment command that sets `REFERENCE_GRAPH_QUICK_RUNTIME`, a repository `.env` default, or any workflow that changes normal production runtime configuration.

## Existing Boundary

P11 already supplies the production-safe routing mechanism:

- exact activation flag: `REFERENCE_GRAPH_QUICK_RUNTIME=graph`
- quick-only graph attempt
- publishable-key transport only
- `1500 ms` runtime timeout
- legacy selection computed first
- graph authority only after exact ordered record and pattern parity
- unchanged public JSON payload after parity
- deterministic fallback for missing config, transport failure, stale/empty/malformed projection, hydration failure, and parity mismatch
- usage recorded exactly once after authority is chosen
- standard/deep zero-network isolation

P11 durable evidence at `reference-graph/evidence/p11-quick-activation-evidence.json` records:

- current-date projection snapshot `2026-10-24`
- candidate count `275`
- 24/24 authoritative graph canary cases
- 24/24 exact records
- 24/24 exact patterns
- 24/24 public CLI equivalence
- zero mismatches
- publishable runtime auth
- zero P9/P10-attributable Security Advisor WARN/ERROR findings
- repository default unchanged
- activation not performed

P12 does not reproduce or replace those mechanisms. It binds them.

## Approaches Considered

### 1. Activate quick globally now

P11 is technically activation-ready, so an operator could set the environment flag immediately. Rejected: readiness is not execution authority, and this would collapse the explicit stop boundary P11 established.

### 2. Commit graph as the repository default

This would make activation reproducible through source control. Rejected: it removes the reversible external control, turns a runtime decision into a code default, and would affect every deployment that consumes the repository.

### 3. Non-executable activation binding + read-only preflight — chosen

P12 defines one canonical binding object, proves it against repository and live read-only evidence, hashes it deterministically, and emits a secret-free receipt. The binding contains everything a later activation phase must reference, but P12 deliberately contains no grant and no activation action.

This preserves the separation between **technical readiness** and **operator authority** while making the next decision auditable and fail-closed.

## Canonical Activation Binding

Create a pure canonical binding with these exact fields:

```text
schema_version: reference-graph.p12-activation-binding.v1
p11_evidence_head: 541e9667ea28c75de5492b79d84edf89f9cac8ac
p11_implementation_sha: 849a8782be4081a5821bdb354e54c33b2e2b0fb9
target.project_ref: vrznfnxzlxaavpqbzbzd
target.project_name: agent-hub-reference-graph
target.region: eu-central-1
profile: quick
activation_flag: REFERENCE_GRAPH_QUICK_RUNTIME
activation_value: graph
runtime_auth_mode: publishable
service_role_runtime_allowed: false
timeout_ms: 1500
legacy_first: true
record_parity_required: exact-ordered
pattern_parity_required: exact-ordered
fallback_source: legacy-control
standard_mode: legacy-only
deep_mode: legacy-only
repository_default_graph_enabled: false
projection_snapshot_date: <preflight UTC YYYY-MM-DD>
projection_candidate_count: 275
projection_metadata_complete_count: 275
projection_unique_legacy_id_count: 275
query_source_sha256: <SHA-256 of production query.mjs>
router_source_sha256: <SHA-256 of p11-runtime-router.mjs>
p11_evidence_sha256: <SHA-256 of canonical P11 evidence bytes>
rollback_action: unset-or-change-REFERENCE_GRAPH_QUICK_RUNTIME
```

Canonicalization sorts object keys recursively and serializes arrays in declared order. `binding_hash` is lowercase SHA-256 hex over the canonical UTF-8 JSON bytes.

Any field drift creates a different binding and invalidates the earlier preflight.

## Preflight Contract

Create a pure evaluator:

```js
evaluateP12ActivationPreflight({
  binding,
  p11Evidence,
  liveProjection,
  security,
  repository,
  now,
}) -> {
  preflightReady,
  bindingHash,
  checks,
  blockers,
}
```

The evaluator is fail-closed. `preflightReady` is true only when all checks pass.

### P11 authority checks

The canonical P11 evidence must prove:

- `quick_activation_ready === true`
- `production_source === 'legacy-control'`
- `repository_default_graph_enabled === false`
- `activation_performed === false`
- quick is `activation-ready`
- standard/deep are `legacy-only`
- activated canary is 24/24 exact for records, patterns, and public CLI/coverage-exit behavior
- fallback matrix is fully true
- runtime auth mode is publishable
- service role runtime usage is false
- P9/P10-attributable Security Advisor WARN/ERROR count is zero

### Repository binding checks

The preflight must verify:

- current branch descends from final P11 evidence head
- the current `query.mjs` SHA-256 equals the binding value
- the current `p11-runtime-router.mjs` SHA-256 equals the binding value
- the committed P11 evidence SHA-256 equals the binding value
- no repository default sets `REFERENCE_GRAPH_QUICK_RUNTIME=graph`
- P12 introduces no migration `010` or later DDL for activation
- P12 runtime/preflight source contains no service-role credential lookup

### Live projection checks

Read-only live state must prove:

- target is the dedicated project and is healthy
- projection snapshot date equals `now.toISOString().slice(0, 10)`
- candidate count is `275`
- metadata-complete count is `275`
- unique legacy ID count is `275`
- no empty or duplicate legacy IDs

P12 does not refresh the projection. A stale projection fails preflight and requires a separate operator refresh/reverification path before another P12 preflight can pass.

### Security checks

- runtime transport remains publishable-only
- no service-role runtime path exists
- P9/P10-attributable Security Advisor WARN/ERROR findings remain zero
- P10 projection remains the only runtime-readable graph surface required by P11

## Receipt Contract

Create `reference-graph.p12-activation-authority.v1` with phases:

1. `binding`
2. `repository`
3. `live_preflight`
4. `rollback`

Final receipt fields include:

- exact target
- P11 base/evidence/implementation bindings
- P12 implementation SHA
- verification/reference timestamps
- canonical activation binding
- `binding_hash`
- structured checks
- blockers
- `preflight_ready`
- `grant_state: not-issued`
- `activation_authorized: false`
- `activation_performed: false`
- `repository_default_graph_enabled: false`
- `production_source: legacy-control`
- `profile_support.quick: preflight-ready | blocked`
- `profile_support.standard: legacy-only`
- `profile_support.deep: legacy-only`

A successful P12 receipt may have `blockers: []` while still keeping authorization false. Missing authorization is not a P12 failure; it is the intentional stop boundary.

## Operator Contract

Create a read-only CLI/operator that can:

- print the expected activation binding plan without network access;
- verify repository source/evidence hashes;
- consume a live projection/security snapshot and finalize the P12 receipt;
- reject credential-shaped output;
- never set environment variables;
- never call projection refresh;
- never call a write RPC;
- never change deployment configuration.

The operator must not contain a `--activate`, `--apply`, `--deploy`, `--set-env`, or equivalent action.

## Rollback Contract

The later activation mechanism remains reversible by one external runtime configuration change:

`unset or change REFERENCE_GRAPH_QUICK_RUNTIME`

P12 verifies that:

- default-off quick performs zero graph fetches;
- standard/deep perform zero graph fetches regardless of flag;
- legacy fallback remains valid for every P11 failure class;
- rollback requires no DDL, catalog mutation, or repository revert.

## Governance

Permanent Reference Graph governance must add P12 checks for:

- P11 evidence immutability and successful activation-readiness semantics;
- deterministic P12 binding hash;
- no activation-capable CLI flags or deployment writes;
- repository default remains graph-off;
- no service-role runtime/preflight credential path;
- no migration `010` introduced by P12;
- P12 receipt secret scan;
- quick-only scope and standard/deep zero-network isolation remain pinned.

The existing unrelated Release Governance `write-swift skill must exist` failure remains out of scope.

## P12 Stop Boundary

P12 stops when the exact activation binding is reproducible, current-date live preflight is green, rollback/default-off semantics are reverified, permanent governance is green, and durable secret-free evidence records the binding hash.

Even on success:

- `preflight_ready` may be true;
- `activation_authorized` remains false;
- `activation_performed` remains false;
- repository default remains legacy;
- production source remains `legacy-control`;
- PR remains draft/open/unmerged.

A later phase must obtain separate explicit operator/deployment authority referencing the exact P12 `binding_hash` before any normal-user activation is attempted.
