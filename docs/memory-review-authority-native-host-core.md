# AgentHub Memory Review Authority: native challenge core (uninstalled)

**Status: BUILD-AND-TEST ONLY; PRODUCTION NO-GO.** Issue #326. This
increment is a Windows-x64-native core library and synthetic test runner.
It is **not** a Windows service, FIDO2 registration UI, protected origin,
named pipe, localhost HTTP endpoint, installed hook, or database writer.

## What exists

`MemoryReviewAuthority.Core/ReviewChallengeCore.cs` maintains a bounded,
in-memory queue of 32 pending challenges. It generates fresh random 32-byte
nonces and independent ticket IDs, derives the same 32-byte WebAuthn challenge
format as `memory-engine/evidence-bound-webauthn-verifier.mjs`, and binds
project, branch, Git revision, E~ proposal, exact review snapshot, full
canonical fact digest and requested confirm/reject action.

Challenges expire after 90 seconds. One challenge is permitted per
project/branch/proposal. Each verification attempt consumes the ticket before
checking the assertion, even if invalid. Process restart invalidates all
pending tickets. The core validates the pinned P-256 credential, RP-ID hash
(`localhost`), exact browser origin, client challenge, WebAuthn get type,
User Presence (UP), User Verification (UV), ES256 signature and authenticator
counter. Counter zero is accepted as *not* proving replay resistance; the
ticket itself remains single use. Counter rollback for reporting credentials
is rejected.

Every successful result explicitly has:

- `Status = verified_not_authorized`
- `ApprovedReviewDecision = false`
- `ClaimWritten = false`

It does **not** emit reusable bearer authorization tokens or write Memory
Claims. The same-user agent can fabricate review scope data or call any
user-reachable API unless protected host-side lookup and access checks exist.
The native core's constructor therefore does not establish user authority.

## Current unit tests

`dotnet run --project memory-engine/authority-host/windows/MemoryReviewAuthority.SelfTest/MemoryReviewAuthority.SelfTest.csproj -c Release`

This uses generated temporary EC keys, not real Windows Hello enrollment.
The cross-language challenge test includes a fixed vector derived from the
existing Node challenge algorithm. Additional tests cover missing UV/UP,
bad origin/RP ID/signature, counter rollback, TTL, replay, capacity, incorrect
fact hash and mismatched scope.

## Host architecture required before enabling

1. **OS-protected service identity**: a service running under built-in
   LocalService (not a new interactive user) with its own service SID, SCM
   configuration and ACLs protecting state from ordinary same-user processes.
   Validate this on a disposable Windows 11 x64 host. Do not borrow C9/G5
   service ACLs or silently activate them.
2. **Trusted enrollment**: protect the credential allowlist, sign counters,
   origin policy and challenge ledger against same-user modifications.
   Enrollment must require independent local user approval. The test's
   `PinnedCredential` constructor is not enrollment.
3. **Host-side state**: read the pending proposal, canonical text, linked
   Evidence, current Git scope, relation target and review snapshot from
   trusted sources. Revalidate under the same SQLite write transaction after
   a successful challenge. Caller-provided `ReviewMeaning` is NOT trusted.
4. **User-visible review**: trusted UI displays the exact fact and irreversible
   effect before invoking a registered Windows Hello/FIDO2 passkey. Localhost
   is a WebAuthn origin, not authentication of HTTP callers. A random port,
   Origin header or CSRF token is insufficient alone.
5. **Cross-process bridge and transaction**: no successful signature result
   should be given to untrusted Codex as a portable approval. Keep completion
   and final one-time Claim/Review disposition inside the trusted boundary.
   A crash between signature and commit must be fail-closed. Ordinary Memory
   SQLite is currently user-writable, so protect canonical write authority
   separately before trusting this host.
6. **Native evidence**: compile and run this core on Windows, then implement
   service identity, hostile same-account pipe/HTTP tests, user-initiated Hello,
   registration, crash/replay tests, and exact confirmation/rejection end-to-end.
   Native unit/CI success is not a completed threat model.

No VM or extra Windows user account is required by this plan, but satisfying
the built-in LocalService ACL/authority conditions is not assumed.

The separate mixed-intent #192 finalizer remains an unmerged Draft;
`operatorReviewed=true` is not a host attestation. G5, C9 and production
Memory Write remain NO-GO.
