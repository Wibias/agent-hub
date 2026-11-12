# G5 minimal handle-rename laboratory

**Development-only, no Broker integration. G5 Write HOLD; G1-G7 0/7; Production NO-GO.**

One .NET 10 Windows-only executable, one CI workflow, **three tests**:

1. **Positive:** use the existing pinned G5 read-only check; write and `Flush(true)` a `CREATE_NEW` staging file; close the G5 leaf handle; rename via `NtSetInformationFile(FileRenameInformation)` on the **same staging handle** with a retained target-directory handle; verify target content and stage File-ID.
2. **Access-control negative:** during the gap after the G5 leaf handle closes, a separate real `LocalService` process launched by one temporary scheduled task requests `DELETE` on the destination and tries to rename it. It must see `ERROR_ACCESS_DENIED` (5) and leave the destination unchanged. The CI runner's Administrators group is the sole lab writer. This is not a proof against other privileged writers.
3. **Interruption:** kill child processes immediately before and after the rename. Restart performs **inspect-only** classification (`OLD_WITH_STAGE`, `NEW_NO_STAGE`, otherwise `AMBIGUOUS_DENY`). No automatic retry or repair.

The runner is GitHub-hosted `windows-2022`, not a persistent service or personal PC. A GUID-scoped directory under `C:\ProgramData` receives a restricted DACL before any fixture file exists. The short-lived Task Scheduler entry and files are deleted in `finally`; a failed cleanup fails CI.

**Important limitations:** `FILE_RENAME_INFO` resolves the destination **by name**. Windows does not provide an atomic compare against the approved destination File-ID. The test only establishes exclusion for the tested unprivileged `LocalService` principal with the configured DACL. The writer is an elevated CI principal, **not the Broker service SID**, and G2/G3/G4 are not part of this stand-alone lab. Do not connect this code to RC2 or enable a production commit. Durability across OS failure/power loss and independent rollback detection are not established. The lab only tests process termination.

Windows finding: The first lab run proved `LocalService` ACL denial but Win32
`SetFileInformationByHandle(FileRenameInfo)` returned `ERROR_INVALID_PARAMETER` (87)
for a non-null directory `RootDirectory`. Rather than weaken the directory binding
by renaming through an absolute path, this experiment uses user-mode
`NtSetInformationFile(FileRenameInformation = 10)` with the same native target
parent handle. That API is a lower-level Windows native interface and has
**not** been approved as a production compatibility boundary.

Microsoft Learn: `CreateFileW`, `ZwSetInformationFile` (use `NtSetInformationFile`
from user mode), `FILE_RENAME_INFORMATION` (Windows Driver Kit).
