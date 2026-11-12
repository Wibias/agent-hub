# AgentHub C9 G3: independent audit CAS service V0.1

**REVIEW ONLY. G3 HOLD. 0/7 gates. Production NO-GO.**

This is an independently deployable .NET 10 audit service implementing the wire contract consumed by the existing C9 Anchor `AuditHttpBackend`: mTLS `POST /v1/current` and `POST /v1/advance`, with scoped ECDSA P-256/SHA-256 signatures. It uses a separately provisioned append-and-fsync local journal and **refuses to sign any head unless it matches a fresh, cryptographically verified full-head receipt from an independently controlled immutable storage seal**.

## What it does

- Requires external, explicitly pinned Root/Seal keys and LocalMachine certificates. No default config, key generation, genesis enrollment, admin route or production installation.
- Accepts separate mTLS `reader` and `writer` client identities. The existing Anchor's single audit client certificate currently needs `writer` role for both operations; split it in a future reviewed integration.
- Validates exact CAS preimage and newly signed issuer manifest, monotonic revision, root key continuity, and revoked-issuer tombstones.
- Calls the independently deployed immutable seal's CAS before appending and flushing its local journal; if the remote CAS outcome is unknown or local write fails it refuses further signatures and requires controlled recovery.
- Signs a short-lived, nonce-bound current head in the format already expected by the Anchor. The signed head does **not** authorize execution.
- Requires signed seal receipts over ALL state fields including issuer ID, issuer SPKI pin and revocation flag, with exact nonce, clock, scope and pin validation.

## What it does NOT prove

The `SealHttpBackend` is an **authenticated interface and verifier**, not immutable storage. The local `AnchorJournal` is a hash-chained file with `Flush(true)`, **not WORM**. A malicious administrator who can roll back both a disk and the unprotected seal defeats local protection. A genuine independent object-lock/WORM service with verified retention/denial, authenticated CAS semantics, operator separation and recovery is not provisioned here. No two-host or power-loss tests have run. The tests use a process-local simulated seal.

The service is source-only in GitHub Actions; it is never started. To consider operating it in a separated environment, review `docs/G3-AUDIT-SECURITY-BOUNDARY.md`, provision independent certificate and storage custody, validate immutable append/CAS on real storage, and complete an explicit test under disposable external identities. **Do not deploy on a production host or the Windows daily driver.**

## Focused review build

```powershell
dotnet run --project tests/AgentHub.C9.G3.Audit.Tests.csproj --configuration Release
dotnet build src/Server/AgentHub.C9.G3.Audit.Server.csproj --configuration Release
```

No external NuGet feeds. SDK pinned in `global.json`. Existing C9 source, broker, Windows trust store and prior tests are unchanged.
