# Memory MVP: service-signed read -> existing Codex memory_recall (disposable lab)

**Status:** Windows x64 **CI lab only**. No production IPC, no real
approval, no service installation on a user's PC, no canonical Memory DB
migration. This is not M2/M3 completion.

## What is now connected

The existing `AgentHubMemoryReviewLab` runs under a restricted Windows
LocalService service-specific SID. It opens its own ProgramData SQLite WAL,
seeds exactly **one synthetically approved fixture Claim** with an ephemeral
P-256 test key, and exposes one local read-only named-pipe operation:

```text
\\.\pipe\AgentHubMemoryReviewLab-ReadV1
protocol=agenthub-protected-lab-read-v1
op=recall
```

The client supplies only an opaque fresh 32-byte nonce, a query, a bounded
item count and the fixed synthetic fixture project/branch. The service
**never accepts a DB path, arbitrary file path, write action, credential,
Claim mutation or real project enrollment** through the pipe. It reads its
service-owned store and signs the exact UTF-8 response payload with an
ES256/P-256 private key stored under the service-SID-protected directory.

The CI installer extracts only the public key to an
**Administrators-owned, read-only-to-ordinary-users** ProgramData directory.
The Node client reads that pinned key (not a key provided by the pipe),
verifies the signature over raw bytes, checks the random nonce and exact
scope and validates every returned fact digest and synthetic provenance.
A wrong key, changed response, foreign project, unapproved Git root or
extra MCP tool arguments fail closed with no data. The key pin is a trust
anchor only if its directory owner/DACL is independently protected at install;
a user-selected writable pin is **not** proof of origin.

The existing `memory_recall` Codex stdio MCP now supports *async* read
providers. The normal `--global` and `--cwd` modes are unchanged and
continue using canonical user memory. A deliberately separate
`--lab-protected-read --scope ABS_SCOPE --pin ABS_PIN` mode reuses
the **same `memory_recall` MCP tool** but performs real Git-root
enrollment checks and reads the signed Windows pipe. There is never a
fallback to unverified local SQLite when the protected pipe fails.

## What CI proves

Windows GitHub Actions:
- Real restricted SCM service starts and writes its synthetic Claim only
  to the protected SQLite WAL.
- Node connects to the actual named pipe and verifies a P-256-signed,
  nonce-bound response using an Administrator-owned public-key pin.
- Same existing `memory_recall` STDIO MCP, invoked from a real enrolled
  disposable Git checkout, obtains exactly one synthetic service-backed Claim.
- A different Git checkout, extra tool arguments and a forged key do not
  yield protected Claims. No user-memory write, network listener or approval
  operation is exposed by IPC.
- SCM service, private state, public pin, synthetic repo and EXE all get
  removed in cleanup. Existing restricted same-account ACL probes still run.

The existing cross-platform Node 24 MCP workflow additionally tests
signature tampering/replay/foreign scope, false human-approval assertions,
real repo scope handling, async MCP dispatch, and explicit mode separation.

## Critical non-goals

The fixture deliberately carries `provenance=synthetic_disposable_lab`,
`human_approval_verified=false` and
`trusted_for_production_recall=false` even though the SERVICE RESPONSE
signature is genuine. Service origin != human confirmation. The test must
never publish its Claim as user_direct or infer consent from a synthetic
WebAuthn assertion.

The current pipe ACL grants read access to Windows BuiltinUsers in the
**disposable fixture**. Production must enroll **individual user SIDs** and
protect per-user project read scopes in the service; a user-writable
allowlist by itself is not strong security against a same-user agent. The
lab service runs one fixed fixture only, not the actual user's repositories.

Still required for a real usable feature:
1. Actual interactive Windows Hello/FIDO2 registration and review UI.
2. Independent service-owned source/scope/snapshot verification for real
   `E~` proposals, plus the protected atomic Claim decision already built.
3. Per-user/service-validated project enrollment and read authorization,
   admin-pinned key provisioning and lifecycle.
4. Fully integrated original Codex CLI/Desktop with **real** approved Claims,
   backup, opt-in installation and E2E evidence on the user's Windows x64 PC
   without a VM or second account.

**Production Memory Write: NO-GO.** This deliverable tests the signed
IPC-to-Codex read transport, not the missing real-user write authorization.
