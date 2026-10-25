# Reference Graph P19 Production Soak and Promotion Readiness Design

## Intent

P19 turns the successful P18 Quick production cutover into an independently attestable, continuously checkable production-soak gate. It must prove the durable P16 consumption without exposing private ledger rows, sample the real P17/P11 production path without elevated runtime credentials, and evaluate a bounded soak window before any repository-default promotion is considered.

P19 does **not** perform repository-default promotion. A later promotion remains a separate explicitly authorized one-shot change.

## Starting point

- Current implementation base: `87415c0441b9ff9e1333177ef9b6cefae68ea6c6`.
- P18 production activation happened on `main` SHA `6c60d1a56c3a08b689b6b58b5f79cc6f45c7ea67`.
- Frozen P18 production receipt evidence: `reference-graph/evidence/p18-production-activation-receipt-evidence.json`.
- Frozen P18 receipt evidence SHA-256: `5b86bd3aaa6a87399006126b56cb0db84212c48c8135acae9e77bd8d69dd5ba9`.
- Production target remains project ref `vrznfnxzlxaavpqbzbzd` at `https://vrznfnxzlxaavpqbzbzd.supabase.co`.
- Real activation receipt binds:
  - authority SHA-256 `e3554b76b8add430a6e0276e97c9cb16702f6af57764db53445d00b49f6e965c`
  - request hash `ed31630f9bda1362f42e747a6366d8504d17638b8ba458228db6fec5a2074ce7`
  - grant payload hash `e2ae9a9608590b1256573b6770a226daf4b38ae0440027570f90752ec6caa465`
- Current intended runtime state is Quick -> `reference-graph`, Standard/Deep -> `legacy-control`, repository default graph disabled.
- P16 deliberately grants no direct SELECT on `reference_graph.activation_grant_consumptions_p16`, including to `service_role`.
- The connected Supabase MCP identity cannot independently read the P16 ledger or list migrations, so P19 must provide a governed attestation surface rather than weakening P16 table privileges.

## Goals

1. Independently attest that the real P18 activation hashes correspond to exactly one durable P16 ledger row.
2. Preserve P16 ledger privacy: no caller receives nonce, consumption ID, raw grant, signature, key material, or table access.
3. Provide a read-only production health sample that proves the real local P17 state and P17/P11 runtime route remain healthy.
4. Ensure production probes never receive `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`.
5. Persist only sanitized JSONL soak samples outside the repository.
6. Evaluate a deterministic 24-hour operational soak gate.
7. Keep repository-default graph activation false throughout P19.

## Non-goals

- P19 does not promote the repository default graph.
- P19 does not consume a new activation grant or nonce.
- P19 does not mutate P17 activation state.
- P19 does not claim real-user quality, relevance, or business KPI improvement. Its soak is an operational availability/parity gate using the governed production probe.
- P19 does not add a public/anon ledger-inspection surface.

## Approaches considered

### A. Direct `service_role` SELECT on the P16 ledger

Rejected. P16 intentionally revoked direct SELECT from every runtime role. Restoring table access would widen the blast radius and expose nonce/consumption identifiers to general service-role SQL clients.

### B. Publishable/anon attestation RPC

Rejected. Even a narrow public count endpoint would expose internal production control-plane state to an unprivileged runtime credential and blur the P10 publishable read boundary with activation governance.

### C. Service-role-only, read-only attestation RPC plus publishable-only soak probes

Selected. Migration 011 adds one SECURITY DEFINER RPC that accepts only the three public activation hashes and returns only aggregate counts/boolean. One-time attestation uses the elevated key. Ongoing soak sampling uses the P17/P11 probe with only the publishable runtime transport.

## Migration 011: activation consumption attestation

Create `reference-graph/schema/011_reference_graph_activation_attestation.sql` with:

`public.reference_graph_attest_activation_consumption_p19(text,text,text) -> jsonb`

Inputs:

- `p_grant_payload_hash`
- `p_request_hash`
- `p_authority_hash`

All three inputs must be lowercase 64-character hex strings. Invalid input raises SQLSTATE `22023`.

The function is `SECURITY DEFINER`, uses `search_path = pg_catalog, reference_graph`, sets `statement_timeout = '5s'`, is marked `STABLE`, and performs only SELECTs against `reference_graph.activation_grant_consumptions_p16`.

Exact response keys:

- `matching_count`: count of rows matching all three hashes
- `total_count`: total rows in the P16 ledger
- `exact_match`: true iff `matching_count = 1`

The RPC never returns nonce, consumption ID, or consumed timestamp. Revoke EXECUTE from `public`, `anon`, `authenticated`, and `service_role`, then grant EXECUTE only to `service_role`. Do not change table privileges.

## Supabase store contract

Extend `ReferenceGraphSupabaseStore` with:

`attestActivationConsumptionP19({ grant_payload_hash, request_hash, authority_hash })`

It validates the three lowercase SHA-256 values, calls only `reference_graph_attest_activation_consumption_p19` through the existing redacting RPC transport, and accepts only an exact response object containing `matching_count`, `total_count`, and `exact_match` with non-negative integer counts and a boolean.

