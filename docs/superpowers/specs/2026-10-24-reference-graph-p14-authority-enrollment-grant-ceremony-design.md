# Reference Graph P14 — Authority Enrollment and Grant Ceremony Design

## Intent

P13 built a fail-closed Ed25519 grant verifier on the final P12 activation contract. Its final evidence head is `bbd29fbe596801fdb7594f45045cb41e9c9b1a5b`, and its canonical activation request hash is `ed31630f9bda1362f42e747a6366d8504d17638b8ba458228db6fec5a2074ce7`.

P14 builds the next authority boundary: **production public-authority enrollment and externally signed grant acceptance**. It must never generate, import, store, or sign with a production private key. The repository may hold a production public authority descriptor and a signed grant only after an explicit external ceremony proves that the descriptor hash was approved out of band and that the grant signature verifies against that enrolled authority.

P14 may make `activation_authorized: true` only for an exact, currently valid, verified grant bound to the P13 request. It must never make `activation_performed: true`. Repository runtime defaults remain graph-off and `production_source` remains `legacy-control` throughout P14.

Because the repository currently has no KMS, HSM, SOPS, key-vault, or other private-key custody path, P14 deliberately ends at a ceremony boundary. It provides everything needed to enroll a public key and verify an externally produced signature, but it does not invent a production signer.

## Goals

- Stack directly on final P13 evidence head `bbd29fbe596801fdb7594f45045cb41e9c9b1a5b`.
- Pin the canonical P13 request hash `ed31630f9bda1362f42e747a6366d8504d17638b8ba458228db6fec5a2074ce7`.
- Pin SHA-256 of the exact committed P13 evidence bytes once computed during implementation.
- Require the committed P13 evidence to remain infrastructure-ready, authority-unconfigured, grant-not-issued, non-authorizing, non-activated, graph-off, and `legacy-control`.
- Accept only the exact P13 Ed25519 authority descriptor schema and actual Ed25519 SPKI keys.
- Require a separately supplied approved authority SHA-256 to match the canonical authority descriptor hash before enrollment can be considered valid.
- Produce a canonical enrollment manifest bound to the exact P13 evidence head, P13 evidence bytes, P13 request hash, target, profile, activation flag/value, and authority descriptor.
- Produce a canonical unsigned grant payload for an external signer without handling private-key material.
- Accept a returned detached Ed25519 signature only by constructing the exact P13 grant envelope and delegating final verification to the P13 verifier.
- Allow `activation_authorized: true` only when the authority is enrolled and the exact grant verifies at the supplied reference time.
- Keep `activation_performed: false`, repository graph default off, and `production_source: legacy-control` even after successful authorization.
- Provide a read-only operator and durable receipt/evidence model for both `awaiting-external-ceremony` and `authorized-not-activated` states.
- Preserve permanent governance that rejects any signing/private-key path, activation mutation, Supabase mutation, deployment mutation, or migration `010+`.

## Non-goals

- No production private-key generation.
- No production private-key import, parsing, storage, environment variable, secret file, GitHub secret, artifact, or log output.
- No signing command or signing API in production P14 source.
- No activation execution.
- No routing switch.
- No environment-variable mutation.
- No deployment-platform mutation.
- No Supabase mutation, projection refresh, DDL, migration, or write RPC.
- No service-role runtime path.
- No change to P11 routing semantics, P12 activation binding, P13 request semantics, P7 ranking, or P10 projection semantics.
- No graph support for `standard` or `deep`.

## Anti-goals

P14 must not confuse repository review with cryptographic enrollment. A public key committed in Git is not trusted merely because it is present. Enrollment requires an independently supplied `approved_authority_sha256` equal to the canonical authority descriptor hash.

P14 must not generate a production key pair in CI, the agent runtime, or a repository script. A generated private key that cannot be placed in an existing secure custody system is not a production authority.

P14 must not turn `grant_verified` into activation execution. Even a valid grant ends P14 with `activation_performed: false` and `production_source: legacy-control`.

## Existing Boundary

P13 durable evidence at `reference-graph/evidence/p13-activation-grant-authority-evidence.json` records:

