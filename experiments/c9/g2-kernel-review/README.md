# C9 G2: genuine Windows kernel token identity + G345 fail-closed pipe review

**REVIEW ONLY. G2 HOLD. 0/7 security gates. Production NO-GO.**

This `.NET 10` Windows-only review component directly queries **real Windows primary and impersonation access tokens** via `OpenProcessToken`, `GetTokenInformation`, `ImpersonateNamedPipeClient`, `OpenThreadToken`, `RevertToSelf`. It reads the signed G3 ticket bytes itself from a disposable local named pipe using synchronous `ReadFile`, immediately captures the impersonated client token on **the same native thread**, and ALWAYS reverts the impersonation before executing application authorization or file IO.

The exact required LocalService user SID and two distinct named-service group SIDs are kept in step with frozen `readonly-rc1/src/Broker/BrokerIdentity.cs`. `G2345PipeReview` passes verified token flags to the existing non-executable `ReviewGate` **only if both primary and client tokens exactly match the frozen service identity policy** and the thread has successfully reverted. This prevents untrusted caller flags from granting G2 in the integrated entrypoint. No public method accepts an arbitrary token-proof bool or a forged `ReviewObservation`.

## Deliberate test limitation

A fresh GitHub-hosted Windows runner does **not** run as those two distinct services. The native runner test therefore proves kernel token capture, thread impersonation/reversion and **denial before G3/G5/G4**. It never fakes a positive G2 receipt or burns a nonce. The earlier independent 27/27 G345 tests remain the evidence for the G3/G4/G5 logic using synthetic flags. **A successful G2 test here does not mean G2 security approval, separated service identities, or end-to-end positive broker authorization.**

The test pipe name is random and disposable, not AgentHub's frozen broker pipe. No SCM writes, service activation, credentials, local user creation, Windows registry changes, production file modifications, or commit methods. No new live roles. In the actual read-only broker service the `--service` entrypoint remains disabled. `main` is not changed.

Only an authorized, isolated two-service Windows test under real service SIDs may prove the positive G2 service boundary, and requires a separate approval before SCM/service creation. G4 rollback/WORM and G5 handle-relative write remain independent release blockers.
