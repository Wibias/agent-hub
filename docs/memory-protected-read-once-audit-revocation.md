# #338: protected one-shot CI read receipt, consume-before-I/O and durable revocation

## Authoritative behavior added

The **disposable synthetic Windows LocalService** now records each fixed-fixture one-shot read request in its own ProgramData service-SID-protected SQLite WAL. It does not use the user-writable canonical Memory database.

The protected table contains the exact random request ID, fixed project/branch/revision/E~ and Claim ID, query/result digests, actual kernel-observed recipient PID and Windows SID, recipient-session fingerprint, 90-second deadline, and an immutable version label. **It contains no Claim text or credential secrets**.

State transitions are one-way:

- **reserved**: the service has selected a protected Claim, verified a waiting already-connected recipient and minted a purpose-bound challenge. This is not authorization to release.
- **aborted**: a wrong-purpose assertion, invalid completion or deliberate denial consumed the offer. Never retry with the same request.
- **consumed_pre_io**: the service has verified fresh read-purpose UV and atomically committed a durable one-use consumption **before sending the first private byte**. Even when the pipe disconnects or I/O fails, no retry is permitted. This state is **not proof that the receiver got the bytes**.

The service checks the exact protected Claim snapshot again, then requires a matching pending reservation and an unrevoked lane before committing `consumed_pre_io`. It checks the same held recipient pipe's real kernel PID and SID and sends a signed payload once. Invalid or missing protected SQLite state denies release.

There is a separate immutable **deny-only** tombstone `synthetic_read_once_ci_v1`, written through the existing **admin-only operator pipe** with `ci_read_revoke`. It aborts all pending receipts and closes a pending recipient connection. New reservations fail even if the original synthetic CI marker remains. Restarting the service with the same state cannot remove the tombstone. Neither normal user/MCP clients nor a user-writable config file can remove it. No positive consent is required to revoke.

## Evidence

- Store selftests: fresh reserve, duplicate rejection, strict exact project/session/PID/Claim matching, consume-before-I/O and replay refusal, abort, expiry, SQLite row/trigger tampering, reopen-after-consume, immutable tombstone, reopen-after-revoke, denial of future reservations.
- A real temporary Windows SCM LocalService and a **real separate Windows recipient process** exercise: wrong purpose -> durable abort with no recipient bytes; correct synthetic read-purpose UV -> durable consumption and one signed synthetic Claim; a second Codex-compatible `memory_recall` process -> distinct durable one-shot consumption; administrator revoke -> a fresh connected recipient gets **no signed offer and no Claim**.
- After an actual SCM service STOP -> START, a read-only audit of its protected WAL must find exactly **three terminal request rows** (one aborted, two consumed before I/O) plus one immutable revocation tombstone. The running restarted service is challenged with a **new already connected** process, which must also be denied before any Claim bytes.

The test is explicitly synthetic. Neither the ledger nor any CI marker grants real private project access, and default `--global`/`--cwd` Codex tools are unchanged.

## Remaining security blockers

An admin/privileged attacker with filesystem control could replace or roll back the *entire* protected SQLite database and its WAL using an older snapshot; SQL triggers prevent in-place row edits, **not privileged file rollback**. A production design needs a trusted external monotonic/high-water mark or independently pinned/signed revocation checkpoint and recovery policy. A copied or previously delivered Claim cannot be withdrawn from an untrusted client.

The CI recipient PID/SID/nonce still prove continuity of one Windows IPC connection, **not** an uncompromised original Codex CLI/Desktop application. Same-user full-trust injection, handle duplication and recipient control remain unresolved. CI uses synthetic ES256 UV, not physical operator Windows Hello. A genuine signed operator gesture, secure recipient mediation and independent hostile native acceptance are still mandatory before personal private Claims can be released.

**#338 OPEN; production Memory Writes/private real-project Recall remain NO-GO; no operator-PC change, additional Windows user or VM.**