- schema `reference-graph.p13-activation-grant-authority.v1`
- final P12 evidence head and binding
- canonical P13 request hash `ed31630f9bda1362f42e747a6366d8504d17638b8ba458228db6fec5a2074ce7`
- `infrastructure_ready: true`
- `authority_state: unconfigured`
- `trusted_authority_sha256: null`
- `grant_state: not-issued`
- `grant_verified: false`
- `activation_authorized: false`
- `activation_performed: false`
- repository default graph-off
- `production_source: legacy-control`

P14 consumes and pins this boundary. It does not rewrite P13.

## Approaches Considered

### 1. Generate a production Ed25519 key pair inside P14

Rejected. The repository has no approved private-key custody mechanism. Generating a real production key in CI, ChatGPT runtime, a GitHub artifact, or the repository would create an operational secret without a trustworthy lifecycle.

### 2. Trust any public key committed in the P14 branch

Rejected. Repository presence is not an independent root of trust. An attacker who can alter the branch could replace both the key and any self-declared hash.

### 3. External private-key custody + explicit public-key enrollment + detached grant signature — chosen

P14 accepts a public authority descriptor only when its canonical SHA-256 equals an independently supplied approval hash. It emits the exact canonical grant payload to be signed externally. The private key never enters P14. The returned signature is assembled into the exact P13 grant envelope and verified through the hardened P13 verifier.

This makes the ceremony auditable while keeping the private-key custody problem outside a repository that currently has no secure solution for it.

## P14 Enrollment Manifest

Create schema `reference-graph.p14-authority-enrollment.v1` with exact fields:

```text
schema_version
p13_evidence_head
p13_evidence_sha256
p13_request_hash
target
profile
activation_flag
activation_value
authority
authority_sha256
approved_authority_sha256
environment: production
private_key_custody: external
private_key_present: false
```

The manifest is valid only when:

- P13 evidence bytes match the frozen P13 evidence SHA-256;
- P13 evidence records the exact final P13 head/request and fail-closed pre-ceremony state;
- authority descriptor uses exact P13 schema;
- parsed SPKI key type is actually Ed25519;
- `authority_sha256` is the canonical authority descriptor hash;
- `approved_authority_sha256` is a valid lowercase SHA-256 and equals `authority_sha256`;
- environment is exactly `production`;
- private-key custody is exactly `external`;
- `private_key_present` is exactly false;
- no additional fields exist.

The approved authority hash is an explicit ceremony input. P14 does not derive approval from the authority descriptor itself.

## Canonical Unsigned Grant Payload

P14 produces the P13 grant payload without `signature_base64`:

```text
schema_version: reference-graph.p13-activation-grant.v1
request_hash: ed31630f9bda1362f42e747a6366d8504d17638b8ba458228db6fec5a2074ce7
p12_evidence_head: <from frozen P13 request>
p12_binding_hash: <from frozen P13 request>
target: <from frozen P13 request>
profile: quick
activation_flag: REFERENCE_GRAPH_QUICK_RUNTIME
activation_value: graph
issuer: <enrolled authority_id>
key_id: <enrolled key_id>
issued_at
not_before
expires_at
nonce
signature_algorithm: Ed25519
```

Canonicalization is identical to P13 recursive-key canonical JSON.

P14 validates before emitting:

- exact enrollment manifest;
- canonical UTC ISO timestamps;
- `issued_at <= not_before <= expires_at`;
- lifetime greater than zero and at most 15 minutes;
- 32-byte nonce as 64 lowercase hex characters.

The operator emits both the payload and its canonical SHA-256. The payload hash is for ceremony/audit convenience only; the Ed25519 signature still covers the canonical payload bytes exactly, matching P13 verification semantics.

## Signature Acceptance

P14 accepts a detached base64 signature and constructs the exact P13 grant envelope by adding `signature_base64` to the unsigned payload.

The resulting grant is accepted only when the hardened P13 verifier returns all checks true using:

- the frozen P13 request;
- the enrolled authority descriptor;
- `approved_authority_sha256` as the trusted authority hash;
- an explicit canonical UTC verification time.

A successful P14 ceremony result is:

```text
authority_state: enrolled
grant_state: issued
grant_verified: true
activation_authorized: true
activation_performed: false
repository_default_graph_enabled: false
production_source: legacy-control
```

A missing authority, missing independent approval hash, missing signature, invalid signature, expired/future/overlong grant, wrong request, wrong key, malformed schema, or any drift keeps authorization false.

