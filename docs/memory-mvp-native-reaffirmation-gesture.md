# Native operator reaffirmation ceremony (temporary Windows x64 lab)

**Status: test-only, NO CLAIM, no canonical Memory Write, no production deployment.**

The protected LocalService host now offers two separate admin-ACL operations
`reaffirm_begin` and `reaffirm_complete`. They are available ONLY after
native Windows Hello/WebAuthn credential enrollment. These operations are not
available from Codex, MCP or the lab's public read pipe.

## Human-facing sequence

1. From the administrator-owned, hash-pinned native Operator UI, choose
   **Eigene Aussage vorbereiten** for a protected E~ proposal.
2. The UI verifies a service-signed response against the administrator-owned
   public signing key and displays the **exact** fact, source fingerprint,
   project, branch, Git revision, E~ and snapshot.
3. The UI explicitly labels the historical origin
   `operator_pinned_unverified_evidence_v1`. The user must tick a
   distinct checkbox: reaffirm the **new exact statement now**, **not**
   authenticate the historic evidence and **not** create a Claim.
4. A second dedicated button invokes the native Windows WebAuthn
   `GetAssertion` API with the separately purpose-bound 90-second challenge,
   UP+UV requirements and the protected native credential.
5. The administrator-only pipe consumes the challenge once; the existing
   `OperatorReaffirmationCoordinator` atomically records the immutable
   non-authorizing intent and advances the nonzero sign counter in the
   protected service-owned SQLite WAL.
6. The signed response states `reaffirmation_intent_recorded=true`,
   `human_approval_verified=false`, `original_evidence_verified=false`
   and `claim_written=false`. The UI never promises a Memory Claim.

The old enrollment and possession-only buttons remain distinct.
Procedures, relations to existing claims, reject decisions, unverified
manifest-pinned credentials, stale signed offers, replayed tickets and
unmatched scopes are refused.

## What tests can and cannot prove

Windows CI can verify that the real service, UI and tests compile, and
that the protected coordinator's synthetic challenge/transaction tests pass.
CI cannot simulate a person's actual Windows Hello click or establish
genuine informed consent. A future explicit operator-PC test must use a
fresh pinned build of the temporary preview and a *knowledge/preference*
proposal, not the previously tested `procedure` candidate.

This local lab intent is **not** the completed authorizing product flow.
The historical source remains unverified; a further policy review is
required before any real Claim insertion and signed project-scoped
`memory_recall` projection. Do not enable production hooks, write IPC,
or readback of these intent rows as canonical Claims.
