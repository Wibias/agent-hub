# G3-G4-G5 binding and replay boundary

- Ticket `ApprovalTicketV2` is verified by the existing G3 implementation, with exact scope and signature, before and after the native G5 handle proof. The provisional precheck is deliberately not treated as file identity.
- G5 verified `VolumeId`, `FileId` and `PreimageSha256` are observed from the retained Windows handle and supply the second `ObservedIntent`; the library does not reopen the file after successful verification.
- G4 reservation uses ticket ID, nonce and request ID as *independently unique* keys, and binds them to signed ticket SHA256 and observed target identity. It fsyncs the hash-chained append before returning a positive review verdict. No nonce refund on later failure.
- G4 journal exclusive open prevents ordinary concurrent reservations on the same local journal. A tampered/torn journal refuses restart. There is no automatic recovery, compacting or truncation.
- File-backed replay protection is not WORM and does not withstand full journal or machine rollback, a compromised Windows admin, storage-controller deceit or loss of durable writes.
- G2 token observations are *asserted by a synthetic test harness*. Passing Boolean flags is not evidence of actual Windows token checking. The gate must be replaced or extended with real checked token provenance before any release.
- The test key and test-reported release identity are never production authority; independent root provisioner, signed current Witness, G4 anti-rollback witness, live G2 and real G5 mutator remain unavailable.
- No code path can return `CanExecuteCommit=true`, create a target write handle, start the broker, or modify a production file.

Result = advisory read-only integration, **G3/G4/G5 HOLD; all seven security gates HOLD; Production NO-GO**.
