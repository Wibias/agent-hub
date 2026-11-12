# C9 G3 + G4 + G5 isolated authorization review V0.1

**REVIEW ONLY. G3/G4/G5 HOLD. 0/7 release gates. Production NO-GO.**

Combines existing unmodified .NET 10 `g3-offline` signed-ticket verification and `g5-handle-review` native Windows file identity with a new local durable `G4NonceJournal`. Runs only on an explicitly marked ephemeral GitHub-hosted Windows runner. No broker service, pipe, target write, commit API, or token impersonation code is added.

Sequence:

1. Preliminary G3 verification of the signed ticket and declared scope before target IO. Target file identifiers used here are only provisional ticket fields, not OS observations.
2. G5 opens and retains every ancestor directory plus a read-only leaf handle; checks 64-bit volume ID, 128-bit File ID, preimage SHA256, reparse and hardlink protections.
3. G3 verifies *again*, now using the actual held-handle file evidence, and the test harness's explicitly supplied token-observation flags. G5 rechecks that same handle.
4. G4 writes an exclusive, hash-chained local reservation for ticket ID, nonce, request ID and exact ticket/target digest. It calls `Flush(true)`, rereads, and refuses replay. The nonce is consumed even if a later check fails.
5. Final G5 recheck on the still-held handle, then dispose it; all returned outcomes carry `CanExecuteCommit=false`.

The nonce journal must already exist, provisioned offline with its strict header. Missing, corrupt, torn, conflicting or already-open journals deny. No automatic recovery or rollback of corrupted files. No security credential or private key is persisted by these tests. Tests generate ephemeral signing keys and delete all temporary data.

**Important limitations:** Token proof flags are synthetic test-harness inputs, not a Windows G2 identity proof. Root issuer SPKI is test-pinned, not a production bootstrap. G4 local fsync is not independently immutable and a complete VM/backup rollback can replay nonces; WORM is deferred. The G5 reader is not a handle-bound writer. G3/G4/G5 final security acceptance remains HOLD. A preview result must never be used to authorize writes or issue a production approval.

Run only within the guarded ephemeral GitHub Actions workflow, using .NET 10.0.100. Do not run on a daily-driver or a production host.
