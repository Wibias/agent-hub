# #338: purpose-bound private read-disclosure consent (crypto stage, default OFF)

## Decision

For the first real-project implementation, **do not authorize unattended, persistent private-Claim reads just because a Codex process has the enrolled Windows account SID or a previously pinned PID**.

The signed synthetic CI reader and the kernel-PID diagnostic are not sufficient to distinguish an authorized Codex session from a separate untrusted process under the same full-trust Windows user. The existing protected durable CI enrollment/withdrawal remains unchanged. The real-project intake ledger introduced in #384 remains non-authorizing.

The first acceptable design is **an operator-mediated, one-read disclosure**. A native, admin-owned operator window, using a service-owned exact offer, must display the original requested project / branch / revision, the exact query, what Claim texts or categories will be disclosed, and the intended receiving application/session. A **fresh purpose-specific Windows Hello/FIDO2 user-verification gesture** must approve this disclosure. The underlying protected host must independently revalidate the source, facts, scope, recipient channel, and the current revocation state **after** the gesture and just before emitting any bytes.

A user who does not approve a specific disclosure must not cause a private Claim to be emitted. The service must not create a reusable bearer capability in a user-writable location. A future one-time receipt must be consumed atomically with exact Claim selection and a per-recipient response; decline, timeout, replay and protected-storage failure must return nothing. Previously delivered text cannot be revoked.

## This PR: one protected WebAuthn purpose, not a complete read system

`ReviewChallengeCore` now has a separate `agenthub-protected-read-disclosure-uv-v1` challenge domain, independent from possession proofs, reaffirmation, generic approval and Claim publication. It binds an exact `ReadDisclosureMeaning`:

- canonical GitHub project, branch, full revision
- proposed account SID and exact random request ID
- SHA-256 of original query text, exact selected result set, and intended recipient session

Every field in that record is **untrusted** until derived and matched by the protected service and trusted native UI. A hash claimed by an MCP model is not a measured process or verified session. The challenge uses a fresh random nonce; tickets are in-memory, bounded and consumed even on failed verification. Existing sign-counter checks are shared between review and disclosure operations. A valid result is explicitly `verified_read_disclosure_intent_only`, **never a permission, trusted-session proof, Claim write or published result**.

The test uses synthetic ES256 and checks exact mutation binding, cross-purpose separation, UV failures, wrong-scope consumption, counter replay, expiry and one-use semantics. The actual Windows Hello user ceremony is **not** run by these offline tests.

## Mandatory next integration, not delivered here

1. **Host-owned read offer:** The LocalService must derive the complete exact query and eligible Claim projection from its protected source, with strict output size limits. UI must display the original text and scope; hash-only prompts are insufficient. A separate operator approval must never be confused with authorization of an old user-writable `E~` source.
2. **Trusted native UI and credential:** The already existing protected operator EXE and native WebAuthn integration must be extended to issue this distinct read-purpose challenge with genuine local user presence. The operator should see the exact prospective recipient and disclosure, and may refuse.
3. **One-use atomic release:** The protected host must validate a durable read authorization decision/receipt, the unchanged Claim snapshot, the fresh one-time assertion, valid source/credential and the currently nonrevoked scope in a single protected operation. Do not emit bytes on startup recovery or stale consent.
4. **Recipient boundary:** A Windows SID, PID, Git path or user-writable `recipientSessionSha256` does **not** establish recipient identity. Before releasing private bytes to Codex, use an OS-backed isolation/mediation design with hostile same-SID process and injection/handle-duplication tests, or explicitly require the human to approve every disclosure and still defend the response channel. Do not replace the user prompt with a reusable process token.
5. **Native acceptance:** Operator-controlled Windows 11 x64 physical Hello, actual Codex CLI/Desktop readback, deliberate foreign-session IPC, revocation during in-flight reads, signed pin rotation, rollback/backup policy, independent review and exact-head CI.

The current implementation provides **only #0: independent cryptographic intent proof**. There is no new service IPC, installation, enrollment, authorization, Memory SQLite modification or model-facing private read. The existing default-OFF and production **NO-GO** policy remains in force.

## Threat-model reminders

Windows AppContainer isolation is a Windows security boundary, but full-trust Codex applications cannot be assumed to be AppContainer-isolated. A project-scoped prompt cannot by itself prevent a compromised allowed process from forwarding data to a sibling. Windows WebAuthn verifies the authenticator assertion and user verification; it does not independently prove that an arbitrary UI displayed truthful Claim details or that the intended agent was the receiving process.

**No second Windows user, VM or modification of the operator PC.**
