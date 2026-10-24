# Reference Graph P16: Durable Grant Consumption Design

## Goal

Make P15's one-shot grant-consumption boundary real by adding a durable atomic replay ledger to the dedicated `agent-hub-reference-graph` Supabase project, without changing production routing or inventing a deployment provider.

P16 does not activate the Reference Graph. It supplies the production-owned `consumeGrantNonce()` implementation that P15 already requires.

## Frozen input

- P15 final evidence head: `04b6056721697060d10dac640899a11d68c7bc05`
- P15 evidence bytes SHA-256: `f95e2b2112962881d499191d21a762b2f2dca0e3abe28c65e2e8abc2f67bdbe7`
- P15 evidence path: `reference-graph/evidence/p15-activation-executor-evidence.json`
- P15 implementation SHA: `eba504f9b5472e34a9ae806ec22a5fcc6380697b`
- Dedicated Supabase project ref: `vrznfnxzlxaavpqbzbzd`
- Dedicated Supabase project name: `agent-hub-reference-graph`
- Region: `eu-central-1`
- Existing schema migrations end at `009_reference_graph_runtime_projection.sql`.

The live project has the `reference_graph` schema and the P10 runtime projection. No application deployment provider is encoded in the repository, so P16 must not create one by assumption.

## Architecture

P16 adds one private ledger table and one service-role-only RPC.

The ledger lives in the non-exposed `reference_graph` schema. The RPC lives in `public` only because Supabase's RPC transport is an existing operator-side integration surface. Its execution privilege is revoked from `PUBLIC`, `anon`, and `authenticated` and granted only to `service_role`.

The existing `ReferenceGraphSupabaseStore` remains the sole privileged HTTP/RPC client. P16 adds a narrow method that maps P15's `consumeGrantNonce(input)` contract onto the new RPC.

## Migration 010

Create `reference_graph.activation_grant_consumptions_p16` with exactly these durable fields:

- `nonce text primary key`
- `consumption_id uuid not null unique default gen_random_uuid()`
- `grant_payload_hash text not null`
- `request_hash text not null`
- `authority_hash text not null`
- `consumed_at timestamptz not null default clock_timestamp()`

The nonce and all hashes must be exactly 64 lowercase hexadecimal characters. The table stores no raw grant, signature, authority public key, private key, credential, or caller-provided authorization boolean.

The table is internal state, not a runtime read surface. Revoke table access from `PUBLIC`, `anon`, and `authenticated`. No public RLS policy is needed because the table is not in an exposed schema and no unprivileged role receives table privileges.

## Atomic consume RPC

Add:

`public.reference_graph_consume_activation_grant_nonce_p16(p_nonce text, p_grant_payload_hash text, p_request_hash text, p_authority_hash text) returns jsonb`

The function:

1. validates all four inputs as exact lowercase 64-hex strings;
2. performs one `INSERT ... ON CONFLICT (nonce) DO NOTHING RETURNING consumption_id`;
3. returns exactly `{ "consumed": true, "consumption_id": "<uuid>" }` for the first successful insert;
4. returns exactly `{ "consumed": false, "consumption_id": null }` for replay;
5. never returns the stored hashes or an existing consumption id on replay.

The function is `SECURITY DEFINER`, has a fixed safe `search_path` containing only `pg_catalog` and `reference_graph`, and a bounded statement timeout. `SECURITY DEFINER` is justified here because the service-role RPC is the only mutation surface and the underlying table is intentionally private.

Immediately revoke `EXECUTE` from `PUBLIC`, `anon`, `authenticated`, and `service_role`, then grant it back only to `service_role`.

## Client integration

Extend `ReferenceGraphSupabaseStore` with:

`consumeActivationGrantNonceP16({ nonce, grant_payload_hash, request_hash, authority_hash })`

The method calls only `reference_graph_consume_activation_grant_nonce_p16` through the existing redacting RPC transport and returns only an exact P15 consumption result:

- `{ consumed: true, consumption_id: <non-empty string> }`, or
- `{ consumed: false, consumption_id: null }`.

Malformed RPC responses fail closed with an exception. The method never exposes the service-role key and is not imported by the production query runtime.

## Concurrency and replay semantics

The nonce primary key is the serialization point. Concurrent first-use attempts for the same nonce may race, but at most one insert can succeed. Exactly one caller may receive `consumed: true`; every other caller receives `consumed: false`.

Consumption is irreversible. There is no delete, reset, unconsume, expiry cleanup, or administrative replay bypass in P16.

A consumed grant remains consumed even if a later activation attempt fails or rolls back. P15 therefore requires a newly signed grant for every retry after consumption.

## Live ownership and evidence

P16 may apply migration 010 only to the already-bound dedicated project `vrznfnxzlxaavpqbzbzd` after repository CI is green on the implementation SHA.

Live verification must prove:

- the table and RPC exist;
- the ledger is empty before any real production grant is available;
- `anon` and `authenticated` cannot execute the RPC;
- `service_role` can execute it;
- unprivileged roles cannot read or mutate the private table;
- the exact migration is present in repository governance;
- Supabase security advisors report no P16-attributable error requiring remediation.

Do not consume a synthetic nonce on the live production ledger merely to demonstrate success. Atomic-consume behavior is proven in CI against disposable Postgres; the live ledger must remain empty until a real externally signed production grant is used.

## Durable repository state

P16 durable evidence may mark the replay ledger live and ready while production remains:

- authority state: awaiting external enrollment;
- grant state: not issued;
- grant consumed: false;
- activation authorized: false;
- activation performed: false;
- repository default graph enabled: false;
- production source: `legacy-control`.

The remaining blocker after P16 is the external production ceremony plus a real environment/deployment actuator for `REFERENCE_GRAPH_QUICK_RUNTIME`.

## P17 boundary

P17 owns binding the real host/control plane that sets or unsets `REFERENCE_GRAPH_QUICK_RUNTIME`, plus live read/apply/probe/rollback wiring. P16 must not implement shell command execution, arbitrary environment editing, GitHub deployment mutation, or a guessed hosting-provider adapter.

## Non-goals

- No production signer or private-key storage.
- No authority enrollment shortcut.
- No real or synthetic production grant consumption.
- No production activation.
- No change to P11 routing behavior.
- No Standard/Deep graph activation.
- No public ledger read API.
- No reset/unconsume endpoint.
- No provider-specific deployment integration.
- No arbitrary command execution surface.
