# Memory MVP: protected operator reaffirmation INTENT (Windows x64, default OFF)

**Status: host-only laboratory primitive. Not an installed approval action.
No new Claim, no Memory Write activation, no Codex recall exposure.**

## Why a separate record?

The historical E~ proposal is taken from a user-writable SQLite export. Its
source label remains `operator_pinned_unverified_evidence_v1`. Windows Hello
enrollment proves possession of an enrolled credential, not the authenticity
of the original conversation, agent trace or repository evidence.

The intended eventual user gesture means **"I personally reaffirm this exact
statement now"**, *not* "the old source was independently authenticated".
That distinction must survive a crash, restart and any future signed read.

## Implemented host-only contract

- The existing protected LocalService SQLite WAL gains an immutable table
  `protected_operator_reaffirmation_intents`, keyed by the original pending
  request ID, including project, branch, exact Git revision, E~ reference,
  snapshot/fact/evidence hashes, credential fingerprint, sign counter and time.
- Only `knowledge` / `preference`, `confirm`, and `unrelated` without
  an existing relation target are accepted. Procedures, updates, conflicts,
  alternate scopes and missing/changed source rows fail closed.
- `OperatorReaffirmationCoordinator.ForNativeCredential` requires the
  separately enrolled native UV credential persisted by the protected host,
  not a manually pinned/unverified public key.
- An independently generated **approval-purpose**, single-use WebAuthn
  challenge must verify user presence, user verification and the correct
  P-256 signature. The protected DB transaction rechecks the current
  credential, immutable snapshot and sign counter before inserting the
  intent and updating the monotonic counter together.
- The public projection intentionally excludes the fact text, returns the
  original `operator_pinned_unverified_evidence_v1` provenance, and has
  `HistoricalEvidenceVerified=false` and `ClaimWritten=false`.
- The normal `ReadProtectedClaims` projection remains synthetic-only.
  This intent is not an approved Claim or a transferable authorization token.

## Critically NOT implemented

There is **no** IPC operation, UI button or physical Windows Hello human
review ceremony wired to this coordinator. Only offline Windows test code can
exercise it. Tests use synthetic P-256 assertions and cannot establish
actual human consent. In particular, no interface permits Codex, an MCP
request or a caller-provided source to create an intent.

A future change must first implement a protected native UI with an explicit
human-readable **reaffirmation** choice, display the exact signed service
statement and original unverified provenance, and bind the approval
assertion to that choice. A separate policy/security review is needed
before any atomic real protected Claim commit or `memory_recall` read path.

No local Windows user account, VM, service, canonical user SQLite or
production hook is changed by this patch.
