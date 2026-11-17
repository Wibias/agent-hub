# #338: one-shot consent-to-recipient bytes, CI-only (not a trusted Codex release)

## Threat-model boundary

The existing #387 operator UI can display a real protected Claim and verify a **separate read-purpose** Windows Hello gesture, but never emits private bytes to a nonadmin recipient. The previous kernel-process-ID experiment #385 demonstrated that two Windows processes can have exactly the same user SID. **Neither SID, PID, Git cwd, process name nor an agent-supplied session hash independently proves an original Codex CLI/Desktop session.** Same-account injection and handle theft are not addressed by a PID check.

This change exercises the exact **consent-to-bytes** path in a disposable Windows CI-only service fixture without claiming to have solved trusted application identity:

1. The existing Windows SCM test creates an independent, protected `agenthub-read-once-ci-only.enable` marker with an exact constant. Normal No-Write Preview, production installs and user workstations **do not have** this marker. Without it, the new private recipient pipe **does not exist**.
2. The service creates a separate administrator/SYSTEM/exact service-SID pipe. A *real separate Windows child process* connects and sends a fixed **synthetic** project, branch and E~ reference. The service obtains its **actual kernel-reported client PID** and Windows token SID, generates an unpredictable session fingerprint, and keeps the exact pipe instance open, with a 90-second deadline. An initial ACK explicitly contains **no Claim**.
3. The administrator-only operator control channel receives `ci_read_begin`. The protected service independently selects the exact source-joined private Claim from its service-owned SQLite, reuses the distinct read-purpose WebAuthn challenge, and binds its scope / query / result snapshot to the **already connected** recipient's kernel PID, SID and fingerprint. No arbitrary request bytes can select a different project or foreign revision. This is not a native real-user approval: the CI test uses an ephemeral software ES256 key.
4. A wrong-purpose signed Claim-publication assertion is rejected and **closes the waiting recipient connection with zero private bytes**. A new approved attempt needs a new connected process and a new one-use challenge.
5. After a fresh synthetic read-purpose UV proof, the protected service re-reads the identical Claim snapshot, checks the exact held pipe and its unchanged OS client PID/SID, and **consumes the recipient state before any I/O**. It sends one service-signed envelope with one exact protected synthetic Claim. The separate receiver verifies the administrator-owned signer public key, expected Claim ID, project, E~ reference, hash, recipient PID and provenance. It logs only redacted PASS metadata, never Claim text.
6. Reuse of the original ticket fails. Any failed I/O consumes the recipient; no retry, no bearer token, no on-disk export, no broad ACL.

This is a real native Windows process-to-process private-byte transfer in a synthetic lab, not another nonauthorizing hash-only receipt.

## Strict NO-GO limits

- The receiver is **a CI helper process, not original Codex CLI/Desktop**. The operator's physical Windows Hello is not exercised by the synthetic fixture. Normal read-purpose `read_begin` / `read_complete` remain unchanged and return `read_released=false`.
- The test receiver's PID and signed bound channel are **not a cryptographic attestation of Codex application identity or ownership**. A same-user process with sufficient access might inject into, control or duplicate handles of a nominated process; the service does not prove that the operator really selected an uncompromised recipient. The current native operator UI does not offer a real production `ci_read_begin` operation, by design.
- There is no real-project grant, no plugin/MCP endpoint accepting this release, no installed user hook or change to user-writable Memory SQLite. The fixture's project is fixed to `github.com/example/operator-evidence`. Privileged admins / the service own the fixture.
- The one-shot signed delivery does not establish durable audit, production key rotation, monotonic revocation, rollback/backup defenses or verified GUI-origin trust. An already released byte string cannot be revoked.

## Next production gate

Before personal Claims can be safely handed to original Codex CLI or Desktop, build **a trusted recipient launch/selection and independently protected native acceptance contract**. Require actual operator-visible application provenance and session selection, fresh physical Windows Hello on the exact Claim/query/destination, real signed response consumed by Codex's MCP session, adverse same-SID injection/handle-duplication tests, replay/restart/revocation tests and an independent release review. A PID-only receipt or user-writable MCP state must never be upgraded to production authority.

**#338 OPEN, production Memory Write/private real-project Recall NO-GO. No extra Windows account or VM, no operator-PC installation.**
