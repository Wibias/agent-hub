# G5 target identity and race boundary (review-only implementation)

- Threat model: AgentHub C9 V1.3 I5, A07 and A08 (existing write/delete handles, reparse/hardlink/mount swaps, stable Volume/File-ID).
- Win32 handle proof: GetFileInformationByHandleEx(FileIdInfo), 8-byte volume serial and 16-byte raw FileId, format lowercase hexadecimal; reject a file system that cannot provide a valid identity. These are *live handle observations*, not client-provided paths or declared ticket fields.
- Authoritative pin: independently authenticated G3 approval `TargetVolumeId`, `TargetFileId`, `PreimageSha256`. This component accepts them as strict input; it does not perform G3 signing/authentication or G4 replay reservations.
- Scope: canonical local-drive ASCII root + relative leaf only, no UNC, ADS, dot segments, trailing dots/spaces or Windows verbatim prefixes. Open every directory component with `OPEN_REPARSE_POINT | BACKUP_SEMANTICS`, deny reparse, retain handles without delete sharing, then open the leaf with `OPEN_REPARSE_POINT` and share-read-only, reject file reparse, multiple links, pending deletion and excessive size.
- Identity+preimage: observe file ID, volume serial, link count, file size and SHA256 on *one retained leaf handle*. An exact independent pin is required, then `RecheckPinned` operates on the same handle. `CanExecuteCommit=false` under all outcomes.
- Safety boundary: The held path components and leaf handle resist ordinary unprivileged renaming while open. They are not a substitute for handle-relative mutation, native parent-namespace atomic replacement, protected root/caller token, authorized operation semantics or Windows kernel-level adversaries. Do not close handles and reopen by path after a successful check.
- Real ACLs/service identity, positive mutation tests, preexisting WRITE/DELETE handle permutations, filesystem filter races, simulated mount-point swaps and file-id reuse are **not resolved**. No production action or G5 security signoff is implied by this read-only subset.

Sources: Microsoft Win32 CreateFileW, GetFileInformationByHandleEx / FILE_ID_INFO, FILE_STANDARD_INFO, Reparse Points documentation.

G5=HOLD; G1-G7=HOLD; Production=NO_GO.
