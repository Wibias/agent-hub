# AgentHub C9 G3: offline authorization verifier, v0 (review only)

This is a **separate .NET 10 pure library**; it is not connected to the C9 broker, commit code, SCM, CNG or any protected Windows directory. G3 is still HOLD; Production is NO-GO. No production issuer, trust anchor, private key, or signer is supplied.

The library verifies an exact v2 JSON ticket (no missing/duplicate/unknown fields) and a domain-separated ECDSA P-256/SHA-256 DER signature against an **externally pinned** SPKI SHA256. It binds release hash, operation, target name, volume/file IDs, content/preimage hashes, broker/client SIDs, request ID, ticket ID, nonce, short time window and issuer/key identity to caller-supplied observations. It returns `CanExecuteCommit=false` **even on success**.

## How to verify

With a **supported .NET 10 SDK**, in an isolated development shell:

```powershell
dotnet run --project tests/AgentHub.C9.G3.Tests.csproj --configuration Release
```

Tests create a disposable issuer key in the test process only. The verifier library contains no key generation or signing method. No network, file mutation outside normal compiler output, service operation or production key management is required.

## Missing before G3 can pass

1. Independent issuer/provisioner with controlled private key custody. Define whether separate Windows host/HSM is required and prove control separation from the broker and its client.
2. Non-user-writable, non-reparse, protected bootstrap for the SPKI and immutable pin, with independently recorded fingerprint, secure delivery, and key revocation/rotation lifecycle.
3. Authenticated broker and client process tokens, actual target handle/volume/file IDs and exact release binary SHA256 independently observed at runtime. **Caller-provided observation flags are not OS proof.**
4. Durable replay/nonce reservation (G4) and safe target identity/races (G5). A correct signature never implies permission to mutate.
5. Tests of ACL/owner/symlink swaps and a production trust enrollment path under an isolated Windows test identity. Nothing may be enrolled in production by this package.

No changes to existing historical C9 RC1-RC4 evidence. The source baseline may be reviewed and versioned separately, but never merged into the active read-only broker as a write route.
