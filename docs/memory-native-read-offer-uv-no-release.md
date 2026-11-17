# #338: native protected read-offer and one-use UV, NO Codex release

This stage connects the existing disposable Windows LocalService, protected **private user-direct Claim** ledger, administrator-only operator named pipe, native WinForms operator application and the new read-specific WebAuthn purpose from #386. It does **not** connect a Codex/MCP private reader.

## End-to-end operator flow

1. The protected LocalService receives `read_begin` on the existing **administrator/SYSTEM/exact service SID** operator pipe. Request body contains only `projectId`, `branch`, `proposalRef` and a request nonce. There is no caller-provided Claim text, revision, SID, query, recipient identity, grant flag, file path or signer pin.
2. The service selects exactly one verified-join, service-owned `ProtectedOperatorDirectClaim` matching the project, branch and E~ proposal. It derives the revision, full Claim text, Claim ID, kind, provenance, query `exact-proposal:E~…`, result-set SHA-256 and **actual Windows pipe caller SID**. No row / no native-enrolled credential means no answer.
3. A one-time `ReadDisclosureMeaning` binds the exact project, branch, revision, caller SID, new random 24-byte request ID, query digest, exact result snapshot digest, and a FIXED **operator-UI-only** destination marker. **That marker is not a Codex process attestation or delivery channel.**
4. The service signs the whole preview and Windows Hello challenge with its existing service-owned ES256 private key; the protected WinForms client trusts only the independently admin-owned public pin and verifies the complete original Claim, the selected-item digest, query, revision, recipient marker, nonce and short expiry. The operator sees the actual Claim and exact preview scope.
5. A separate checked box and **explicit native Windows Hello button** submit the fresh purpose-bound `read_complete` proof. The service consumes the ticket even on malformed or mismatched assertions; it re-reads the same protected Claim snapshot and verifies the read-purpose UV assertion.
6. A success reply is only `verified_read_disclosure_intent_only`, with `read_released=false`, `published_to_codex=false`, `claim_written=false`, `human_approval_verified=false` (synthetic CI deliberately cannot assert an actual human gesture). **There is no read permission or data transport.** No credential, Claim, authorization or grant record is written by this read operation.

The fixed operator preview marker prevents someone confusing the current phase with an authenticated Codex recipient. The next release step must implement a real protected **one-time authorization-and-delivery operation** that atomically revalidates and releases exactly the displayed protected Claim to a secure intended recipient *only after independent native operator consent*. Windows SID, PID and a user-supplied session hash by themselves cannot identify a safe Codex session. Same-SID process injection, application control and response-channel hijacking remain release blockers. Previously exposed data cannot be recalled.

## Windows evidence

A disposable Windows x64 LocalService CI fixture uses a synthetic ES256 credential to register, reaffirm, privately commit one exact protected knowledge Claim, obtain its signed read offer, attempt a wrong-purpose assertion (denied), retry the consumed ticket (denied), and complete a fresh read-purpose assertion (intent only, **NO release**). A separate actual compiled WinForms EXE verifies the signed service offer and original Claim text on the live SCM IPC without physical Hello. The existing restricted token still cannot access the admin pipe or protected SQLite. No other Windows user or VM is required.

A real operator Hello and original Codex CLI/Desktop recipient acceptance are **NOT** tested here. The code changes are default-OFF: no new installed service, hook, production Memory DB migration, private model-facing read or change on the operator PC.

**#338 OPEN. Production Memory Writes and private real-project Recall remain NO-GO.**
