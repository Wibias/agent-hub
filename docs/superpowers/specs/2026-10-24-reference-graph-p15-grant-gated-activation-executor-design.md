# Reference Graph P15: Grant-Gated Activation Executor Design

## Goal

Add the first production activation executor for the Reference Graph without weakening the P14 authority boundary. P15 may switch only the `quick` runtime to `REFERENCE_GRAPH_QUICK_RUNTIME=graph`, only after a fresh P14 Ed25519 grant is re-verified at activation time and its nonce is atomically consumed exactly once.

## Frozen input

- P14 final evidence head: `43fd2adf9e73749b03283f7ae7c6e700bd383b35`
- P14 evidence bytes SHA-256: `610f9f832d994e565fe6912e3aa1e25d5fe5b549fa08f1a48f477ee9b3956393`
- P14 evidence path: `reference-graph/evidence/p14-authority-enrollment-grant-evidence.json`
- Activation flag: `REFERENCE_GRAPH_QUICK_RUNTIME`
- Activation value: `graph`
- Runtime router: existing `reference-graph/p11-runtime-router.mjs`
- P14 max grant lifetime remains 15 minutes.

The committed P14 evidence is ceremony-ready but has no enrolled production authority and no issued grant. P15 must therefore remain blocked in durable repository evidence until real external ceremony artifacts are supplied.

## Trust boundary

P15 does not add a signer, private-key loader, authority enrollment shortcut, or alternative signature verifier. It calls `verifyP14SignedGrant()` directly with the real P13 evidence, P14 enrollment manifest, signed grant, and current time.

Production private keys remain external. P15 never accepts a caller-supplied `grantVerified`, `activationAuthorized`, or equivalent boolean as authority.

## One-shot activation transaction

An activation attempt is deliberately single-use:

1. Verify the signed grant through P14 at `now`.
2. Confirm production is still legacy-controlled before mutation.
3. Atomically consume the grant nonce in an external durable replay ledger. Consumption is irreversible for that grant.
4. Obtain a fresh current time and re-verify the same signed grant after nonce consumption. If it expired meanwhile, stop without mutating production; a new grant is required.
5. Apply only `REFERENCE_GRAPH_QUICK_RUNTIME=graph` through an injected deployment actuator.
6. Probe the live runtime. `quick` must report Reference Graph authority with exact record and pattern parity; `standard` and `deep` must remain legacy-controlled.
7. On any failure after mutation, roll back the activation flag and verify rollback restored legacy control.
8. On success, emit a receipt proving authorization, one-shot consumption, activation, and post-cutover isolation.

The executor does not retry a consumed grant. A failed attempt requires a new externally signed grant.

## External interfaces

P15 core receives explicit injected functions rather than embedding a hosting provider:

- `readActivationState()` -> current deployment activation state.
- `consumeGrantNonce(input)` -> atomic one-shot replay-ledger consume; must return a durable consumption id.
- `applyActivation(input)` -> set only the quick activation flag; must return an external change id.
- `probeRuntime()` -> report live quick/standard/deep routing state.
- `rollbackActivation(input)` -> unset/change the flag back to legacy and return a rollback change id.
- `now()` -> valid `Date`, called separately before authorization and immediately before mutation.

This keeps the repository executor provider-neutral while making every production side effect explicit and testable.

## Required pre-state

Activation is allowed only when live state reports:

- production source `legacy-control`;
- quick graph activation not already enabled;
- repository default remains graph-off.

Already-active, unknown, or malformed states fail closed before nonce consumption.

## Probe contract

A successful post-cutover probe must prove all of:

- `quick.authoritative_source === 'reference-graph'`
- `quick.record_exact === true`
- `quick.pattern_exact === true`
- `standard.authoritative_source === 'legacy-control'`
- `deep.authoritative_source === 'legacy-control'`

Any mismatch or probe error triggers rollback.

## Replay contract

The durable ledger key is the signed grant nonce, bound to the canonical grant payload hash, request hash, and authority hash. `consumeGrantNonce()` must fail if that nonce was previously consumed. P15 treats any non-success or malformed result as a hard stop before mutation.

Because consumption occurs before mutation and is irreversible, crash/retry behavior is fail-closed: an ambiguous attempt cannot reuse the grant.

## Receipt states

P15 distinguishes:

- `blocked`: no real external enrolled authority/grant is available; production remains legacy.
- `authorized`: grant verified but no mutation performed yet.
- `activated`: nonce consumed, flag applied, probe passed, production quick source is Reference Graph.
- `rolled-back`: nonce consumed, mutation attempted, a post-mutation condition failed, rollback verified legacy restored.

No receipt may claim activation solely from caller-provided booleans.

## Durable repository evidence

Until a real production ceremony and deployment actuator are supplied, committed P15 evidence records infrastructure readiness but:

- `grant_state: not-issued`
- `grant_verified: false`
- `grant_consumed: false`
- `activation_authorized: false`
- `activation_performed: false`
- `repository_default_graph_enabled: false`
- `production_source: legacy-control`
- blocker: `production-ed25519-authority-and-grant-not-provided`

No production secret, private key, fabricated grant, or simulated activation may be committed.

## Rollback

Rollback is exactly the P12 contract: unset/change `REFERENCE_GRAPH_QUICK_RUNTIME` so the P11 router returns to legacy control. Rollback must itself be checked; an unverified rollback is a failed/unsafe result and must never be reported as restored.

## Non-goals

- No production private-key generation/import/storage.
- No repository signer.
- No alternative router.
- No standard/deep graph activation.
- No provider-specific deployment integration until an actual deployment control plane is identified.
- No Supabase migration solely for P15; a real replay ledger integration may be added later only when its production ownership is explicit.
