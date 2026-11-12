# AgentHub C9 G3 independent Anchor v0.1 (review-only)

This is an independent, **off-broker** .NET 10 HTTPS/mTLS Anchor implementation and a focused Windows test fixture. No service is installed, no certificate or production key is created, and there is no deployment configuration or installer. The existing `g3-witness` source, previous tests, and production code remain untouched.

## What is implemented

- Compatible with the existing `g3-witness` `AnchorQueryV1` and signed `AnchorReceiptV1` contract. `/v1/current` signs an exact scope/epoch/revision/manifest-hash/root-key/nonce with a pinned machine certificate, valid 15 seconds.
- Two independent mTLS roles, `reader` and `owner`. Only a certificate explicitly mapped to `owner` can call `/v1/advance`; ordinary witness readers cannot.
- `AdvanceHead` checks exact expected head (CAS), a root-signed issuer manifest at revision +1, explicit rotate/revoke reason, root identity, and revoked-key tombstones. No reset, epoch change, initial enrollment, force or downgrade endpoint.
- The server sends CAS to a **separate durable audit authority** first. Only after a verified signed audit receipt indicating the new head does it append locally, force-flush, reread and confirm the audit head again. Any ambiguous remote outcome or local failure latches the process into deny-only until an operator-controlled recovery.
- The local journal has an exclusive OS lock, ordered hash-linked records, append + `Flush(true)`, strict replay parsing, a torn-tail denial and no implicit initialization. This detects corruption but is **not itself an anti-rollback/WORM storage guarantee**.
- The audit HTTP transport uses an independently pinned signing SPKI, pinned TLS server cert, no redirects or proxies, a machine-store mTLS identity, nonce and signature verification. It expects `/v1/current` and `/v1/advance` from a separately operated audit system.

## Critical operational boundary

**This package does NOT implement the durable WORM audit backend.** It cannot establish tamper-proof monotonicity, durable remote commit, independent administration, or real two-host uptime without that backend. The HTTP adapter verifies an external signed result but cannot prove that the remote system durably and immutably stored the new revision. A malicious or broken audit service that signs an uncommitted head defeats the intended guarantee. The local journal cannot fix that.

The server refuses to start unless `C9_G3_ANCHOR_ENABLE=REVIEW_ONLY`, a fully qualified `C9_G3_ANCHOR_CONFIG_PATH`, existing preprovisioned journal, separately pinned root and audit public keys, individually provisioned Windows LocalMachine certificates, and explicit reader/owner certificate mapping are present. It does not create any of these. Do **not** put production key material in GitHub or test artifacts.

## Exact tests (Windows, pinned SDK 10.0.100)

```powershell
dotnet run --project tests/AgentHub.C9.G3.Anchor.Tests.csproj --configuration Release
dotnet build src/Server/AgentHub.C9.G3.Anchor.Server.csproj --configuration Release
```

Tests use disposable process keys and a simulated in-memory external audit, then check signed head verification, revoked-key reuse denial, local journal reopen, torn writes, external/current mismatch and a crash after external commit but before local append. No real independent audit host is started or contacted. Previous G3 test suites are not repeated.

## Remaining work before any G3 approval

1. Independently controlled, durable, linearizable, immutable audit service with enforced `GetCurrent`/CAS, tombstone retention and **off-host append-only/WORM proof**.
2. Root, witness/anchor/audit key custody, certificate enrollment and identity-to-scope mapping; ACL and transport security review and real two-host challenge-response.
3. Provisioner-controlled genesis creation, file/parent ACL and reparse protection, crash/power-loss recovery, out-of-process hardware-backed signing where required, and independent approval of privileged-adversary boundaries.
4. Integration with the Windows read-only HKLM consumer, and remaining G1/G2/G4/G5/G6/G7 gates.

**G3 HOLD, 0/7 production gates, Production NO-GO.**
