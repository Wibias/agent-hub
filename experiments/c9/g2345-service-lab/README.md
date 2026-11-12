# C9 G2/G3/G4/G5: positive end-to-end read-only service lab

**Review only. 0/7 security gates signed off. Production NO-GO.**

This isolated Windows Server 2022 test extends the real-service G2 evidence into the
*existing* `G2345PipeReview` and `ReviewGate`. No production broker, service deployer,
write handle, pipe command dispatcher, or commit API is added.

1. A GitHub-hosted ephemeral, elevated runner verifies the exact repository/branch,
   .NET 10.0.100, original service names and their frozen SIDs. It refuses to
   touch either service if it already exists.
2. The runner creates a unique folder under ProgramData; a **separate test setup
   process** generates an ephemeral P-256 signer, strict G3 `ApprovalTicketV2`,
   pinned SPKI and an exact Windows FileIdInfo-based signed target identity. The
   signing private key is discarded, never exported or stored. The G4 nonce file
   has the existing validated journal header.
3. ACLs grant only the broker service SID write access to `g4.journal`. Target,
   ticket, pinned test SPKI and intent are readable but not writable by either
   LocalService identity. Only the appropriate service SID can write its result
   directory. Admin/SYSTEM retain cleanup rights.
4. Two one-shot own-process Windows services run as LocalService with **distinct,
   enabled, immutable service SIDs**. The client transmits the same full signed
   ticket twice through a disposable local named pipe.
5. The broker invokes the existing `G2345PipeReview.EvaluateOneRead`: native
   process and pipe-client token verification, successful `RevertToSelf`, strict
   G3 ticket verification, G5 retained handle volume/file/preimage proof, G4
   fsync reservation, and G5 final recheck. A second full native/crypto/file
   inspection must reject replay and leave G4 at exactly one reservation.
6. After both services exit, PowerShell independently checks the persisted
   nonce journal against the ticket and the unchanged target hash, then forcibly
   verifies deletion of **only the two services created by this run** and the
   GUID-scoped test files in `finally`.

The test service explicitly supplies CI-only environment markers to the existing
read-only gate, but **those are never G2 identity authority**. G2 is validated
against actual Windows service-SID-bearing access tokens. These markers cannot
result in a commit because all relevant API results hard-code
`CanExecuteCommit=false`.

**Limitations:** The ephemeral test issuer is not a production issuer, and the
local journal has no external WORM rollback anchor. This exercises a positive
read-only pipeline under actual SCM/Windows identities only, not a production
service rollout, a protected deployment root, adversarial admin, or atomic file
writer. G2/G3/G4/G5 and the seven final security gates stay HOLD. WORM remains
intentionally deferred. Never run the script on a desktop or persistent host.
