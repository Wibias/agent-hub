# G2345 end-to-end isolated native proof boundary

- **Authority:** Real Windows primary broker and impersonated client tokens from
  the kernel, validated against pre-existing `FrozenServiceIdentity` constants.
  `RevertToSelf` precedes all ticket, file and journal work. No caller-supplied
  positive token flags are accepted at `G2345PipeReview`.
- **Ticket:** Short-lived, genuinely signed P-256 DER G3 `ApprovalTicketV2`,
  independently pinned test SPKI; exact release, request, ticket, nonce,
  target FileIdInfo and preimage SHA256. The issuer key exists only in setup
  process memory and is deleted on process exit.
- **File:** Native G5 retained read-only handle; no path re-open for mutation;
  secure relative path under a GUID-scoped ProgramData test root. G5 rechecks
  the same open handle after the G4 reservation.
- **Replay:** Existing G4 hash-chained write-through+fsync journal, opened
  exclusively by broker service, available to the client only for reading if
  ACL permits (not for modification); same ticket replay must fail and must
  not advance the journal. Independent post-exit journal/ticket/target check.
- **SCM and filesystem:** Service names and SIDs are frozen; fail if either
  pre-exists. Only an ephemeral GitHub-hosted elevated runner may create the
  one-shot services. No new accounts, no production keys, no real broker.
  Cleanup of each newly created SCM service and temporary file folder is
  mandatory even after failure.
- **Not proven:** Production trust/issuer custody, independent Witness/Seal,
  non-rollbackable G4 journal, Windows administrator and filter-driver threat
  model, protected production deployment, production client code, authorized
  handle-bound commit, or end-to-end G1-G7 gate sign-off.

G2/G3/G4/G5 = HOLD; gates signed = 0/7; Production NO-GO.
