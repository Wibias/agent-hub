# Memory MVP: atomic protected Claim decision (Windows x64 lab)

**Status: synthetic CI + protected LocalService lab, default OFF. Not installed
and not a completed user-facing Memory approval flow.**

This increment extends the *existing* `MemoryReviewAuthority.Store` SQLite
WAL file and the already-tested `VerifiedReviewCoordinator`. It does not
create another service, canonical MemoryEngine, identity or approval mechanism.

## Exact decision transaction

The opt-in `CompleteProtected` flow requires:
1. A pending `E~` review already staged in the service-owned ledger.
2. The existing short-lived P-256 WebAuthn assertion, with user presence and
   user verification. Its ticket is consumed before any write attempt.
3. A trusted snapshot reader **injected into the host**, which independently
   resolves current project, branch, revision, proposal ref, snapshot hash,
   original canonical fact and source Evidence hash.
4. Exact equality between the human-reviewed meaning, trusted snapshot and
   protected pending row. The only supported Claim creation is for a new
   **unrelated** `knowledge` or `preference` fact. Updates, same/contradict
   relations and targets are intentionally not implemented.

For `confirm`, the protected SQLite `BEGIN IMMEDIATE` transaction writes
both the one-time verified review decision and an immutable
`protected_review_claims` row (stable `C~` ID, exact scope, fact, hash,
Evidence SHA-256, proposal ref, revision and policy version). For `reject`,
the same transaction records the final reject disposition **without** a Claim;
a targeted or conflicting proposal may still be rejected.

A duplicate text, already-used review, stale/fabricated source, changed
Evidence/branch/revision, or failed SQL insert causes a full transaction
rollback. A rejected or invalid request cannot be replayed into an approved
Claim. No update or delete API exists. Pending and final decisions continue
to be distinguishable.

The native `ReadProtectedClaims(projectId, branch, maxItems)` is a bounded,
scope-filtered, read-only projection from the service-owned DB. It excludes
rejections and validates the stored fact digest and policy. It is not an
unprotected export to `%LOCALAPPDATA%`.

## What is and is not proven

Windows tests use ephemeral **synthetic** review data and P-256 keys. They
exercise confirm, reject, scopes, missing source reader, stale evidence,
unrelated-only writes, duplicate rollback, independently issued challenges,
reopen and persistence. Existing SCM CI checks the service-owned directory
ACL and cleanup.

This code does **not** by itself establish a human-controlled host: the
`trustedSourceReader` interface is a required boundary, not proof that a
source is independently trusted. A real host must implement it using a
trusted, immutable snapshot and never accept an agent-supplied provider,
`user_direct` flag, mutable canonical SQLite row or local consent string
as authorization. A CI-generated ECDSA key is not Windows Hello enrollment.

**Still missing** are a real protected host source reader and UI/browser
origin control, Windows Hello/FIDO2 credential enrollment and a human
review ceremony, a protected service read IPC endpoint, an explicitly
service-backed Codex MCP/Console read adapter, true native CLI/Desktop
evidence and opt-in migration/backup/rollback. The old `Complete` API still
records *intent only*, with no Claim; the new `CompleteProtected` API is
inactive unless a trusted reader is injected. No production service is
installed and no operator hooks, scope manifests, or canonical SQLite
database are altered.

Do not promote this as full M2 completion or a production authorization
claim. **Memory Write production remains NO-GO.**
