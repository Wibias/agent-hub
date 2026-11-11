# G3 technical decision | 2026-11-11 | proposed, not a production approval

**G3 approach:** Distinguish *cryptographic validity* from *authority to execute*. The offline verifier confirms signature and exact scope only; it is not an issuer and cannot emit an executable permission. The eventual broker must require protected trust bootstrap, authenticated token evidence, durable nonce reservation, safe handle-bound target identity and release-scoped deployment approvals before a mutation exists.

**Chosen cryptography:** ECDSA NIST P-256, SHA-256, DER signature (`Rfc3279DerSequence`), SPKI-encoded public key, and SHA-256 pin supplied independently of the ticket. This preserves the historical C9 offline verification family without treating lab signatures as production authority. Private keys must not be embedded in repo, test artifact, client, or broker.

**Ticket format:** `Version=2`, strict JSON members, binary-to-ASCII canonicalization via fixed newline-separated fields prefixed `agenthub-c9-approval-v2`. The `KeyId` is a selector, not a trust grant. No self-asserted `authorized`, `approved`, `CanExecuteCommit`, or file path may override observed identity.

**Revocation:** `TrustedKeySnapshot.Revoked` causes DENY only if its source is itself trusted and current. Real key enrollment, rotation/revocation distribution, rollback protection and fail-closed stale state remain BLOCKED until an independently controlled provisioner exists.

**Historical delta:** The C9 `LabApproval.cs` uses the lab stage's `authority.sha256` file and operator-minted tickets; historical `CommitAuthorization.cs` is offline-only. Neither is promoted as production issuer proof. The new verifier does not implement signing, replay reservation, storage, SCM, file rename or recovery.

**Formal status:** `G3=HOLD`, `G1,G2,G4,G5,G6,G7=HOLD`, `PRODUCTION=NO_GO`; no independent signoff. Explicit acceptance of this architecture by the owner is a *design decision*, not activation or release approval.
