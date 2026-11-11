# AgentHub C9 G3 | External Witness GetCurrent server V0.1 (review only)

**Scope:** Real .NET 10 HTTPS/mTLS **GetCurrent** server implementation with a strict, separately anchored, signed-current-head dependency. It is **not deployed** and it has **no working AdvanceHead endpoint**, issuer, owner enrolment, database, HSM provisioning, or commit authorization. G3 is HOLD, 0/7 gates approved, Production NO_GO.

### Boundaries

- Service refuses startup without an external absolute config path. The config must describe the external anchor's HTTPS endpoint, independently pinned anchor P-256 signing public key, pinned TLS certificate SHA256, reader client certificate-to-scope mappings, and Windows LocalMachine certificate thumbprints for witness TLS/signing and outgoing anchor mTLS.
- All private keys are looked up in the Windows LocalMachine certificate store; none are generated, embedded, exported or stored in this repository. A genuinely separate operational key custodian and independently approved certificate enrolment are still missing.
- `POST /v1/current` requires a chain-validated, allowlisted client certificate (`RequireCertificate`) and a strict versioned request with a fresh 256-bit caller nonce. **The scope comes from the authenticated certificate mapping, not the request.**
- The service generates its **own independent 256-bit nonce** for a second mTLS request to the external anchor. It accepts a signed P-256/SHA-256 reply only if the configured independent public-key pin, scope, nonce, epoch, revision, manifest hash and 30-second window match. It then returns a new, domain-separated, DER-signed 15-second witness response bound to the caller nonce.
- The network transport is always HTTPS, outbound TLS peer certificate is pinned in addition to chain validation, redirect following is disabled, and read bodies are bounded to 4096 bytes. On missing/unavailable/stale/mismatched anchor, it returns **503 without a signed response**.
- There is **no** `/v1/advance`, re-enrol, reset, recovery, registration, or private signing endpoint. No agent/client can mutate witness state. The service has no persisted head and cannot fabricate an independent checkpoint.
- `GetCurrent` only attests the signed anchored *head*. It does not authorize a file write, attest the Windows client's token, defeat a compromised witness/anchor admin, or guarantee instant revocation of in-flight work. The anchor must independently verify its WORM/append-only head before signing responses.

### Local source verification

From `experiments/c9/g3-witness`, with **.NET SDK 10.0.100**:

```
dotnet run --project tests/AgentHub.C9.G3.Witness.Tests.csproj --configuration Release
dotnet build src/Server/AgentHub.C9.G3.Witness.Server.csproj -c Release
```

CI runs these exact checks without launching a listener, connecting to external endpoints, modifying HKLM, starting a service, or enrolling keys. Test signatures are created in memory and discarded.

### Real deployment blockers

1. An independently controlled **remote anchor service** exposing a fresh signed `/v1/current` reply, with monotonic durable CAS head, immutable audit anchor, and revocation tombstones. This repository does **not** implement or provision that authority.
2. Production certificate issuance, mTLS trust chains and revocation, client identities/scopes, nonexportable witness signing key with separate custody and owner approval.
3. Consumer-side pin verification, clock policy, epoch bootstrap and HKLM read-only cross-check at each authorization boundary. Existing G3 Windows reader is not wired into this server.
4. Interrupted remote update, availability, concurrency, host privileged adversary and disaster recovery/security review.

The authoritative requirements are in `../g3-bootstrap/docs/G3-EXTERNAL-WITNESS-CONTRACT-V1.md`. A successful targeted build is evidence for source compilation and protocol tests only, **not** a G3 release approval.
