# AgentHub protected user-direct Claim commit (Windows x64, default OFF)

**Status: protected SQLite host-only proof of concept. NOT a deployed UI action,
NOT hooked to signed read IPC, and NOT available to Codex memory_recall.
Production authorization remains NO-GO.**

## Two independently explicit user gestures

1. The **reaffirmation gesture** from #374/#375 records an immutable,
   source-hash-bound statement as a **new human intent**. Historical
   `operator_pinned_unverified_evidence_v1` remains unverified.
2. An entirely **new** WebAuthn challenge with
   `agenthub-evidence-bound-uv-commit-v1` purpose is required before the
   statement can become a protected, user-direct Claim. Neither the
   original possession proof nor the first reaffirmation signature can
   be reused as consent to publish a memory.

The crypto verifier itself never grants publication authority. A separate
`OperatorDirectClaimCoordinator` invokes the protected WAL owner only after
a fresh, one-use, purpose-specific UP+UV assertion. The host transaction
checks both the previous reaffirmation and the current pending source,
project, branch, exact revision, proposal reference, snapshot and fact
hashes, evidence hash, unrelated relation, native credential fingerprint
and monotonic counter. Reaffirmations older than 15 minutes are not
eligible. Duplicate facts and synthetic lab Claim collisions are denied.

## Storage and provenance

The protected SQLite WAL has a distinct immutable
`protected_operator_direct_claims` table. A row is tagged
`user_direct_reaffirmed_and_published_v1`; it retains the original
unverified source as `operator_pinned_unverified_evidence_v1` and sets
`historical_evidence_verified=0` under a database CHECK constraint.
Both the Claim and credential counter advancement commit in the same
immediate transaction, or both roll back.

This is a **new personally reaffirmed memory**, not evidence that the
old extracted source was true or independently authenticated.

The existing `protected_review_claims` (synthetic lab), public signed
read pipe and `memory_recall` are unchanged. Even a successful host-only
direct-Claim transaction is NOT read by Codex. A signed production-quality
project-scoped read projection remains an independent required gate.

## Tests and remaining gates

Native tests cover distinct cross-purpose one-use challenges, missing
native enrollment, missing first reaffirmation, stale nonzero counters,
duplicate Claim rollback and counter immutability, scope isolation, WAL
restart and direct SQL mutation/delete refusal.

**Still required before production:** a separate explicit **publish memory**
action in the protected operator UI, independent signed receipt inspection,
real Windows Hello E2E for that second gesture, source freshness at the
live Git revision, stronger signer/service trust evidence, signed
project-enrolled read projection and Codex CLI/Desktop readback, backup,
rollback and operator approval. No automatically persisted browser state
or mere conversation-prompt flag is authority.
