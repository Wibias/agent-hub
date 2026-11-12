# AgentHub C9 G5: read-only pinned Windows target review

**REVIEW ONLY. G5 HOLD, all 7 release gates HOLD, Production NO-GO.**

This isolated .NET 10 component creates no service, target writer, pipe, installer, or commit API. It opens a caller-selected file beneath a separately trusted root with read-only Win32 handles, retains every ancestor directory handle, detects reparse points at each component, rejects multiple hardlinks, directories and pending deletion, and reads the **64-bit volume serial + 128-bit FileId** with `GetFileInformationByHandleEx(FileIdInfo)`. It computes the preimage SHA256 from the same held file handle under `FILE_SHARE_READ` (no write/delete sharing).

The caller must supply exact expected lowercase volume ID (16 hex), file ID (32 hex) and SHA256 (64 hex) from a separately authenticated approval. This library never infers an authorized target from its own observed path. The returned `PinnedReadOnlyFile` retains the file and ancestor directory handles for revalidation but **never grants commit authority**. No writable handle is exposed.

The Windows Server 2022 workflow runs only the narrow disposable review tests under an explicit GitHub-hosted runner guard and cleans up the randomly named test folder. It exercises symlink, directory reparse, hardlink, mismatched IDs, same-content file replacement, writer conflict, parent/leaf rename blocking, and retained handle revalidation.

**Not established:** A future authenticated G3 ticket and G4 nonce check have not yet been connected to this reader. The lease must NOT be disposed and a path reopened for a commit; a future G5 write-capable design requires an approved identity-bound operation on the same secured object, parent namespace and rename/replace semantics. This check is not a proof against compromised kernel/admin/file-system drivers, remote shares, all possible file ID reuse across time, or a previously opened privileged writer bypassing the share model. The root must come from an independently protected configuration. It does not validate all possible Windows path syntaxes; it deliberately accepts only a restricted local-drive ASCII path subset.

To test on the dedicated disposable runner:

`dotnet run --project tests/AgentHub.C9.G5.HandleReview.Tests.csproj --configuration Release`

Do not run on a normal personal PC or a production host. No CI requirement to repeat prior G3 suites.
