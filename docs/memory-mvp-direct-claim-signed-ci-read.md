# Protected user-direct Claim: signed, Windows-principal-bound READ (CI prototype)

**Current status: CI-only, default OFF, NOT a Codex memory_recall provider and
NOT a production release. No real user source or Windows Hello consent is
readable through this feature.**

## Why not reuse the existing signed lab read pipe?

The original `AgentHubMemoryReviewLab-ReadV1` pipe permits
`BuiltinUsers` in its disposable lab ACL. Its responses contain only the
synthetic fixed `github.com/example/lab-fixture` Claim and always report
`human_approval_verified=false`. It must **never** be modified to expose
real protected direct-user Claims.

The new `AgentHubMemoryReviewLab-DirectReadCiV1` is independent,
admin-only and can be started only when a precise enrollment JSON file
exists under the pre-verified protected service-SID ProgramData state:

`agenthub-direct-read-ci-only.json`

The temporary No-Write Preview installer never creates this file;
both preview test variants assert its absence. Its absence disables
the entire new reader. Only the disposable elevated Windows SCM
CI fixture creates it after checking owner and service-SID DACL.
The marker contains `policy`, the actual caller's **Windows account SID**,
the synthetic `github.com/example/operator-evidence` project, branch
`main`, and the exact Git revision from the protected evidence manifest.
The SCM host explicitly refuses any other project. An arbitrary MCP
argument or user-writable file does not enroll a new identity or repository.

## Read request and response

The CI client sends a fresh 32-byte nonce, exact pinned project/branch/
revision, query and a limit of at most 3. The LocalService verifies the
Windows **impersonated pipe-client SID** (not an alleged SID in JSON)
against the service-owned enrollment, checks the exact project, branch
and revision, and reads the already committed private direct Claim in
service-owned SQLite. It does not accept paths, write operations,
arbitrary claims, approval or credential credentials from the caller.

The response contains the identical principal SID, project/branch/revision,
nonce, query and result limit, plus bounded Claim digests and text. The
service signs the original UTF-8 bytes using the same protected P-256
key as the previous signed synthetic read lane. The client verifies
that signature against the independently Administrator-protected
public-key pin. All scope, nonce, origin, Claim ID, fact hash, old
evidence hash and statement contents must match exactly. Every response
labels itself:

- `ci_simulation_only=true`
- `physical_human_approval_verified=false`
- `trusted_for_production_recall=false`
- `published_to_codex=false`
- `historical_evidence_verified=false`

A genuine signed service response **does not** authenticate the original
user-writable Evidence or imply a real human has used Windows Hello.

The ordinary Codex `memory_recall` MCP still has **no mode to select**
this CI-only reader. The current public signed read pipe is not changed.

## Separate same-account nonadmin Windows token acceptance

A **second** CI-only policy `agenthub-user-direct-read-ci-only.json`
starts `AgentHubMemoryReviewLab-UserReadCiV1`, with a separate
`agenthub-protected-user-read-ci-v1` wire protocol. The policy is
created only by the same disposable protected SCM fixture; it pins the
real GitHub runner Windows account SID and the fixed synthetic
project/branch/revision. It is absent from both normal installed
No-Write Preview matrices.

The new pipe ACL permits SYSTEM, the precise restricted SCM service
SID and **exactly that enrolled account SID**. It does not grant
BuiltinUsers, AuthenticatedUsers or Administrators as a broad group.
The service still independently impersonates the caller after receiving
its pipe message, verifies its real SID and uses the same signed,
non-authorizing direct Claim projection.

A native CI probe creates a restricted token of the **same Windows
account**, disables the Administrators group, then verifies a real
nonce-bound, ES256/P-256 service signature on one protected synthetic
direct Claim. In the same restricted token it must still fail to read or
write the service SQLite, create state files, connect to the
administrator-only WebAuthn pipe, or connect to the administrator-only
direct-read pipe. It does **not** create another user account or VM.

This establishes an OS-token and ACL boundary only. It does NOT prove
that a model, terminal process or Codex agent running with the same
Windows SID belongs to a specific repository. **The Windows SID cannot
distinguish two projects or two processes belonging to the same user.**
The service policy fixes one exact CI project/branch/revision; authentic
per-project enrollment and native Codex session attribution remain
separate requirements before using this design with real memories.

## Security and readiness limitations

The CI-only pipe ACL intentionally permits **Administrators only**
plus SYSTEM and the particular LocalService service SID, with no
BuiltinUsers, same-account nonadmin, authenticated users or world
access. A normal Codex CLI/Desktop process is not an administrator
and therefore cannot use this route.

A real same-account user-ready read lane needs a **separately enrolled
per-user SID ACL**, protected project-root/branch/revision binding that
cannot be changed by an agent operating as that user, trustworthy
same-account session/context attribution, independently pinned signer
lifecycle and a native CLI/Desktop acceptance test. The current
source is the fixed synthetic CI project, not the operator PC.
No user-account creation or VM is used or needed for this CI test.

Never enable this CI read policy with a real project or treat this
file as a production enrollment template. Production Memory Write
and user-direct read are **NO-GO** until the remaining gates are met.
