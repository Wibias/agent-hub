# C9 G3 external witness | implemented vs not implemented

## Implemented for review

1. A standalone .NET 10 Web application with a single `POST /v1/current` endpoint. Kestrel HTTPS requires a trusted/mapped client certificate. The witness address, certificate identities and anchor address are externally configured. No secrets or private keys exist in GitHub.
2. The witness does not rely on the client's claimed scope. A chain-validated allowlisted client certificate is mapped to exactly one read-only scope; any certificate not mapped is denied.
3. The witness uses a new cryptographic challenge nonce for its remote anchor call, checks TLS server chain + exact certificate pin, and checks an independently pinned anchor P-256 signature, strict scope and nonce, epoch/revision/hash, 30-second freshness.
4. A fresh witness P-256 signature over an exact domain-separated ASCII canonical message with the **client's** nonce, expiry at 15 seconds, and current anchored head. No executable permission field.
5. Strict JSON (no duplicate, unknown, missing or wrong-typed fields), <=4096-byte request/response, no redirects, no pending anchor fallback or cached writes. Remote failures -> HTTP 503 and no signature.
6. Pure protocol tests with disposable ephemeral keys, and source compilation of the HTTP server.

## Not implemented or proven

- Witness **AdvanceHead** CAS, durable anchor updates, issuer key rotation endpoint, WORM audit service, recovery/reset, persistent monotonicity, or writer/release execution.
- Runtime TLS/certificate enrolment, off-host operator independence, outgoing anchor service, integration test with actual mTLS endpoints, real hardware-backed key custody, broker client identity verification, live HKLM consumer validation.
- A signature alone cannot prove an independently controlled immutable anchor. A production deployment must not sign fresh heads if its anchor is stale, unavailable, or compromised. The current server refuses signing on any remote-anchor verification failure, but cannot establish operational independence on its own.
- A low-level C# test or green CI cannot establish operational authorisation, independence, system rollback protection or G3 PASS.

## Next single scoped step

Build the **remote anchor's read/write durability and audit head** in a separate administration domain, then run an authenticated two-host acceptance test. Do not multiply synthetic tests or use GitHub CI as a substitute for real host separation.

**G3 HOLD. G1..G7 all HOLD. Production NO_GO.**
