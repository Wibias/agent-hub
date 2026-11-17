# Windows same-account process-origin diagnostic (not authorization)

Tracking: #338. This is a default-OFF **native diagnostic only**, not a grant to read real project Claims.

## What this checks

An exact Windows account SID allows multiple unrelated Codex processes to open a named pipe. A client-supplied Git repository, PID, executable path or bearer string does not establish a separate user-approved session.

`ClientProcessObservationPin` records a **trusted host-launched** child's OS process handle, kernel PID and creation FILETIME. During a real named-pipe connection it obtains the **kernel-owned** client PID via `GetNamedPipeClientProcessId` and checks that the pinned handle remains live. The process handle stays open to prevent PID reuse while the pin exists. It does not use a PID from an agent request.

The native Windows CI executable starts two **real processes under the same Windows user SID**, with no additional account, VM or service installation. The first is a host-launched pinned child. The second intentionally supplies the first child's PID as forged JSON. Both connect to the same native named-pipe endpoint. The server impersonates the real pipe clients to verify matching Windows SIDs, allows only the originally pinned process and denies the second. After the approved process exits, the pin stops matching.

## Critical boundaries

A kernel PID check is **not a secure Codex session identity**. A peer process with the same user identity and sufficient OS permissions may inject into the pinned process, duplicate a readable capability/handle, control the allowed process through automation, or otherwise act through it. An approved process can also access data it is allowed to read. This diagnostic does not address those threats.

In particular, this code is **not wired into the production read pipe**, does not register any approved process through IPC, and exposes no protected Claim. It does not verify Git checkout provenance, a true operator gesture, Windows Hello, independent service authority, signer rotation or reliable post-crash grant revocation.

Before a production private-read grant, use an independent user-approved native mediation boundary or appropriately isolated client with a verified process/handle security model, plus physical Windows x64 adversarial tests covering injection/handle theft, unrelated same-SID Codex sessions, process exit/restart, caller spoof, and Codex CLI/Desktop. Do not use `ClientProcessObservationPin` alone as a release authorization policy.

**Operator PC unchanged. No hooks, service, existing SQLite schema or keys changed. Production project Recall and Memory Writes remain NO-GO.**
