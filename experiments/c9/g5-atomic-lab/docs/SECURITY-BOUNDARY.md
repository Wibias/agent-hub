# G5 isolated atomic replacement experiment: security boundary

- Only a disposable GitHub-hosted Windows-2022 runner is in scope. Files are under a GUID-scoped `RUNNER_TEMP` directory; no elevated SCM changes, service activation, production target or secrets.
- `HandleIdentity.OpenApprovedReadOnly` is reused verbatim and stays read-only. The separate experiment calls `File.Replace` only **after** the proof lease is disposed, using paths in a single dedicated NTFS test directory.
- G5 FileId/preimage checks catch an already-present same-content swap, but they **cannot** authorize the subsequent path replacement after releasing the handle. The explicit TOCTOU attack test substitutes the destination after the proof and demonstrates that `File.Replace` can then replace a different file identity. Report `G5_TOCTOU_UNRESOLVED_PROOF`; never treat lab PASS as G5 write approval.
- Fault injection kills child processes at two deterministic barriers, not the operating system. The inspector is read-only and denies unexpected on-disk combinations; no automatic retry or repair with attacker-writable evidence.
- Cooperative lock checks and existing writable handle failures do not establish protection against privileged or malicious actors, uncooperative writers, shared volumes, filesystem filters or crash-durability guarantees.
- G3/G4 approval and replay, a protected directory-root handle, conditional handlegebundener commit primitive, independent rollback anchor and release/signing authority remain absent.

Refs: Microsoft Learn `File.Replace` / `ReplaceFileW`, `SetFileInformationByHandle` / `FILE_RENAME_INFORMATION`, `FileIdInfo`.

All gates HOLD (0/7); Production NO-GO.
