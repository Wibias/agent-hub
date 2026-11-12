# G5 handle-based rename laboratory (review only)

This isolated Windows x64/NTFS experiment exercises **only** the G5 filesystem commit primitive. It does not integrate G2/G3/G4/G5 authorization, grant production write permission, or modify an installed broker. The disposable test area is created below `%ProgramData%\AgentHub-G5-Lab-<random>`.

- Authorized test writer writes and flushes a staging file, keeps its DELETE-capable handle open, opens the protected target directory, and calls `NtSetInformationFile(FileRenameInformation=10)` from `ntdll.dll` with the still-open `RootDirectory` handle and a single relative filename. The original Win32 `SetFileInformationByHandle(FileRenameInfo=3)` rejects this pattern with Win32 error 87 on Windows Server 2022; the final lab keeps no path-based fallback.
- Real `LocalService` adversary attempts a replacement through a one-time scheduled task and must receive access-denied error 5.
- Separate invocations simulate termination after staging flush and recover by discarding the orphan before retrying.

Run on a disposable **administrator** Windows x64 runner with .NET 10, using `pwsh -File ./verify-windows.ps1`. The script creates and removes its own narrowly named task and temporary directories. A PowerShell or permission error fails closed. No service, pipe, installed broker, or production target is touched.

**Limits:** Rename does not support a target-file-ID compare-and-swap. The ACL assumption excludes an attacker with administrator/SYSTEM privileges, the authorized writer token, or existing powerful handles. The restart test is a process-interruption demonstration, not a sudden power-loss/durability guarantee. Passing this lab is **not** a G5 production release gate. Production remains **NO-GO**.

**Compatibility evidence:** Microsoft's driver API reference describes `NtSetInformationFile` but does not promise a stable public user-mode Win32 contract for direct `ntdll.dll` P/Invoke. The successful Windows Server 2022 3/3 CI run validates only that build. The non-admin Windows 11 x64 client pilot below is a separate compatibility check. Do **not** run the administrative `verify-windows.ps1` on a daily-driver workstation.

## Direct Windows 11 x64 / original Codex Desktop pilot (no VM, no admin)

Run `run-on-windows11.ps1` from a **non-elevated** PowerShell 7 or a user-authorized terminal action in the original Codex Desktop project. It copies only the C# source and project into a random, ACL-scoped `%LOCALAPPDATA%\AgentHub-G5-Pilot-*` folder, builds with the installed .NET 10 SDK, executes a real open-handle commit and a staged-interruption/recovery, and deletes that folder. It makes **no changes** to Codex configuration, Memory SQLite, installed services or project files.

```powershell
pwsh -NoProfile -File .\experiments\g5\handle-rename-lab\run-on-windows11.ps1
```

Expected exact receipts: `G5_WIN11_USERMODE_HANDLE_COMMIT_PASS`, `G5_WIN11_USERMODE_RECOVERY_PASS`, `G5_WIN11_PILOT_2_OF_2_PASS` and `G5_WRITE=HOLD PRODUCTION=NO_GO`. Missing SDK, elevation, incorrect OS or non-NTFS volume fail closed. No implicit SDK installation. This is a **direct Windows 11 user-mode compatibility probe**: it does not rerun the privileged LocalService adversary test and does not register a write tool in Codex.

To test from original Codex Desktop, open the checkout containing this branch and ask it: "Execute exactly `pwsh -NoProfile -File .\experiments\g5\handle-rename-lab\run-on-windows11.ps1` in a non-elevated terminal. Do not change configs, install software or access my real memory database. Report the actual process exit code and exact G5_* receipt lines. Do not infer success without tool output." Approve only that command if Desktop requests authorization. A model response without observed terminal execution does not count as Windows 11 evidence.
