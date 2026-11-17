# #338: operator-measured recipient process, and same-account relay counterexample

## Concrete evidence and final boundary

The original protected synthetic one-shot LocalService's named-pipe
kernel PID, actual connected Windows SID and client nonce remain unchanged.
The service does **not** gain debug rights or permission to inspect a
separate user's process. A native Windows SCM test explicitly proved that
its restricted LocalService receives
`recipient_process_origin_query_handle_access_denied` when attempting an
additional `OpenProcess(QUERY_LIMITED_INFORMATION|SYNCHRONIZE)` against the
elevated Windows CI recipient. We removed that attempted privilege-expanding
service-side observation, rather than weakening the process DACL.

The **administrator-owned, sealed native WinForms operator UI** now
independently opens the service's **signed, kernel-derived recipient PID**
with only `QUERY_LIMITED_INFORMATION|SYNCHRONIZE`. It retains the process
handle, reads its true image path and creation FILETIME from Windows kernel
APIs, and shows both in the actual on-screen disclosure offer. The operator
button remains disabled if that process is gone or its observed creation or
image differs. The UI checks the held handle again **after the Windows Hello
gesture and immediately before `ci_read_complete`**. Changing scope,
cancellation or closing the window disposes the handle.

This is additional OS-observed diagnostic provenance and prevents an
ordinary PID-reuse or exited-process mix-up *at the trusted operator side*.
It is not a security boundary against a malicious process with sufficient
rights to modify the already-approved application. The LocalService still
independently rechecks that its own original pipe is connected to its
kernel-observed PID/SID when sending. No client-provided path, PID or hash
authorizes the service.

In the disposable Windows SCM CI test, the **actual compiled elevated
operator application** verifies the signed waiting `node.exe` MCP
recipient and observes its image/creation handle. The CI helper returns
only public process metadata, no private Claim text. The CI request
asserts `native_operator_process_handle_alive=true` and
`recipient_os_origin_attested=false`. No physical Windows Hello is
simulated as a human event.

## Controlled hostile same-account counterexample

The existing native same-SID process-origin test (#385) gains a **third
real multi-process test**: two separate processes run the **same native
executable** with the **same Windows account**. The non-approved sibling
sends a synthetic private-read instruction over a control pipe to the
approved host-pinned process. The approved process relays that instruction
to the verifier. The verifier observes the correct pinned PID, creation
handle and SID and matches it, **even though a sibling initiated the
message**.

No real private Memory text is handled and no code injection is attempted.
This demonstrates a confused-deputy/automation route and why even an
unmodified binary path, valid Authenticode signature, pinned PID, SID or
process handle does not prove the **intent** or lack of compromise of an
original Codex CLI/Desktop session.

## Why this is not production authorization

- The native operator observation works only in the **existing synthetic
  CI-only** recipient path. It does not enroll an original Codex CLI/Desktop
  session or authorize real-project private Claims.
- The operator UI's explicit recipient image is a **measured diagnostic**.
  The resulting service receipt remains labeled
  `production_authorized=false`, and the UI must never describe it as
  independently attested original Codex identity.
- A full-trust same-account adversary may manipulate or automate the
  original Codex process, causing its own correctly signed/revocation-bound
  session to relay private text. **Kernel process checks cannot stop that.**
- A real release requires either a demonstrated OS-backed isolated
  recipient trusted against the specified attacker, or an explicitly
  chosen per-read human-mediated transfer with documented same-user,
  clipboard and endpoint risks. In neither case can the automated Codex
  MCP bridge be promoted based on PID/signature alone.
- Full original Codex Windows CLI/Desktop acceptance, hostile process
  injection and handle theft tests, a genuine operator Windows Hello
  gesture and independent security review remain pending.

**#338 OPEN, private production Recall/Memory Write NO-GO. No operator-PC
changes, additional Windows users or VM.**
