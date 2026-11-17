# #338: independent Windows Registry checkpoint for synthetic read-once SQLite rollback

## Fixed-scope security increment

The #391 one-shot read receipts and permanent CI revocation were durable in a service-owned SQLite database, but a privileged offline rollback of the **entire database and WAL** could erase those receipts and revocations. SQLite triggers cannot prevent replacing the entire SQLite file.

This change adds an independently stored **HKLM Registry64 checkpoint** for the existing **synthetic CI-only** one-shot path. It is a second, explicit Windows protection surface; it is **not** a hardware monotonic counter or a production Codex identity guarantee.

- Before starting a private CI recipient pipe, a real restricted LocalService verifies its exact service-SID identity and opens one **fixed HKLM registry key**. The ephemeral elevated SCM fixture provisions that key beforehand with protected DACL and owner: SYSTEM / Administrators / **exact service SID**, no ordinary same-account user. It is not the service's SQLite directory, nor a path controlled by a model or the Codex MCP client.
- An **exact one-time administrator-created Bootstrap value** can initialize a checkpoint only when both protected one-shot journal tables are empty. The LocalService writes the initial checkpoint and consumes the Bootstrap value. Later missing or malformed checkpoints are never re-created from an existing database.
- The checkpoint is one versioned registry value `v1:<sequence>:<SHA256>`, covering a deterministic, complete non-secret snapshot of all CI one-shot receipt fields, state transitions and revocation tombstones. The service validates the stored digest **against SQLite before it starts any private recipient pipe** and rechecks the anchored state before each relevant read mutation.
- On reserve, abort, successful pre-I/O consume and permanent revocation, the service first commits the FULL-WAL SQLite transaction, then advances the separately protected registry checkpoint **before any sensitive bytes may be released**. If a crash/failure interrupts this two-store update, a mismatch **fails closed**, deliberately requiring manual trusted recovery rather than silently repairing the database.
- A changed or removed registry value while the service runs poisons the in-memory fence; subsequent reads cannot continue. A previously consumed one-shot request still cannot be retried.

## Real Windows SCM acceptance test

The isolated Windows CI fixture first provisions the registry key with exact ACL and bootstrap, starts the real LocalService, and verifies initial one-time bootstrap. A consistent SQLite online backup is taken before any private one-shot read. The existing tests then exercise wrong-purpose abort, two separate UV-approved synthetic one-shot deliveries, explicit permanent revoke, and a full LocalService stop/start. The registry checkpoint remains current and matches the protected SQLite history.

**Adversarial rollback:** after the normal SCM tests, stop the service, replace the full SQLite database with the earlier pre-read backup (without restoring HKLM), then attempt to start the actual Windows LocalService again. The process must leave an exact protected *failure-only* witness, fail SCM startup and refuse to create its private recipient IPC. Merely observing a failing start without this witness is not accepted as evidence. The CI runner then removes the **exact newly created** SCM service, protected state directory and HKLM key. No existing registry key or installed operator service is touched.

## Limits, deliberately not concealed

This protects against **SQLite-only** rollback when the separately protected HKLM checkpoint survives. An Administrator or SYSTEM attacker who can also replace the registry value, the service signing key and/or service binaries may defeat it. Hashing and ordinary Windows registry ACLs do not create an independent trusted monotonic counter. Nor is the two-store update atomic across SQLite and HKLM: an interrupted update may require a deliberate administrator recovery; automatic recovery would weaken rollback protection.

The fixed key, bootstrap and synthetic project exist **only in the ephemeral Windows CI fixture**. Neither real project memory enrollment nor ordinary `memory_recall` / installed Codex hooks are enabled or modified. The test receives synthetic ES256 proofs, not physical Windows Hello, and the receiving process is a Codex-compatible MCP fixture rather than an independently attested original Codex CLI/Desktop session.

**Before real private project release:** choose an independently trusted antirollback root (TPM, external attestation or signed remote immutable checkpoint), demonstrate actual on-device Windows Hello, and solve or explicitly accept the same-account full-trust Codex recipient compromise threat. Independent review is still required.

**Issue #338 OPEN. Production private Recall/Memory Write NO-GO. No additional Windows user or VM, no operator-PC changes.**
