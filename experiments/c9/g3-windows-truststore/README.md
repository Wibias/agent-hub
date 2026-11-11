# AgentHub C9 G3: Windows protected-registry trust reader (review only)

**Status: G3 HOLD, 0/7 approved, production NO-GO.** This standalone component reads, but NEVER creates or modifies, a dedicated Windows Registry64 key:

`HKLM\SOFTWARE\AgentHub\C9\G3\Trust`

It requires a non-inherited DACL with exactly full-control ACEs for `NT AUTHORITY\SYSTEM` and `BUILTIN\Administrators`, and an owner from those principals. No default user, service or interactive access is permitted. It verifies the security descriptor from the already-open key handle, reads typed values twice, and rechecks the descriptor. No service, broker or process authorization is granted.

The five expected registry values are `RootKeyId` (`REG_SZ`), `RootSpkiBase64` (`REG_SZ`), `RootSpkiSha256` (`REG_SZ`), `Revision` (`REG_QWORD`) and `ManifestSha256` (`REG_SZ`). No other values or subkeys are accepted. Root public key pin AND exact revision/manifest hash MUST independently come from a trusted authority outside this registry snapshot. When verified, the existing offline `TrustBootstrap.Verify` is called to check the root signature. Return value still has `CanExecuteCommit=false`.

A protected HKLM key is NOT a hardware monotonic counter or independently witnessed store. A Windows administrator/SYSTEM can replace or roll back both registry state and local files. The user-approved G3 threat model excludes a fully compromised administrator, but a separate trusted witness is still mandatory. The component cannot prove freshness or custody of caller-provided witness. **No actual HKLM key is installed, and no owner key is enrolled by this project.** Registry ACLs, parent-key ownership, privileges and any future provisioning will require isolated native acceptance before production.

Run only the focused Windows test project (no registry writes):

```powershell
dotnet run --project tests/AgentHub.C9.G3.WindowsTrustStore.Tests.csproj --configuration Release
```

This is a review-only read path. Existing G3 ticket/verifier and signed trust-bootstrap code and its 53 historical passing tests are unchanged.
