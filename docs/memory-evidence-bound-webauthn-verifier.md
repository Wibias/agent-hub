# Evidence-Bound WebAuthn user-verification verifier (offline only)

Issue: #326. This is a **crypto verification building block** for a future trusted local review approval flow, not an available Memory action.

## Why this direction

Windows 11 exposes Windows Hello / FIDO2 through WebAuthn. WebAuthn requires a signed, fresh challenge from a credential scoped to a relying party. The verifier can insist on authenticator **User Present (UP)** and **User Verified (UV)** bits and a known origin. References:

- W3C WebAuthn Level 3: https://www.w3.org/TR/2026/REC-webauthn-3-20260825/
- Microsoft Windows Hello WebAuthn: https://learn.microsoft.com/en-us/windows/security/identity-protection/hello-for-business/webauthn-apis

The same-account GitHub Delivery Authority Host already prompts Windows Hello using `UserConsentVerifier` and signs with a per-user TPM CNG key. That is useful UI precedent but is **not** a sufficient standalone Memory authorization boundary: the reviewed key creation uses `CngKeyCreationOptions.None`, `CngKeyOpenOptions.UserKey` and no enforced per-signature Hello UI policy. A nonexportable key does not stop another same-user process from invoking signing. Do not share its signing key with Memory.

## Implemented, entirely offline

- `buildEvidenceBoundWebAuthnChallenge()`: binds a 32+ byte host-generated random nonce to exact project, branch, Git revision, `E~` proposal ref, snapshot hash, canonical fact hash, and confirm/reject action. Deterministically produces 32 bytes encoded as base64url.
- `verifyEvidenceBoundWebAuthnAssertion()`: verifies an already enrolled P-256/ES256 credential, exact signed challenge and browser origin (`localhost` only), RP ID hash, UP and UV flags, DER signature, and available authenticator sign counter. Rejects unrequested authenticator extensions and cross-origin responses. Zero sign counters are reported as unverifiable, never claimed as replay protection.
- A success result includes `approvedReviewDecision:false`, `hostCredentialProtectionVerified:false` and `challengeConsumed:false` **by design**.

No credential registration, host key store, challenge persistence, endpoint, browser button, hook, migration, service or final confirm/reject is added. This module is not imported by the production Memory engine and never creates Claims or changes proposal status.

## Mandatory next steps before any approval

1. **Trusted registration:** bind an actual operator-controlled Windows Hello / FIDO2 credential after verified local enrollment. Protect the public-key allowlist and policy from same-user agents with an OS-enforced host boundary. An ordinary user-writable SQLite public-key row is not secure registration.
2. **Protected one-use challenge:** the trusted host creates, persists and atomically consumes a fresh random challenge tied to a specific pending intent, action and review state. Expiry, replay, cross-branch and lifecycle checks must be enforced inside the host.
3. **Protected local UI:** show project, branch, full canonical fact and exact confirm/reject action directly in the trusted approval UX before invoking WebAuthn. A generic Windows Hello prompt does not itself show the signed memory content.
4. **Authorized write:** only the host-controlled boundary may resolve review intents and authorize Claim changes. Include an atomic `BEGIN IMMEDIATE` transaction, Evidence/related-Claim recheck and review audit. Never regard a successful signature-verifier return value as a free-standing approval.
5. **Windows x64 native E2E:** actual Hello or FIDO2 user action plus adversarial same-user attempt and service ACL checks on a disposable database. No additional VM or interactive Windows user is needed. LocalService is a pre-existing Windows service identity but its own isolation must first be proven.
6. G5 production writer and the existing C9 service remain NO-GO, and the old #192 mixed-intent finalizer stays separate.

Do **not** enable this as a production option merely because synthetic EC-key tests and GitHub CI pass.
