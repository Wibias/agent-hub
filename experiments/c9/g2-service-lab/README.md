# C9 G2 positive two-service SID test (ephemeral Windows CI only)

**G2 HOLD, G1-G7 HOLD (0/7), Production NO-GO.** This is not a service installer and contains no production broker, privileged target writer, commit route, or key enrollment.

This narrowly scoped experiment exercises the *previously unverified positive identity case* for `G2KernelIdentity` using **two real, separately hosted Windows services** on a GitHub-hosted Windows Server 2022 runner:

- `AgentHubEG4528JournalBroker` under `NT AUTHORITY\LocalService`, `SERVICE_SID_TYPE_UNRESTRICTED`; process token includes only the frozen broker service SID.
- `AgentHubD121417ScratchSvc` under `NT AUTHORITY\LocalService`, `SERVICE_SID_TYPE_UNRESTRICTED`; process token includes only the frozen client service SID.
- A disposable one-byte local named pipe; broker calls native `ReadFile`, then immediately uses the existing `G2KernelIdentity.SnapshotClientAfterRead` on that exact thread, and checks `RevertToSelf`.
- Two independent process-token receipts, OS-reported groups, client impersonation level, and explicit `CanExecuteCommit=false`. No G3/G4/G5 code is executed in the service experiment; the existing non-executable G2345 integration is unchanged.

Only the workflow in `.github/workflows/verify-c9-g2-two-service-lab.yml` is authorized to create these services. The workflow and script enforce the exact repository/ref, a **GitHub-hosted ephemeral runner**, an elevated disposable environment, .NET 10.0.100, and **absence of either service before changes**. Services use demand start, own process, no recovery actions, no network or production endpoints. Unique GUID paths/pipe; temporary files live under a restricted `ProgramData` folder. Both services and their files are removed in a `finally` block and cleanup must be verified before the job can pass.

If SCM permissions or LocalService binaries are unavailable, treat it as **BLOCKED/FAIL**, not a positive proof. No bypass to ordinary user identities or renamed substitute service SIDs is permitted.

**Residual security gaps:** a positive G2 lab does not constitute G2 security signoff or deployable broker authorization. No service installation or protected key custody on a persistent host is allowed. G3 external Witness, G4 independent replay protection and G5 handle-bound mutation remain HOLD. These service names must never be created on a user's Windows desktop or production system.

Run is intentionally not documented as a local command. It is triggered only by the exact guarded GitHub Actions workflow on `codex/c9-g3-offline-review`.
