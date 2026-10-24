# Reference Graph P13 — Activation Grant Authority Design

## Intent

P12 proved technical readiness for one exact quick-only Reference Graph runtime contract and stopped before authority. Its final evidence head is `5f676c806ae864b507723ea867f5e3afd6fd4adb`, and its deterministic activation binding hash is `68930447847df8d31de01b7fb60049136ae6fd0d74c837283fb837ff7e79961b`.

P13 builds the missing **grant-verification authority boundary** without issuing a production grant and without activating anything. It creates a canonical grant request that is bound to the exact P12 evidence head, P12 binding hash, P12 evidence bytes, target, profile, activation flag/value, rollback contract, and legacy-before state. It also creates a verify-only Ed25519 grant verifier that accepts an authority only when an external trusted authority descriptor hash is supplied and matches exactly.

P13 deliberately does not enroll a production authority key. Therefore the durable P13 evidence remains fail-closed: no trusted production authority is configured, no grant exists, activation is not authorized, activation is not performed, repository defaults remain graph-off, and `production_source` remains `legacy-control`.

## Goals

- Stack directly on final P12 evidence head `5f676c806ae864b507723ea867f5e3afd6fd4adb`.
- Pin the exact P12 activation binding hash `68930447847df8d31de01b7fb60049136ae6fd0d74c837283fb837ff7e79961b`.
- Pin the exact committed P12 evidence bytes by SHA-256 in every grant request.
- Require the P12 receipt to remain structurally preflight-ready while still recording `grant_state: not-issued`, `activation_authorized: false`, `activation_performed: false`, `repository_default_graph_enabled: false`, and `production_source: legacy-control`.
- Produce a deterministic canonical grant request and SHA-256 request hash.
- Define a deterministic authority descriptor hash for Ed25519 public-key authorities.
- Verify detached Ed25519 signatures over the canonical grant payload.
- Require an explicit out-of-band `trusted_authority_sha256`; missing or mismatched trust must fail closed before signature authority can be accepted.
- Bind every verified grant to the exact P12 request hash and frozen quick-only runtime scope.
- Enforce a short validity window, nonce, exact issuer/key identity, and exact authority descriptor.
- Provide a read-only operator for planning, request emission, repository verification, grant verification, and infrastructure receipt finalization.
- Produce durable secret-free P13 evidence that proves the verifier infrastructure exists while production authority remains unconfigured and no grant was issued.

## Non-goals

- No production activation grant.
- No production authority enrollment.
- No private key generation, storage, import, or signing command.
- No environment-variable mutation.
- No deployment-platform mutation.
- No routing switch.
- No normal-user graph traffic caused by P13.
- No Supabase mutation, projection refresh, DDL, migration, or write RPC.
- No service-role runtime path.
- No change to P11 routing semantics, P12 binding semantics, P7 ranking, P10 projection semantics, or public query output.
- No graph support for `standard` or `deep`.

## Anti-goals

P13 must not turn a verifier into an issuer. Production source files must contain no private-key handling, no signing function, no `--sign`, `--issue`, `--grant`, `--activate`, `--apply`, `--deploy`, or `--set-env` execution mode, and no assignment to `REFERENCE_GRAPH_QUICK_RUNTIME`.

P13 must not treat a caller-supplied public key as trusted merely because its signature verifies. A cryptographically valid signature from an unpinned authority is still unauthorized.

P13 must not treat P12 readiness as grant authority. The committed P13 evidence must keep:

- `authority_state: unconfigured`
- `trusted_authority_sha256: null`
- `grant_state: not-issued`
- `grant_verified: false`
- `activation_authorized: false`
- `activation_performed: false`
- `repository_default_graph_enabled: false`
- `production_source: legacy-control`

## Existing Boundary

P12 durable evidence at `reference-graph/evidence/p12-activation-authority-evidence.json` records:

