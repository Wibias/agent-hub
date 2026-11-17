# #338: OS-observed recipient origin versus untrusted Codex session

## What is now verified (Windows x64, synthetic CI only)

The existing #388-#392 protected one-use recipient bridge observes the actual
named-pipe client's **Windows kernel PID** and impersonated Windows SID. This
PR adds **OS-observed full process-image path and process creation FILETIME**,
using a held kernel process handle captured from the live pipe connection.
Neither value is supplied by client JSON, MCP arguments, environment variables,
Git paths or model text.

Before any private bytes are written to the **existing synthetic CI one-shot
recipient**, the service rechecks that the held process handle is still live,
the creation time is unchanged, the process image path still matches and the
connected pipe's kernel PID and Windows SID remain the same. The original
recipient session hash also binds the observed process image and creation
identity to the existing client nonce and service nonce. A dead or reused
PID or changed image observation fails closed.

The signed protected offer to the native WinForms operator now includes these
observed fields, and the compiled native client validates and displays them.
It also requires the explicit signed field
`recipient_os_origin_attested=false`, so an observed executable can never be
presented as independently verified original Codex CLI/Desktop identity.
The actual existing read-purpose Windows Hello and single-use protected
consent flow remains synthetic-CI-only.

## Concrete hostile same-account counterexample

The native same-SID process-origin E2E now runs a second attack:
two distinct processes launched from the **same exact executable file** under
the same Windows account. One is the host-pinned allowed recipient, with an
OS-held process handle. A sibling sends a synthetic instruction to that
recipient over a same-account control pipe. The allowed process relays the
instruction to the protected origin verifier.

The verifier observes the correct trusted PID, creation time, executable
image and Windows SID. Its existing kernel process-origin test still matches,
**even though the content was supplied by the unrelated sibling**.

The test does not run actual code injection and does not transfer real Memory
data. It demonstrates that image/signature/PID/SID checks cannot prove
operator intent or distinguish an intact session from a same-account agent
that can automate, influence or compromise it. This is a *capability
counterexample*, not proof that a particular Codex installation can be
injected.

## Release consequences

- No new automatic original Codex CLI/Desktop recipient enrollment.
- No migration of current `--global` / `--cwd` canonical memory reader.
- No ordinary-user, unauthenticated or model-supplied process ID can promote a
  CI test receipt into private production Recall.
- A known path, valid Authenticode signature, process hash, matching SID,
  kernel PID, held handle, OS process creation, fresh nonce and Windows Hello
  **cannot, by themselves, prove a full-trust same-account Codex process is
  uncompromised or enforce which internal agent receives its output**.
- Windows Hello verifies the operator's authenticator action, not Codex's
  process isolation. A previously approved client may relay the data after it
  receives it. Already delivered text cannot be revoked.

For a real project, the product must **first choose and test a genuinely
isolated recipient** (against same-account process control and handle
duplication) or use an explicitly human-directed per-read transfer with a
documented, accepted recipient/clipboard exposure risk. Original Codex
CLI/Desktop full-trust sessions cannot be silently assumed to satisfy either
option. No extra Windows account or VM is created.

Remaining acceptance: isolated trusted host launch or other OS-enforced
recipient security boundary, actual Windows Hello on the operator PC,
real installed Codex CLI/Desktop, hostile same-account injection/handle
duplication and recovery, independent security signoff.

**#338 OPEN. Personal private project Recall/Memory Writes PRODUCTION NO-GO.
No operator PC changes.**