## One-time production attestation

P19 loads the immutable P18 production receipt evidence from the repository and verifies its exact SHA-256 before using its public hashes. The one-time attestation requires `SUPABASE_URL` to equal the dedicated production URL and requires an elevated Supabase key only in process environment.

A valid initial attestation for this cutover is:

- `matching_count = 1`
- `total_count = 1`
- `exact_match = true`

The sanitized attestation receipt may contain the three public hashes, target project ref, counts, boolean, and observation time. It must not contain elevated credentials, nonce, consumption ID, raw grant, signature, local authority paths, or key bytes.

## Production health sample

Create `reference-graph/p19-production-soak.mjs` with a pure health-sampling interface that:

1. Verifies the exact production Supabase URL.
2. Requires a publishable runtime key.
3. Reads P17 activation state.
4. Calls the existing `probeP17Runtime()` with a copy of the environment from which both elevated Supabase credential names have been removed.
5. Measures total probe duration using an injectable monotonic clock.
6. Returns a sanitized sample.

Healthy sample requirements:

- `production_source = reference-graph`
- `quick_graph_enabled = true`
- `repository_default_graph_enabled = false`
- Quick authoritative source is `reference-graph`
- Quick `record_exact = true`
- Quick `pattern_exact = true`
- Standard authoritative source is `legacy-control`
- Deep authoritative source is `legacy-control`

Operational mismatches return `healthy=false` with deterministic blocker codes. Unexpected probe exceptions are recorded only as `probe-error`; raw exception text is not persisted in the sample.

## Soak sample persistence

Create `reference-graph/cli/p19-production-soak.mjs` with exact modes:

- `--attest-consumption <out.json>`
- `--sample <samples.jsonl>`
- `--evaluate <attestation.json> <samples.jsonl> <out.json>`

`--attest-consumption` requires an elevated key in environment, calls only the P19 attestation RPC, writes a mode-0600 sanitized JSON receipt, and clears nothing itself because it cannot safely mutate the caller's parent environment.

`--sample` requires only the production URL and publishable key, runs the read-only health sample, appends one sanitized JSON line to the specified external file, prints the same sample, and returns nonzero for an unhealthy sample. It must not instantiate a Supabase service-role store.

`--evaluate` is fully offline/read-only. It reads the sanitized attestation and sample JSONL and writes a sanitized promotion-readiness receipt.

## Soak eligibility contract

Promotion readiness is `eligible=true` only when all are true:

- attestation `exact_match = true`
- attestation `matching_count = 1`
- attestation `total_count = 1`
- at least 24 samples exist
- every sample is healthy
- first-to-last sample span is at least 24 hours
- no adjacent sample gap exceeds 90 minutes
- every sample still has repository default graph disabled

Samples are sorted by canonical UTC `sampled_at` before evaluation. Duplicate timestamps fail eligibility. Any malformed line fails closed.

The eligibility receipt includes only aggregate observations and blocker codes. It does not contain raw probe records, secrets, nonce, consumption ID, grant, signature, or local paths.

## Operator scheduling

The documented production operating mode is one `--sample` run per hour. Windows Task Scheduler or another host scheduler may invoke the command, but P19 does not install a scheduler automatically in repository code or CI.

The sample file lives outside the repository, recommended under the existing local AgentHub state directory, for example `%LOCALAPPDATA%\agent-hub\reference-graph\p19-soak.jsonl`.

## CI and governance

Add `Reference graph P19 governance` on pull requests and `main` pushes. It must:

- run `node --test tests/reference-graph/p19-*.test.mjs`
- scan the Reference Graph tree for common secrets
- verify public release safety
- execute migrations through 011 in disposable PostgreSQL
- prove the attestation RPC returns one exact match for a synthetic P16 row
- prove `anon`/`authenticated` cannot execute the P19 RPC
- prove `service_role` can execute the P19 RPC
- prove no unprivileged/direct ledger SELECT or INSERT privilege was introduced
- prove the P19 RPC body contains no DML

CI must never call the production project, never use production credentials, never consume a live nonce, and never mutate the live P17 state.

## Live deployment boundary

Migration 011 may be deployed to the dedicated production project only after the exact P19 implementation SHA passes governance. After deployment, the operator runs the one-time attestation with a current secret key, then removes elevated credentials from the shell. Hourly soak samples require only the publishable key.

Because the connected Supabase MCP identity lacks migration/SQL permission, live migration deployment may require an explicitly authorized local operator path. That limitation must be reported, not worked around by weakening privileges.

## Safety invariants

- No repository-default promotion in P19.
- No new activation grant generation/signing/consumption in P19.
- No P17 state mutation or rollback in P19.
- P16 table direct privileges remain unchanged.
- No public/anon attestation surface.
- No elevated key reaches the production runtime probe.
- No production credentials, nonce, signature, raw grant, consumption ID, or authority private/public key bytes enter samples or evidence.
- Any malformed state, probe mismatch, attestation mismatch, missing sample, long gap, or malformed JSONL fails promotion eligibility closed.