- schema `reference-graph.p12-activation-authority.v1`
- binding hash `68930447847df8d31de01b7fb60049136ae6fd0d74c837283fb837ff7e79961b`
- `preflight_ready: true`
- all structural checks true
- `blockers: []`
- `grant_state: not-issued`
- `activation_authorized: false`
- `activation_performed: false`
- repository default graph-off
- `production_source: legacy-control`

The bound runtime contract remains quick-only, exact opt-in `REFERENCE_GRAPH_QUICK_RUNTIME=graph`, publishable-only runtime auth, `1500 ms` timeout, legacy-first selection, exact ordered record and pattern parity, fail-closed fallback to `legacy-control`, and standard/deep legacy-only isolation.

P13 consumes that boundary. It does not rewrite it.

## Approaches Considered

### 1. Commit a production Ed25519 public key now

This would let P13 pin one concrete signer immediately. Rejected: there is no durable secret-management path in this phase for the matching private key, and inventing a production key pair would create an authority that cannot be safely operated or recovered.

### 2. Accept any caller-supplied Ed25519 public key when its signature verifies

This proves cryptographic integrity but not authority. Rejected: an attacker could generate a key pair, sign a matching payload, and become their own authority.

### 3. Verify-only grant infrastructure with an explicit external trust-anchor hash — chosen

P13 defines the canonical request, authority descriptor, grant payload, hashes, signature verification, time/nonce/scope checks, and read-only operator. A grant verifier must also receive the exact SHA-256 of the authority descriptor from an independent trusted channel. Missing or mismatched trust fails closed.

The P13 repository intentionally enrolls no production authority. A later phase can separately establish the production authority descriptor and its trusted hash, then issue a grant over the exact P13 request. That later phase remains distinct from activation itself.

## Canonical P13 Grant Request

Create `reference-graph.p13-activation-grant-request.v1` with these exact fields:

```text
schema_version: reference-graph.p13-activation-grant-request.v1
p12_evidence_head: 5f676c806ae864b507723ea867f5e3afd6fd4adb
p12_binding_hash: 68930447847df8d31de01b7fb60049136ae6fd0d74c837283fb837ff7e79961b
p12_evidence_sha256: <SHA-256 of committed P12 evidence bytes>
target: <exact P12 target>
profile: quick
activation_flag: REFERENCE_GRAPH_QUICK_RUNTIME
activation_value: graph
runtime_auth_mode: publishable
timeout_ms: 1500
legacy_first: true
record_parity_required: exact-ordered
pattern_parity_required: exact-ordered
fallback_source: legacy-control
standard_mode: legacy-only
deep_mode: legacy-only
repository_default_graph_enabled_before: false
production_source_before: legacy-control
rollback_action: unset-or-change-REFERENCE_GRAPH_QUICK_RUNTIME
```

The request builder must reject a P12 receipt whose binding hash, target, scope, security contract, readiness state, grant state, activation state, default state, blockers, or production source differ from the frozen P12 contract.

Canonicalization sorts object keys recursively and preserves array order. `request_hash` is lowercase SHA-256 over canonical UTF-8 JSON.

## Authority Descriptor

A P13 authority descriptor uses schema `reference-graph.p13-ed25519-authority.v1`:

```text
schema_version
authority_id
key_id
algorithm: Ed25519
public_key_spki_base64
```

The descriptor hash is lowercase SHA-256 over canonical JSON. The verifier never decides trust from the descriptor itself. It requires a separate `trusted_authority_sha256` and rejects verification unless that value is a valid SHA-256 digest equal to the descriptor hash.

Production code contains public-key verification only. It must not contain private-key parsing or signing helpers.

## Signed Grant Envelope

A grant uses schema `reference-graph.p13-activation-grant.v1`:

```text
schema_version
request_hash
p12_evidence_head
p12_binding_hash
target
profile
activation_flag
activation_value
issuer
key_id
issued_at
not_before
expires_at
nonce
signature_algorithm: Ed25519
signature_base64
```

The detached signature covers the canonical grant payload with `signature_base64` excluded.

A grant verifies only when all of these are true:

