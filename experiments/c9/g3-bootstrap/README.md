# C9 G3 Trust-Bootstrap V0.1 (offline, review only)

This is a separate component built against the already-versioned G3 ticket verifier. Existing G3 source, service behavior, and the 23 historical ticket tests are unchanged. No production keys, signer enrollment, Windows service or trust-store mutations exist here.

- A separately supplied SHA256-pinned P-256 root key signs a strictly parsed manifest describing one issuer public key as `active` or `revoked`.
- A separately supplied protected checkpoint must match the exact manifest revision and SHA256. Rotation or revocation becomes effective **only if a different external trusted checkpoint** is provisioned.
- This code does not implement, authenticate, advance or persist that checkpoint. It cannot prevent rollback of the checkpoint itself. **This is not a production-capable trust store.**
- The result is an offline key snapshot (`TrustedKeySnapshot`) with `CanExecuteCommit=false`; the existing ticket verifier independently denies commit execution, including on valid signatures.

To run the narrow new test set with .NET SDK 10.0.100:

```powershell
dotnet run --project tests/AgentHub.C9.G3.Bootstrap.Tests.csproj --configuration Release
```

For remaining security boundaries and explicit non-goals, see `docs/G3-BOOTSTRAP-BOUNDARY.md`.

**G3 = HOLD. G1/G2/G4/G5/G6/G7 = HOLD. Production = NO_GO.**
