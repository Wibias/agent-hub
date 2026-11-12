# G5 handle-based rename laboratory (review only)

This isolated Windows x64/NTFS experiment exercises **only** the G5 filesystem commit primitive. It does not integrate G2/G3/G4/G5 authorization, grant production write permission, or modify an installed broker. The disposable test area is created below `%ProgramData%\AgentHub-G5-Lab-<random>`.

- Authorized test writer writes and flushes a staging file, keeps its DELETE-capable handle open, opens the protected target directory, and calls `SetFileInformationByHandle(FileRenameInfo)` with `FILE_RENAME_INFO.RootDirectory` and a single target filename.
- Real `LocalService` adversary attempts a replacement through a one-time scheduled task and must receive access-denied error 5.
- Separate invocations simulate termination after staging flush and recover by discarding the orphan before retrying.

Run on a disposable **administrator** Windows x64 runner with .NET 10, using `pwsh -File ./verify-windows.ps1`. The script creates and removes its own narrowly named task and temporary directories. A PowerShell or permission error fails closed. No service, pipe, installed broker, or production target is touched.

**Limits:** Rename does not support a target-file-ID compare-and-swap. The ACL assumption excludes an attacker with administrator/SYSTEM privileges, the authorized writer token, or existing powerful handles. The restart test is a process-interruption demonstration, not a sudden power-loss/durability guarantee. Passing this lab is **not** a G5 production release gate. Production remains **NO-GO**.