- the request itself is valid against the frozen P12 contract;
- the trusted authority hash is present and matches the supplied authority descriptor;
- authority algorithm is Ed25519 and issuer/key IDs match the grant;
- request hash, P12 evidence head, P12 binding hash, target, profile, activation flag, and activation value match exactly;
- nonce is 32 random bytes represented as 64 lowercase hex characters;
- timestamps are valid ISO timestamps;
- `issued_at <= not_before <= now <= expires_at`;
- total grant lifetime is at most 15 minutes;
- `not_before` is not before `issued_at`;
- the Ed25519 signature over the canonical payload verifies.

Any malformed input, missing trust anchor, mismatch, expired/not-yet-valid interval, overlong lifetime, or invalid signature returns a failed verification with blockers.

## P13 Infrastructure Receipt

Create `reference-graph.p13-activation-grant-authority.v1` with phases:

1. `p12_binding`
2. `authority_policy`
3. `grant_verifier`
4. `activation_boundary`

The committed receipt records:

- final P12 evidence head
- exact P12 binding hash
- SHA-256 of P12 evidence bytes
- canonical grant request and request hash
- P13 tested implementation SHA
- verification/reference timestamps
- structured repository checks
- `infrastructure_ready`
- `authority_state: unconfigured`
- `trusted_authority_sha256: null`
- `grant_state: not-issued`
- `grant_verified: false`
- `activation_authorized: false`
- `activation_performed: false`
- `repository_default_graph_enabled: false`
- `production_source: legacy-control`

`infrastructure_ready: true` means the request/verifier/boundary infrastructure is structurally present. It does not mean a production authority exists or a grant exists.

## Read-only Operator Contract

Create `reference-graph/cli/p13-activation-grant-authority.mjs` with read-only modes only:

- `--plan`
- `--emit-request`
- `--verify-repository`
- `--verify-grant <grant.json> <authority.json> <trusted-authority-sha256> <now-iso>`
- `--finalize-repository <snapshot.json>`

The operator may read repository files and caller-provided JSON. It may verify signatures. It must never generate keys, sign payloads, set environment variables, write repository files, call Supabase, refresh projections, call write RPCs, or change deployment configuration.

`--verify-grant` is verification only. A valid result is evidence that a supplied grant is authentic relative to the separately supplied trust anchor. It does not perform activation.

## Repository and Governance Checks

Permanent P13 governance must prove:

- final P12 evidence head and binding hash constants are exact;
- committed P12 evidence remains structurally preflight-ready and non-authorizing;
- the P12 evidence SHA-256 used by the request matches the committed bytes;
- grant-request hashing is deterministic and sensitive to semantic drift;
- authority-descriptor hashing is deterministic;
- missing trusted authority hash fails closed;
- mismatched authority hash fails closed;
- wrong P12 head/hash/request/scope fails closed;
- expired, future, overlong, malformed, or bad-signature grants fail closed;
- a valid ephemeral test Ed25519 grant can be verified when its exact authority hash is supplied;
- production source files contain no signing/private-key path;
- operator contains no activation/deployment/env mutation mode;
- repository default remains graph-off;
- schema migrations remain capped at `009`;
- P13 durable evidence is secret-free;
- standard/deep remain legacy-only;
- no service-role runtime or Supabase mutation path is introduced.

The existing permanent Reference Graph workflow already runs `node --test tests/reference-graph/*.test.mjs` and the Reference Graph secret scan. P13 extends that test surface rather than adding a second workflow.

## P13 Stop Boundary

P13 stops when the exact grant request is reproducible from the final P12 evidence, the verify-only Ed25519 authority/grant path is fail-closed and tested, permanent governance is green, and durable evidence proves the infrastructure while leaving production authority unconfigured.

Even on success:

- no production authority key is enrolled;
- no production grant is issued;
- no grant is applied;
- `activation_authorized` remains false;
- `activation_performed` remains false;
- repository default remains legacy;
- production source remains `legacy-control`;
- no Supabase mutation occurs.

A later explicit authority-enrollment/grant phase must provide a trusted production authority descriptor hash and a signed grant bound to the exact P13 request. A separate activation phase must still perform any routing change.