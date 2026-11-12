# AgentHub C9 G5 atomic replacement laboratory v0.1

**DISPOSABLE WINDOWS CI LAB ONLY. NOT A G5-COMMIT IMPLEMENTATION.**

This independent .NET 10 executable references the existing `g5-handle-review` read-only file proof. It deliberately has **no reference from Broker RC2, G2, G3, G4, or any production process** and has no Windows service, installer, pipe or release endpoint.

Scope: a GUID-named child of `RUNNER_TEMP` on an ephemeral GitHub-hosted `windows-2022` runner. The executable requires `AGENTHUB_G5_ATOMIC_LAB=DISPOSABLE_GITHUB_RUNNER`, `GITHUB_ACTIONS=true`, `RUNNER_ENVIRONMENT=github-hosted`, `RUNNER_OS=Windows`. Worker subprocesses accept only the two exact scenario paths below the generated test root.

### What is measured

1. An independent test provisioner captures the actual 64-bit volume ID, 128-bit file ID, and preimage SHA256. `HandleIdentity.OpenApprovedReadOnly` must match and revalidate the held handle without granting commit authority.
2. A same-volume staged payload is written using `FileOptions.WriteThrough` and `Flush(true)`. An **isolated path-based** `File.Replace` is performed only after releasing the retained G5 read lease. Tests verify complete new target, complete old backup, changed FileId and rejection of the old pin.
3. Negative cases reject a same-content swapped FileId before the *laboratory* replacement, a corrupt staged payload, an already open writable handle, and a second cooperative lock owner.
4. Separate child processes block after a fully flushed stage or after the `File.Replace` call. The parent **kills the real process** and inspects the on-disk files. Recovery inspection returns `ABORT_PRECOMMIT_NO_AUTORETRY`, `POSTCOMMIT_REQUIRES_RECONCILIATION` or `DENY_INCONSISTENT_STORAGE`; it never attempts an automatic replacement or rollback.
5. A deliberately adversarial schedule swaps the file **after the G5 check is closed and before a path-based replacement**. The test demonstrates that the old FileId no longer binds the destination name. This is a demonstrated **security blocker**, not a passing authorization test.
6. Every test object and child process is cleaned up; the runner is disposable. The script verifies a known positive marker and a separate unresolved-TOCTOU marker.

### Explicit limits

- Windows `File.Replace` is a path-based replacement. It does **not** provide an atomic conditional compare-and-swap against G5's previously opened native file handle. The existing G5 lease denies deletion while open, so using `File.Replace` requires the lease to close and creates an exploitable TOCTOU gap. The demonstration intentionally proves this risk.
- `File.Replace` can merge ACL/attribute metadata; preserve old files for review, and never ignore metadata errors. This lab does not attest ACL-preservation correctness.
- Process termination at selected barriers is **not** disk power-loss, kernel crash, controller cache flush, or complete filesystem durability verification.
- The recovery inspector uses test-owned expected hashes. It is not a signed, anti-rollback log. There is no externally anchored WORM, production G3 issuer or G4 reservation integration here.
- One lab run cannot establish linearizability under arbitrary malicious concurrent writers, oplock/filter-driver behavior, file ID reuse, or an atomic handle-relative conditional replacement. These remain open design questions.
- No `CanExecuteCommit=true` exists in the existing G5 verifier. **G5 WRITE = HOLD; G1-G7 = 0/7; Production = NO-GO.**

To repeat: run the dedicated workflow `.github/workflows/verify-c9-g5-atomic-lab.yml` on the review branch. Do not run on a personal or production Windows host.
