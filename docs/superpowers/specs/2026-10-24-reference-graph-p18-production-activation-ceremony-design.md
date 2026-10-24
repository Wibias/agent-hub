# Reference Graph P18 Production Activation Ceremony Design

## Intent

P18 turns the P17 `ready-unexecuted` local actuator into a deliberate production activation ceremony. It must preserve the external Ed25519 authority boundary, consume the P16 nonce exactly once, activate only Quick, prove Standard/Deep remain legacy, and leave an auditable receipt. It must not put a private signing key in the repository, Supabase, `.agents`, CLI arguments, environment variables, logs, or receipts.

## Starting point

- P17 final evidence/head: `1042b502e895e050b398f66b45b313c477eaab2f`.
- P17 tested implementation: `cc3bc59250ec2b51d9a43d3e14815593cc44c2c7`.
- P17 host actuator is `ready-unexecuted` and production remains `legacy-control`.
- P14 defines the exact external Ed25519 enrollment manifest and <=15 minute grant contract.
- P15 owns verification, nonce-before-mutation ordering, post-activation probe, rollback, and no-retry semantics.
- P16 owns irreversible durable grant replay consumption.
- P17 owns the real local state projection and host actuator.

## Selected authority model

The production private key is kept in an operator-controlled directory outside the AgentHub runtime root and repository, for example `%USERPROFILE%\.agent-hub-authority` on Windows. The repository never generates, loads, decrypts, or signs with that key.

The authority uses standard OpenSSL tooling outside AgentHub:

1. Generate a passphrase-encrypted Ed25519 PKCS#8 key.
2. Export only the public SPKI DER file.
3. P18 converts that public file into the exact P13 authority descriptor.
4. The operator manually copies the printed authority SHA-256 into a separate approval file. P18 never silently self-approves the descriptor.
5. P18 emits both a pretty unsigned payload and the exact canonical UTF-8 bytes to sign.
6. OpenSSL signs the canonical file with Ed25519 using `pkeyutl -sign -rawin`.
7. P18 assembles and cryptographically verifies the signed grant before activation.

This keeps private-key custody external while avoiding a new signing API in production code.

## Supabase admin key modernization

The production activation operator needs elevated access only for the P16 consume RPC. P18 updates `ReferenceGraphSupabaseStore.fromEnv()` to prefer `SUPABASE_SECRET_KEY` and fall back to legacy `SUPABASE_SERVICE_ROLE_KEY`.

For `sb_secret_...` keys the REST transport sends the key only in the `apikey` header. It must not send `Authorization: Bearer sb_secret_...`. Legacy JWT service-role keys keep the historical `apikey` + `Authorization: Bearer ...` behavior.

The secret key is accepted only through process environment; never CLI arguments, files written by P18, receipts, or logs.

## P18 ceremony CLI

Create `reference-graph/cli/p18-production-activation.mjs` with exact modes:

- `--authority-descriptor <public-spki.der> <authority-id> <key-id> <out.json>`
- `--authority-hash <authority.json>`
- `--prepare-grant <authority.json> <approved-sha256-file> <payload.json> <canonical.json>`
- `--assemble-grant <authority.json> <approved-sha256-file> <payload.json> <signature.bin> <grant.json>`
- `--preflight <authority.json> <approved-sha256-file> <grant.json>`
- `--activate-production <authority.json> <approved-sha256-file> <grant.json> ACTIVATE-QUICK-REFERENCE-GRAPH`
- `--status`

`--prepare-grant` generates a cryptographically random 32-byte nonce, `issued_at == not_before == now`, and `expires_at == now + 10 minutes`. It writes the exact canonical bytes that P13/P14 verify.

`--assemble-grant` requires a 64-byte Ed25519 signature and refuses to write a grant unless the signature verifies against the approved descriptor at the current time.

`--preflight` is strictly read-only. It validates the P17 evidence binding, external approval hash, signed grant, local legacy pre-state, target Supabase URL/project ref, publishable runtime key presence, and elevated key presence. It does not call the consume RPC.

`--activate-production` requires the exact human confirmation token shown above. It performs the same preflight, then calls `executeP17Activation()` with a real `ReferenceGraphSupabaseStore.fromEnv()`. The signed grant is consumed at most once. Any post-mutation failure rolls back through P15/P17.

## Environment contract

Production activation requires:

- `SUPABASE_URL=https://vrznfnxzlxaavpqbzbzd.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY=<current publishable key>`
- `SUPABASE_SECRET_KEY=<preferred current secret key>` or legacy `SUPABASE_SERVICE_ROLE_KEY`

P18 never writes these values to disk.

## Receipt

The CLI prints a secret-free JSON result suitable for explicit operator redirection after successful activation. The result includes status, grant/request/authority hashes, consumption state, activation/rollback state, production source, and blocker. It never includes raw grant, signature, nonce, API keys, private/public key bytes, or local authority paths.

A later frozen P18 evidence record may be committed only after a real operator run. Until then P18 repository evidence must remain `activation_performed=false`.

## Safety invariants

- No private-key import/generation/signing API under P18 production code.
- No secret key CLI flags.
- No live P16 consumption in CI.
- No synthetic live activation.
- No migration 011+.
- Repository default graph remains false.
- Missing/malformed P17 local state remains legacy.
- Quick only may become graph; Standard and Deep remain legacy.
- Consumed grants are never retried.
- Rollback must be verified before reporting restored legacy.