## Ceremony-ready State

P14 infrastructure can be fully implemented before an external production signer exists. Its durable infrastructure evidence may therefore record:

```text
ceremony_ready: true
authority_state: awaiting-external-enrollment
grant_state: not-issued
grant_verified: false
activation_authorized: false
activation_performed: false
repository_default_graph_enabled: false
production_source: legacy-control
external_blocker: production-ed25519-authority-not-provided
```

This is a successful P14 infrastructure state but not a completed authority ceremony.

P14 must never fake completion with an ephemeral test key. Ephemeral keys are permitted only inside tests.

## P14 Receipt

Create schema `reference-graph.p14-authority-enrollment-grant.v1` with phases:

1. `p13_binding`
2. `authority_enrollment`
3. `grant_payload`
4. `grant_verification`
5. `activation_boundary`

The receipt records:

- final P13 evidence head
- frozen P13 evidence SHA-256
- exact P13 request hash
- tested P14 implementation SHA
- verification/reference timestamps
- repository checks
- optional enrollment manifest
- optional grant envelope
- `ceremony_ready`
- `authority_state`
- `grant_state`
- `grant_verified`
- `activation_authorized`
- `activation_performed: false`
- `repository_default_graph_enabled: false`
- `production_source: legacy-control`
- blockers/external blocker

`ceremony_ready: true` means P14 infrastructure is ready to accept the external authority ceremony. It does not imply an authority has been enrolled or a grant has been issued.

## Read-only Operator Contract

Create `reference-graph/cli/p14-authority-enrollment-grant.mjs` with read-only/output-only modes:

- `--plan`
- `--verify-repository`
- `--enrollment-manifest <authority.json> <approved-authority-sha256>`
- `--emit-grant-payload <authority.json> <approved-authority-sha256> <issued-at> <not-before> <expires-at> <nonce>`
- `--verify-signed-grant <authority.json> <approved-authority-sha256> <grant.json> <now-iso>`
- `--finalize-repository <snapshot.json>`
- `--finalize-ceremony <snapshot.json> <authority.json> <approved-authority-sha256> <grant.json> <now-iso>`

The operator may read JSON files and emit JSON to stdout. It must not write repository files, generate keys, parse private keys, sign payloads, set environment variables, call Supabase, refresh projections, call write RPCs, deploy, or activate routing.

`--finalize-repository` produces ceremony-ready evidence with the external blocker when no production authority exists.

`--finalize-ceremony` may produce `activation_authorized: true` only when the exact authority enrollment and signed grant verify. It still records `activation_performed: false`.

## Repository and Governance Checks

Permanent P14 governance must prove:

- final P13 evidence head and request hash constants are exact;
- exact P13 evidence bytes are pinned;
- committed P13 evidence remains infrastructure-ready and non-authorizing;
- authority enrollment requires an independently supplied matching approval hash;
- actual authority SPKI type is Ed25519;
- authority and grant schemas reject unknown fields;
- unsigned grant payload canonicalization is deterministic;
- malformed, future, expired, overlong, wrong-scope, wrong-request, wrong-authority, and bad-signature grants fail closed;
- ephemeral test keys can prove the full ceremony path without becoming production artifacts;
- production P14 source contains no key generation, private-key parsing, or signing API;
- operator has no activation/deployment/env/Supabase mutation mode;
- repository default remains graph-off;
- schema migrations remain capped at `009`;
- standard/deep remain legacy-only;
- P14 durable infrastructure evidence is secret-free;
- no production private key or private-key-shaped field can be committed in P14 evidence.

## P14 Stop Boundary

P14 implementation stops when the ceremony infrastructure is reproducible, fail-closed, permanently governed, and represented by durable evidence.

If no real external production authority is supplied, P14 ends in the explicit ceremony-ready state with `authority_state: awaiting-external-enrollment`, `grant_state: not-issued`, and `activation_authorized: false`.

If a real externally held authority and signed grant are later supplied, the same P14 branch/tooling can verify and record `authority_state: enrolled`, `grant_state: issued`, `grant_verified: true`, and `activation_authorized: true`.

In both cases:

- `activation_performed` remains false;
- repository default remains legacy;
- production source remains `legacy-control`;
- no Supabase mutation occurs.

A later explicit activation phase is still required before any routing change can occur.