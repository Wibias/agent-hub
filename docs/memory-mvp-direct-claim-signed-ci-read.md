# Protected user-direct Claim: signed, Windows-principal-bound READ (CI prototype)

**Current status: CI-only, default OFF, not a DEFAULT or production
Codex memory_recall provider. The explicitly isolated diagnostic launcher
is permitted only in Windows GitHub Actions. No real user's source or
physical Windows Hello consent is readable through this feature.**

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

The ordinary Codex `memory_recall` MCP **defaults** to its original
non-CI providers. Only the explicit `--ci-user-direct-read` diagnostic
launcher can select the separately enrolled synthetic user reader.
The current public signed read pipe is not changed.

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

## Live enrollment revocation in the protected CI service

The currently running service used to cache its exact administrator-owned
CI read policy at startup. **Deleting a read enrollment did not revoke
already-running pipe access.** The CI reader now binds the exact original
policy bytes using SHA-256 and rechecks the protected enrollment before
reading a Claim and immediately before signing and emitting a response.
A missing, reparse-pointed, resized or altered policy file is a **latched
revocation for that service instance**. Recreating the same original file
does not silently reenable the old active reader. An explicit, reviewed
service lifecycle action is needed for any renewed enrollment.

Disposable Windows SCM regression tests must demonstrate both mechanisms:
the same-account nonadmin user initially reads one signed private test
Claim, then loses access immediately after the protected user-policy file
is removed and **remains denied** after exact bytes are recreated.
The separate administrator read lane must refuse access after its
protected policy revision is modified, and still refuse after those
original bytes are restored. The service must stay RUNNING, and the
protected Claim and credential counter must remain unchanged.

This is a lab-only **observed-revocation** guarantee. A policy that is
removed and replaced entirely between consecutive checks can escape the
service's observation; a response already transmitted cannot be erased.
A production system needs an independent monotonic, durable revocation
authority and a specified in-flight response cutoff. No production
re-enrollment or operator-PC activation is provided by these tests.

## Durable CI enrollment history (protected FULL-WAL)

An observed file revocation was previously latched **only for one service
instance** (#382). Recreating the original protected JSON policy and
restarting the service could restore access. The protected SQLite owner
now maintains an additional, append-only
`protected_direct_read_enrollment_events` journal, with precisely two
possible events for each synthetic CI lane: generation 1 `enrolled`,
followed by generation 2 `revoked`. Both event types retain the exact
policy SHA-256, Windows SID, fixed test project, branch, Git SHA and
policy version. SQLite rejects direct UPDATE/DELETE attempts.

On the initial eligible service startup, the service validates the
original CI-only scope and binds it to one immutable enrollment event
before opening the named pipe. Each read requires that event to remain
active. An observed missing/replaced/read-inconsistent policy causes
a **transactional durable revocation event** under
`PRAGMA synchronous=FULL` + WAL, then refuses the response. Startup
reconciliation runs **even when a policy file is absent**; it revokes
an earlier enrolled lane on disappearance/mismatch. When a revocation
event exists, a later process refuses to open the same reader even
if the original JSON bytes have been restored. There is deliberately
**no re-enrollment API** for this disposable CI fixture.

The real disposable Windows SCM test must stop and restart LocalService
after both separate reader policies have been revoked, confirm the
service stays RUNNING, and require both admin and restricted same-user
read clients to fail. An independent read-only SQLite audit must find
exactly four immutable events (two enrollments and two revocations),
one unchanged private synthetic direct Claim and unchanged credential
sign counter.

**Remaining limits:** revocation must first be observed by the running
service or at startup. If a protected file is removed and restored
entirely between checks without a journaled revoke, the service can
miss it. A malicious privileged actor with authority over both the
service-owned SQLite and backup state is outside this CI model. Already
returned Claim text and signatures cannot be recalled. This fixed
single-generation fixture is NOT a production policy management,
re-enrollment, key rotation, crash-consistent multi-party authorization
or per-project identity solution. Production remains NO-GO.

## Existing Codex memory_recall: explicitly isolated test mode

The existing `memory_recall` MCP tool now has an extra, CI-only
**diagnostic launcher mode**:

`--ci-user-direct-read --scope ABS_SCOPE --pin ABS_ADMIN_PIN`

The original `--global`, `--cwd`, and synthetic `--lab-protected-read`
modes remain independent and unchanged. The CI mode refuses all
non-Windows / non-GitHub-Actions calls and does **not** accept a
model-supplied project, branch, revision, SID, signer key or source path.

The provider resolves the actual MCP process Git checkout root,
checks its enrollment in the explicit read-only scope manifest,
reobserves Git identity, current branch and FULL commit hash, derives
the Windows SID via `whoami /user` and asks only the separately enrolled
protected per-user pipe. The service is still the final authority for
the actual impersonated client SID, fixed CI project, exact Git SHA
and protected Claim provenance. The client verifies service signature,
nonce and all identity/scope/fact fields. A failed pipe or signature
produces an empty fail-closed result; **no canonical SQLite fallback**.

The result stays labeled `found_direct_ci_only`, not a production
`found` memory decision, and asserts
`trusted_for_production_recall=false` and
`physical_human_approval_verified=false`. This **does not** install
the adapter in Codex Desktop or CLI on the operator PC. Actual
nonadmin process-level Codex acceptance and enrollment remain
separate mandatory gates.

## Security and readiness limitations

The original `DirectReadCiV1` CI reader grants **Administrators,
SYSTEM and the particular LocalService service SID only**. The separate
`UserReadCiV1` CI reader instead allows the **exact enrolled Windows
account SID**, SYSTEM and the restricted service SID, with no
BuiltinUsers, AuthenticatedUsers, World or generic Administrators grants.
Neither reader is enrolled in a normal installed No-Write Preview, and
neither is authorized as a production Codex memory source.

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
