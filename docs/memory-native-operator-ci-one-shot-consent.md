# #338: real native operator consent path for a connected CI recipient

## Implemented boundary

The existing administrator-owned WinForms operator executable now has an **additional, explicitly CI-only** action that opens the *real service-signed* pending one-shot recipient offer (from #388/#389), displays the **exact Claim text**, project/branch/revision, query, Claim ID/hash, and actual kernel-observed receiver PID, SID and 64-hex session fingerprint. The native client independently verifies the administrator-owned service ES256 signature, exact signed result/Claim hashes, credential origin, scope and recipient marker, and refuses a different account SID or missing/expired challenge.

Only a deliberate separate checkbox and button call the existing native `WebAuthNAuthenticatorGetAssertion` method; it uses the **purpose-specific read-disclosure challenge**, not the Claim-publication or enrollment challenge. Afterward the operator client strictly verifies the one-use protected service receipt, including the nonproduction flag. No completion call emits a Claim to an unbound recipient. Expiry and canceled Hello remain denied.

The CI-only feature is not enabled in a normal operator installation. Both client methods and the UI controls require the `GITHUB_ACTIONS=true` and `RUNNER_OS=Windows` CI context, while the service itself additionally requires an exact protected synthetic fixture marker and fixed synthetic `github.com/example/operator-evidence` project/branch and a currently connected recipient. These environment strings are not production security primitives.

## What the Windows SCM test actually does

The ephemeral Windows SCM test starts a real Codex-compatible stdio `memory_recall` receiver that has connected its one-time native pipe, then launches the **compiled Windows WinForms operator binary** in `--ci-one-shot-offer-smoke` mode. The native client makes a signed admin-only LocalService IPC call and independently validates the original Claim text and the live recipient metadata. The WinExe headless smoke writes **only the ticket/challenge/non-secret recipient metadata** to a fixed ephemeral runner file; never the original Claim. The already-existing synthetic test-key harness then produces a separate UV proof to release exactly one protected synthetic Claim to that same MCP receiver, checking no bytes before consent and that same ticket cannot be replayed.

The native CI test **does not invoke physical Windows Hello** or simulate a human clicking the GUI. It proves that the protected native UI can parse and validate a real recipient-specific offer and that the GUI's separate event handler is compiled and calls the real native WebAuthn API. A physical human acceptance test remains to be executed manually in a controlled protected Windows installation.

## Threat model: still blocked for personal projects

A kernel PID plus SID and fresh nonce binds an **existing pipe connection**, not an independently trusted Codex executable or agent session. A full-trust Windows process with the same account may inject code, automate an allowed process, or steal a handle. Showing the original Claim and recipient PID to an operator improves informed consent but **does not defeat an actively compromised authorized endpoint**.

The UI's marker says *CI ONLY: kernel-observed connected pipe, not verified Codex*. It must not be relabeled, hidden or used as a productive general project read mechanism. The request does not update the real user's canonical SQLite, any agent hook, global MCP enrollment, installer or Windows service.

Next gates: (1) independent protected recipient mediation / documented human per-read transfer tradeoff, (2) durable protected one-use consume and audit with crash/restart/revocation and rollback analysis, (3) real physical Windows Hello and exact original Codex CLI/Desktop acceptance including hostile same-account tests, (4) independent production review.

**#338 OPEN; production Memory Write and private real-project Recall NO-GO.**
