# C9 G3 local development integration V0.1 (WORM deferred)

**TEST-ONLY. G3 HOLD. 0/7 gates. PRODUCTION NO-GO.**

This directory integrates the *existing* G3 `AuditEngine`, `AnchorEngine`, `WitnessProtocol`, `TrustBootstrap` and three actual durable `AnchorJournal` files, using a local test seal compiled **only into the integration-test executable**. It does not change the production Audit server, remote seal interface, Windows Broker, service installation, ACLs, trust pins or signing-key custody.

A local hash-chained disk journal supports repeatable feature development and crash-style reopen, but is **not** an independent witness, WORM storage or rollback protection. Restoring all local journals together can erase evidence of revocation. The test demonstrates single-file mismatch denial only; it deliberately does not call that security assurance. Existing remote S3 compliance adapter remains an optional future release-gated implementation.

## Run the targeted integration test

With .NET SDK 10.0.100 and no network/credentials required:

```powershell
dotnet run --project tests/AgentHub.C9.G3.LocalDev.Tests.csproj --configuration Release
```

The test executable creates disposable in-memory P-256 keys and three journal files in a random temporary folder. It uses an explicit unsafe-lab marker *inside the test process* and removes all files at exit. The local seal is compiled into this test executable, **not** into any service or broker assembly. It verifies signed genesis, signer chain, rotation, revocation, replay denial, restart persistence, single-file rollback denial and torn-journal rejection.

**No production signer. No remote service. No external CAS. No independent storage. No commit ability. No G3 release approval.** The previous `g3-s3-seal` remains on hold until an independent platform and operational authority are available.
