# Memory Review LocalService lab host (no APIs; never installed locally)

Related: Issue #326; native challenge core #335.

This is a **disposable SCM identity and executable ACL test**, not the
Memory authorization service. The project
`MemoryReviewAuthority.LabService` is Windows x64 / .NET 10. The only
runtime action is to register a Windows `ServiceBase` process and
verify the exact LocalService user SID (`S-1-5-19`) plus the exact
service-specific SID resolved from the hardcoded
`NT SERVICE\AgentHubMemoryReviewLab` identity.

It exposes **no pipe, network, HTTP, browser, registration, credential
store, challenge endpoint, SQLite connection or Claim mutation**. A
follow-up disposable lab lane writes one fixed, nonsecret marker into an
exact service-SID-protected test directory, then deletes it. If a process does not have the expected LocalService account
and the service SID present in its SCM token, startup fails closed.

The `--policy-selftest` mode tests policy evaluation but cannot start
a service. It cannot bypass the production identity check. The lab
project remains **unreferenced** by any installed Codex hook, Memory UI
or production service.

## Windows CI testing only

`.github/workflows/verify-memory-review-localservice-lab.yml` compiles
the native project and then publishes a standalone executable. Its
PowerShell lab harness is guarded by `GITHUB_ACTIONS=true` and
`RUNNER_OS=Windows` and refuses to touch a pre-existing service. On
the ephemeral Windows GitHub runner, it:

1. Creates a fresh folder under ProgramData with a protected DACL
   containing only SYSTEM, Administrators and LocalService. LocalService
   gets read/execute, not write, permission on the executable directory.
2. Registers a **demand-start** disposable SCM service under the
   built-in `NT AUTHORITY\LocalService` account, with
   `SERVICE_SID_TYPE_RESTRICTED`.
3. Checks the configured account and SID type, starts the service,
   verifies SCM reaches RUNNING, then stops/deletes it in a `finally`
   block and deletes the temporary executable directory.
4. After registering the service, independently resolves its **exact service SID** and provisions a second, protected ProgramData lab directory. Only the service SID gets Modify access; SYSTEM and Administrators get FullControl. Broad LocalService, Users and Authenticated Users receive no ACL grants.
5. The real restricted service writes a fixed marker into that protected directory. CI checks both the file content and DACL, then removes the service and BOTH temporary directories and verifies that nothing remains.
6. Does not install anything on the real operator's Windows PC.

This tests a **real SCM process identity and actual service-SID-protected file write**, not just a mocked SID. The marker is not a credential, secret or authority token. As the GitHub runner user has administrator privileges, this CI cannot prove denial against a real non-admin same-account adversary; that separate native negative lane remains mandatory. It does
not prove that a future named pipe, localhost page, state directory,
credential registry or database writer has correct ACLs. Admin/SYSTEM
are legitimate privileged principals and are outside the adversarial
same-user process claim. A restricted service SID alone does not prove
that all future resources and IPC are protected.

## Still blocked

The next independent implementation must add service-SID-bound private
state and deliberate IPC with checked client permissions, protected
credential enrollment, exact user-visible decision review, one-use
WebAuthn verification and the canonical SQLite CAS transaction in the
same trust domain. Test hostile same-account clients, UI origin spoof,
crash/restart/replay and actual Windows Hello on Windows 11 x64 before
deployment. No new VM or interactive Windows user is required on the
operator's PC, but the operator's machine has **not** been tested by
this PR.

Do not conflate this lab with C9/G5; both remain production NO-GO.
The old #192 mixed-intent Claim finalizer remains separate.

References:
- Microsoft LocalService account:
  https://learn.microsoft.com/en-us/windows/win32/services/localservice-account
- Microsoft SERVICE_SID_TYPE_RESTRICTED:
  https://learn.microsoft.com/en-us/windows/win32/api/winsvc/ns-winsvc-service_sid_info
