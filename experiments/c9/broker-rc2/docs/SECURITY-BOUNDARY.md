# C9 Broker RC2 threat boundary

- Identity: frozen BrokerIdentity and Win32 protected named pipe from readonly-rc1 linked from source; no divergence or duplicate identity configuration.
- Native G2: runtime dispatch calls the existing G2345PipeReview, which reads exactly one length-prefixed ticket then impersonates the last real pipe client on the same native thread. The kernel verifies broker primary and client impersonation service-SID sets, and RevertToSelf precedes all downstream IO.
- G3: requires strict signed P-256 approval and an external authenticated issuer public-key snapshot. Neither the ticket nor the client selects the bootstrap key.
- G5: held read-only file handle and path components, native FileIdInfo and SHA256. No re-open for a writer.
- G4: existing exclusive preprovisioned local journal with hash chain and Flush(true), replay denial; local rollback remains possible.
- Runtime: service entry is a hardcoded static-readonly DENY, independent production trust source is intentionally missing, G2345 gate remains CI-only. This RC2 cannot provide positive service authorization today. The previous test lab demonstrated separate positive role tokens and whole G2345 flow in its separate disposable executable, **not this RC2 EXE**.
- Replies always advertise `State=NOT_COMMITTED`, `Applied=false`, `CanExecuteCommit=false`; command opcodes for writes are unavailable.

Not claimed: G1/G2/G3/G4/G5/G6/G7 signoff, external WORM checkpoint, key custody, native handlegebundener atomic commit, persistent deployment, new Windows SCM installation, or native positive RC2 service E2E. All gates HOLD; Production NO-GO.
