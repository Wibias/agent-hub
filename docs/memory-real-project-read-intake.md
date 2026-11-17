# Real-project protected read intake (default OFF)

Tracking: #338. This is **not** a real-project read enrollment or production authorization.

## Why the CI read enrollment cannot be generalized

The durable CI reader journal shipped in #383 fixes restoration after an **observed** revocation. It deliberately binds only `github.com/example/operator-evidence`. A Windows SID authenticates the Windows account, **not a particular Codex process, window, agent or Git workspace**. Two Codex instances with the same user SID can both connect to a pipe whose ACL grants that SID. Git paths, client-provided revision hashes, executable names, PID and self-reported agent identity do not establish independent authority. Never weaken the CI-only project check or use its signing key as a production trust anchor.

## This change

A new service-owned SQLite `protected_project_read_candidates` table accepts review **candidates** with precisely:

- Canonical lowercase `github.com/owner/repo`, branch, full SHA-1 Git revision;
- Exact proposed Windows account SID;
- Proposed SHA-256 Git-root and service-signer fingerprints, **not verified attestation**;
- Random candidate identifier, creation time and fixed policy version.

Records are unique on project/branch/revision/SID. An exact repeat is idempotent; changed root or signer pins are refused. A separate append-only `protected_project_read_withdrawals` table stores permanent withdrawals. SQL UPDATE/DELETE of either table is rejected. Store transactions use the service's existing `synchronous=FULL` SQLite WAL. Restart does not reinstate a withdrawn candidate.

There is **no `enrolled`, `approved`, `authorized` or `active` state, and no read or write API that consumes these candidates**. No service IPC exposes intake, no agent can select a Claim or provide an arbitrary grant flag, and no source file or credential is imported from a real user. The `ProtectedProjectReadRequest` fields are explicitly untrusted review inputs. The pre-existing real-project private reader remains impossible to activate through this schema. Existing synthetic CI readers are unaffected.

## Before allowing a real project

1. Establish exact real Git/worktree identity **in the trusted host** and bind it to a checked native operator UI. Reject client-supplied `cwd`, Git metadata, strings, and process PID as sufficient proof.
2. Require explicit, single-use native Windows Hello/FIDO2 approval with a separate purpose-bound challenge, complete project and read-scope display, a verified credential and monotonic sign-counter policy. Do not mistake possession proof or approval of a Claim for approval to read every Claim in a repository.
3. Distinguish same-account Codex processes using a **real OS-backed isolation boundary or a trusted per-session mediator**. If one cannot be established for both CLI and Desktop, keep private read disabled. A same-user bearer token or pipe SID alone is not a robust process boundary.
4. Create a **separate** versioned protected grant ledger with generation/rotation/revocation, crash-safe cutoff, signer pinning, read-time check and fail-closed signed projection. The current candidate/withdrawal tables must never be reinterpreted as grants by a migration.
5. Test native CLI/Desktop behavior and explicit denial by an unauthorized same-SID process, file replacement, in-flight revocation, service restart, key rotation and replay, plus privileged-backup rollback policy. Obtain independent review and exact-head all-green Windows CI before production signoff.

Security limits: service-owned SQLite and ACLs protect against an ordinary same-account client only when the **host actually enforces its existing service token and directory DACL checks**. These tables are not protected from an elevated local administrator, a database rollback, or a compromised trusted service. An immutable SQLite trigger does not provide tamper-evident or rollback-resistant storage by itself.

**Operator PC unchanged. Installed No-Write Preview unchanged. Production Memory Write and private real-project read remain NO-GO.**
